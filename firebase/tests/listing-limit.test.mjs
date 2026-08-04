import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * The listing-limit transaction (SOW section 5).
 *
 * These exercise the transaction directly against the Firestore emulator using
 * the Admin SDK, rather than going through the callable. That is deliberate:
 * the property under test is the *concurrency* behaviour of the transaction,
 * and driving it directly lets us fire genuinely simultaneous attempts.
 *
 * The claim being tested: two concurrent publishes cannot both succeed when
 * only one slot remains. Reading the count from the store document is what
 * makes that true — both transactions touch the same document, so Firestore
 * aborts and retries the loser. A count(*) query would let both read 9 and
 * both commit, producing 11 active listings on a free plan.
 */

const PROJECT_ID = 'demo-naija-parts-hub';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';

const FREE_LIMIT = 10;
const PAID_LIMIT = 200;

let app;
let db;

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, 'limit-tests');
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

/** Mirrors activeLimitFor() in functions/src/publishListing.ts. */
function activeLimitFor(store) {
  const { plan, status } = store.subscription;
  const paid = plan !== 'free' && (status === 'active' || status === 'grace');
  return paid ? PAID_LIMIT : FREE_LIMIT;
}

/** Mirrors the publishListing transaction body. */
async function publish(storeId, listingId) {
  return db.runTransaction(async (tx) => {
    const sRef = db.doc(`stores/${storeId}`);
    const lRef = db.doc(`listings/${listingId}`);
    const snaps = await tx.getAll(sRef, lRef);
    const store = snaps[0].data();
    const listing = snaps[1].data();

    if (!store) throw new Error('STORE_NOT_FOUND');
    if (store.status !== 'approved') throw new Error('STORE_NOT_APPROVED');
    if (!listing) throw new Error('LISTING_NOT_FOUND');
    if (listing.storeId !== storeId) throw new Error('WRONG_OWNER');

    if (listing.status === 'active') {
      return { activeListingCount: store.activeListingCount, alreadyActive: true };
    }

    const limit = activeLimitFor(store);
    const current = store.activeListingCount ?? 0;
    if (current >= limit) {
      const err = new Error('LIMIT_REACHED');
      err.limit = limit;
      err.activeListingCount = current;
      throw err;
    }

    tx.update(lRef, { status: 'active', publiclyVisible: store.visible === true });
    tx.update(sRef, { activeListingCount: current + 1 });
    return { activeListingCount: current + 1, alreadyActive: false };
  });
}

async function reset({ activeListingCount = 0, subscription, status = 'approved' } = {}) {
  const batch = db.batch();
  batch.set(db.doc('stores/dealer-1'), {
    storeId: 'dealer-1',
    status,
    visible: true,
    activeListingCount,
    subscription: subscription ?? { plan: 'free', status: 'none' },
  });
  for (let i = 0; i < 30; i++) {
    batch.set(db.doc(`listings/l${i}`), { storeId: 'dealer-1', status: 'draft', name: `Part ${i}` });
  }
  await batch.commit();
}

async function clear() {
  const cols = ['listings', 'stores'];
  for (const c of cols) {
    const snap = await db.collection(c).get();
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

beforeEach(async () => {
  await clear();
});

describe('free-tier listing limit', () => {
  it('allows publishing up to the free limit', async () => {
    await reset();
    for (let i = 0; i < FREE_LIMIT; i++) {
      const r = await publish('dealer-1', `l${i}`);
      assert.equal(r.activeListingCount, i + 1);
    }
    const store = (await db.doc('stores/dealer-1').get()).data();
    assert.equal(store.activeListingCount, FREE_LIMIT);
  });

  it('refuses the 11th active listing', async () => {
    await reset({ activeListingCount: FREE_LIMIT });
    await assert.rejects(() => publish('dealer-1', 'l0'), /LIMIT_REACHED/);
  });

  it('does not double-count a republish of an already-active listing', async () => {
    await reset();
    await publish('dealer-1', 'l0');
    const again = await publish('dealer-1', 'l0');
    assert.equal(again.alreadyActive, true);
    const store = (await db.doc('stores/dealer-1').get()).data();
    assert.equal(store.activeListingCount, 1);
  });

  it('refuses to publish when the store is not approved', async () => {
    await reset({ status: 'pending' });
    await assert.rejects(() => publish('dealer-1', 'l0'), /STORE_NOT_APPROVED/);
  });

  it('raises the ceiling for an active paid subscription', async () => {
    await reset({
      activeListingCount: FREE_LIMIT,
      subscription: { plan: 'monthly', status: 'active' },
    });
    const r = await publish('dealer-1', 'l0');
    assert.equal(r.activeListingCount, FREE_LIMIT + 1);
  });

  it('keeps the raised ceiling during the grace window', async () => {
    await reset({
      activeListingCount: FREE_LIMIT,
      subscription: { plan: 'yearly', status: 'grace' },
    });
    const r = await publish('dealer-1', 'l0');
    assert.equal(r.activeListingCount, FREE_LIMIT + 1);
  });

  it('drops back to the free ceiling once a subscription has expired', async () => {
    await reset({
      activeListingCount: FREE_LIMIT,
      subscription: { plan: 'monthly', status: 'expired' },
    });
    await assert.rejects(() => publish('dealer-1', 'l0'), /LIMIT_REACHED/);
  });
});

describe('concurrency — the reason the count lives on the store document', () => {
  it('lets only one of two simultaneous publishes take the final slot', async () => {
    await reset({ activeListingCount: FREE_LIMIT - 1 });

    const results = await Promise.allSettled([
      publish('dealer-1', 'l0'),
      publish('dealer-1', 'l1'),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    assert.equal(ok.length, 1, 'exactly one publish should win the last slot');
    assert.equal(failed.length, 1);
    assert.match(String(failed[0].reason), /LIMIT_REACHED/);

    const store = (await db.doc('stores/dealer-1').get()).data();
    assert.equal(store.activeListingCount, FREE_LIMIT);
  });

  it('never exceeds the limit under a burst of 20 simultaneous publishes', async () => {
    await reset();

    const attempts = Array.from({ length: 20 }, (_, i) => publish('dealer-1', `l${i}`));
    const results = await Promise.allSettled(attempts);

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    assert.equal(succeeded, FREE_LIMIT, `expected exactly ${FREE_LIMIT} to succeed`);

    const store = (await db.doc('stores/dealer-1').get()).data();
    assert.equal(store.activeListingCount, FREE_LIMIT);

    // Scoped to this store, not a global count. When suites share one emulator
    // instance, an unscoped query picks up listings left behind by the rules,
    // storage and e2e suites and this assertion fails for reasons that have
    // nothing to do with the limit.
    const active = await db
      .collection('listings')
      .where('storeId', '==', 'dealer-1')
      .where('status', '==', 'active')
      .get();
    assert.equal(active.size, FREE_LIMIT, 'stored active listings must match the counter');
  });
});
