import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  activate,
  freeSubscription,
  fromStore,
  isEntitled,
  limitFor,
  listingsToUnpublish,
  statusAt,
} from '../lib/lib/subscription.js';

/**
 * Subscription lifecycle — SOW §8, and the five rules the client confirmed.
 *
 * Plain unit tests against compiled output, with no emulator. Every transition
 * here is a function of time, and the alternative — waiting, or stubbing the
 * global clock — makes a suite that is slow, flaky, or both. Passing `now` as
 * a parameter means a 366-day-old subscription is one arithmetic expression
 * away.
 *
 * Money and entitlement live here, so the interesting assertions are the ones
 * about the boundaries: the instant a plan expires, the instant grace ends, and
 * what an early renewal does to time the dealer has already paid for.
 */

const DAY = 86_400_000;
const T0 = 1_760_000_000_000; // fixed epoch; nothing here reads the clock

const monthly = () => activate('monthly', 'ref-1', T0);
const yearly = () => activate('yearly', 'ref-2', T0);

describe('activation', () => {
  it('monthly runs 30 days from payment', () => {
    const sub = monthly();
    assert.equal(sub.plan, 'monthly');
    assert.equal(sub.status, 'active');
    assert.equal(sub.startedAt, T0);
    assert.equal(sub.expiresAt, T0 + 30 * DAY);
  });

  it('yearly runs 365 days from payment', () => {
    assert.equal(yearly().expiresAt, T0 + 365 * DAY);
  });

  it('grace is added on top of the paid period, not carved out of it', () => {
    // A 30-day plan must give 30 days of service and *then* 7 days of grace —
    // not 23 plus 7. The dealer paid for thirty.
    const sub = monthly();
    assert.equal(sub.graceEndsAt, sub.expiresAt + 7 * DAY);
  });

  it('records the reference that paid for the period', () => {
    // Support needs to answer "which payment bought this?" without trawling
    // the payments collection.
    assert.equal(monthly().lastPaymentReference, 'ref-1');
  });
});

describe('upgrading (client decision 4: no proration)', () => {
  it('monthly to yearly gives a full 365 days from the upgrade date', () => {
    const upgradeAt = T0 + 10 * DAY; // 20 days still unused
    const upgraded = activate('yearly', 'ref-3', upgradeAt);

    assert.equal(upgraded.expiresAt, upgradeAt + 365 * DAY);
    assert.equal(upgraded.plan, 'yearly');
  });

  it('an early renewal does not stack unused time', () => {
    // `now + duration`, never `expiresAt + duration`. Stacking would let a
    // dealer renew daily and accumulate years — and it is the client's stated
    // rule that the clock restarts.
    const renewAt = T0 + 5 * DAY;
    assert.equal(activate('monthly', 'ref-4', renewAt).expiresAt, renewAt + 30 * DAY);
  });
});

describe('status is derived from time, not trusted', () => {
  it('active up to the last millisecond', () => {
    const sub = monthly();
    assert.equal(statusAt(sub, sub.expiresAt - 1), 'active');
  });

  it('grace begins exactly at expiry', () => {
    const sub = monthly();
    assert.equal(statusAt(sub, sub.expiresAt), 'grace');
  });

  it('still grace one millisecond before it ends', () => {
    const sub = monthly();
    assert.equal(statusAt(sub, sub.graceEndsAt - 1), 'grace');
  });

  it('expired exactly when grace ends', () => {
    const sub = monthly();
    assert.equal(statusAt(sub, sub.graceEndsAt), 'expired');
  });

  it('a free store is never anything but none', () => {
    assert.equal(statusAt(freeSubscription(), T0 + 1000 * DAY), 'none');
  });

  it('ignores a stale stored status', () => {
    // The whole reason this is derived. The nightly sweep writes `status`, so
    // between expiry and the next run the document still says 'active' — and
    // publishing is exactly where that gap would be exploited.
    const stale = { ...monthly(), status: 'active' };
    assert.equal(statusAt(stale, stale.expiresAt + 8 * DAY), 'expired');
  });
});

describe('entitlement ceiling', () => {
  it('paid plans get the fair-use limit while active', () => {
    assert.equal(limitFor(monthly(), T0), 200);
  });

  it('grace keeps listings live — a Friday lapse must not clear the shelves', () => {
    const sub = monthly();
    assert.equal(limitFor(sub, sub.expiresAt + DAY), 200);
    assert.equal(isEntitled(sub, sub.expiresAt + DAY), true);
  });

  it('drops to the free limit once grace ends', () => {
    const sub = monthly();
    assert.equal(limitFor(sub, sub.graceEndsAt), 10);
    assert.equal(isEntitled(sub, sub.graceEndsAt), false);
  });

  it('a store that never paid gets the free limit', () => {
    assert.equal(limitFor(freeSubscription(), T0), 10);
  });
});

describe('reading a stored store document', () => {
  it('converts Firestore timestamps', () => {
    const sub = fromStore({
      subscription: {
        plan: 'monthly',
        status: 'active',
        startedAt: { toMillis: () => T0 },
        expiresAt: { toMillis: () => T0 + 30 * DAY },
        graceEndsAt: { toMillis: () => T0 + 37 * DAY },
        lastPaymentReference: 'ref-1',
      },
    });

    assert.equal(sub.expiresAt, T0 + 30 * DAY);
    assert.equal(statusAt(sub, T0 + 31 * DAY), 'grace');
  });

  it('degrades a missing subscription to free rather than throwing', () => {
    // This runs inside a payment transaction. Throwing there would fail the
    // charge for a store whose document is merely older than the feature.
    assert.equal(fromStore(undefined).plan, 'free');
    assert.equal(fromStore({}).plan, 'free');
    assert.equal(limitFor(fromStore({ subscription: {} }), T0), 10);
  });
});

describe('which listings survive expiry (client decision 3)', () => {
  const listing = (id, publishedAt, createdAt = null) => ({ id, publishedAt, createdAt });

  it('keeps nothing back when the dealer is within the free limit', () => {
    const active = Array.from({ length: 8 }, (_, i) => listing(`l${i}`, T0 + i * DAY));
    assert.deepEqual(listingsToUnpublish(active), []);
  });

  it('keeps the ten most recently published', () => {
    const active = Array.from({ length: 14 }, (_, i) => listing(`l${i}`, T0 + i * DAY));
    const unpublished = listingsToUnpublish(active);

    assert.equal(unpublished.length, 4);
    // l0..l3 are the oldest by publication date.
    assert.deepEqual(unpublished.sort(), ['l0', 'l1', 'l2', 'l3']);
  });

  it('ranks by publication, not by when the draft was written', () => {
    // A part drafted a year ago but published yesterday is current stock, and
    // a dealer judges their catalogue by what buyers can see.
    const active = [
      ...Array.from({ length: 10 }, (_, i) => listing(`new${i}`, T0 + i * DAY, T0)),
      listing('old-draft-new-publish', T0 + 100 * DAY, T0 - 365 * DAY),
    ];

    const unpublished = listingsToUnpublish(active);
    assert.ok(!unpublished.includes('old-draft-new-publish'));
  });

  it('falls back to createdAt when a listing has no publishedAt', () => {
    const active = [
      ...Array.from({ length: 10 }, (_, i) => listing(`l${i}`, T0 + (i + 5) * DAY)),
      listing('no-published-at', null, T0),
    ];

    assert.deepEqual(listingsToUnpublish(active), ['no-published-at']);
  });

  it('is deterministic when timestamps tie', () => {
    // Two runs of the sweep must not disagree about which listing survives, or
    // a dealer sees a different catalogue each night.
    const active = Array.from({ length: 12 }, (_, i) => listing(`l${i}`, T0));
    assert.deepEqual(listingsToUnpublish(active), listingsToUnpublish([...active].reverse()));
  });
});
