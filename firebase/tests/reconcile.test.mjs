import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

import { emulatorTarget } from './helpers.mjs';

/**
 * reconcilePendingPayments — the third confirmation path.
 *
 * A payment is normally settled by Paystack's webhook or by the dealer's
 * browser returning to the callback. Neither is guaranteed: a dealer can close
 * the tab on Paystack's success screen, and a webhook can be misconfigured or
 * blocked. When both miss, the record stays `pending` while Paystack has taken
 * the money — and nothing flags it, because the admin console's "needs
 * attention" filter looks for `success` without an activation.
 *
 * That is not a hypothetical: two ₦50,000 sandbox transactions did exactly this
 * during local testing, and were only noticed because someone asked Paystack
 * directly. These tests are the mechanism that asks automatically.
 *
 * The Paystack client is replaced with a fake through `setPaystackClient`, so
 * every branch — success, abandoned, wrong amount, API failure — is exercised
 * with no network and no key.
 */

const PROJECT_ID = 'demo-naija-parts-hub';
const FIRESTORE = emulatorTarget('FIRESTORE_EMULATOR_HOST', 8080);

process.env.FIRESTORE_EMULATOR_HOST ??= `${FIRESTORE.host}:${FIRESTORE.port}`;
process.env.GCLOUD_PROJECT ??= PROJECT_ID;

const STORE_ID = 'rec-dealer';
const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = 1_760_000_000_000;

let app;
let db;
let reconcilePendingPayments;
let setPaystackClient;

/** Answers whatever the test told it to, and counts the calls. */
function fakePaystack(responses) {
  const calls = [];
  return {
    calls,
    client: {
      async initializeTransaction() {
        throw new Error('not used by reconciliation');
      },
      async verifyTransaction(reference) {
        calls.push(reference);
        const answer = responses[reference];
        if (!answer) throw new Error(`no fake response for ${reference}`);
        if (answer instanceof Error) throw answer;
        return {
          status: answer.status,
          reference,
          amountKobo: answer.amountKobo ?? 500_000,
          channel: 'card',
          currency: 'NGN',
          paidAt: '2026-08-12T12:00:00.000Z',
          raw: { reference, status: answer.status, amount: answer.amountKobo ?? 500_000 },
        };
      },
    },
  };
}

async function seedStore() {
  await db.doc(`stores/${STORE_ID}`).set({
    storeId: STORE_ID,
    businessName: 'Ladipo Auto Spares',
    status: 'approved',
    visible: true,
    activeListingCount: 0,
    subscription: { plan: 'free', status: 'none' },
  });
}

/** A payment left pending, [ageMs] old. */
async function seedPending(reference, ageMs, overrides = {}) {
  await db.doc(`payments/${reference}`).set({
    reference,
    storeId: STORE_ID,
    plan: 'monthly',
    amountKobo: 500_000,
    status: 'pending',
    paystackStatus: null,
    channel: null,
    initializedAt: Timestamp.fromMillis(NOW - ageMs),
    verifiedAt: null,
    verifiedVia: null,
    subscriptionAppliedAt: null,
    raw: null,
    ...overrides,
  });
}

before(async () => {
  app = initializeApp({ projectId: PROJECT_ID });
  db = getFirestore(app);
  ({ reconcilePendingPayments } = await import('../../functions/lib/reconcilePayments.js'));
  ({ setPaystackClient } = await import('../../functions/lib/lib/paystack.js'));
});

after(async () => {
  setPaystackClient(null);
  await deleteApp(app);
});

beforeEach(async () => {
  setPaystackClient(null);
  for (const c of ['stores', 'payments']) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await seedStore();
});

describe('a payment neither path reported', () => {
  it('is activated from Paystack directly', async () => {
    // The failure this exists for: money taken, subscription never granted,
    // and no signal anywhere that it happened.
    await seedPending('nph-stuck', 2 * HOUR);
    const fake = fakePaystack({ 'nph-stuck': { status: 'success' } });
    setPaystackClient(fake.client);

    const result = await reconcilePendingPayments(NOW);

    assert.equal(result.checked, 1);
    assert.equal(result.applied, 1);

    const sub = (await db.doc(`stores/${STORE_ID}`).get()).data().subscription;
    assert.equal(sub.plan, 'monthly');
    assert.equal(sub.expiresAt.toMillis(), NOW + 30 * DAY);
  });

  it('records that reconciliation is what settled it', async () => {
    // Distinct from webhook and callback on purpose: a payment that only ever
    // settles this way means the webhook is not being delivered, and that is
    // worth being able to see in the admin console.
    await seedPending('nph-stuck', 2 * HOUR);
    setPaystackClient(fakePaystack({ 'nph-stuck': { status: 'success' } }).client);

    await reconcilePendingPayments(NOW);

    const payment = (await db.doc('payments/nph-stuck').get()).data();
    assert.equal(payment.verifiedVia, 'reconciliation');
    assert.equal(payment.status, 'success');
    assert.ok(payment.subscriptionAppliedAt);
  });
});

describe('what it leaves alone', () => {
  it('ignores a payment younger than the stale threshold', async () => {
    // The webhook and callback are usually seconds. Checking immediately would
    // race them and spend a Paystack call on every single transaction.
    await seedPending('nph-fresh', 5 * 60_000);
    const fake = fakePaystack({});
    setPaystackClient(fake.client);

    const result = await reconcilePendingPayments(NOW);

    assert.equal(result.checked, 0);
    assert.deepEqual(fake.calls, [], 'Paystack must not be asked about a fresh payment');
  });

  it('ignores payments that are already settled', async () => {
    await seedPending('nph-done', 5 * HOUR, {
      status: 'success',
      subscriptionAppliedAt: Timestamp.fromMillis(NOW - 4 * HOUR),
    });
    const fake = fakePaystack({});
    setPaystackClient(fake.client);

    assert.equal((await reconcilePendingPayments(NOW)).checked, 0);
    assert.deepEqual(fake.calls, []);
  });

  it('does not grant a second period for an already-applied reference', async () => {
    // Belt and braces against the query and the guard disagreeing: the
    // transaction refuses regardless.
    await seedPending('nph-applied', 3 * HOUR, {
      subscriptionAppliedAt: Timestamp.fromMillis(NOW - 2 * HOUR),
    });
    setPaystackClient(fakePaystack({ 'nph-applied': { status: 'success' } }).client);

    const result = await reconcilePendingPayments(NOW);

    assert.equal(result.applied, 0, 'an applied payment must not be applied again');
    assert.equal((await db.doc(`stores/${STORE_ID}`).get()).data().subscription.plan, 'free');
  });
});

describe('payments that were never completed', () => {
  it('settles an abandoned checkout so it stops claiming to be pending', async () => {
    // Otherwise every abandoned attempt reads "Awaiting payment" in the
    // dealer's history forever, and three tries before a success look like
    // three outstanding charges.
    await seedPending('nph-abandoned', 2 * HOUR);
    setPaystackClient(fakePaystack({ 'nph-abandoned': { status: 'abandoned' } }).client);

    const result = await reconcilePendingPayments(NOW);

    assert.equal(result.settled, 1);
    assert.equal(result.applied, 0);
    assert.equal((await db.doc('payments/nph-abandoned').get()).data().status, 'abandoned');
  });

  it('settles a failed transaction without granting anything', async () => {
    await seedPending('nph-failed', 2 * HOUR);
    setPaystackClient(fakePaystack({ 'nph-failed': { status: 'failed' } }).client);

    await reconcilePendingPayments(NOW);

    assert.equal((await db.doc('payments/nph-failed').get()).data().status, 'failed');
    assert.equal((await db.doc(`stores/${STORE_ID}`).get()).data().subscription.plan, 'free');
  });

  it('refuses a successful charge for the wrong amount', async () => {
    // Reconciliation must not become a way around the amount check.
    await seedPending('nph-wrong', 2 * HOUR);
    setPaystackClient(
      fakePaystack({ 'nph-wrong': { status: 'success', amountKobo: 100 } }).client,
    );

    const result = await reconcilePendingPayments(NOW);

    assert.equal(result.applied, 0);
    assert.equal((await db.doc(`stores/${STORE_ID}`).get()).data().subscription.plan, 'free');
    // Recorded as successful, because it was — the dealer's money moved.
    // subscriptionAppliedAt staying null is what marks it unhonoured.
    const payment = (await db.doc('payments/nph-wrong').get()).data();
    assert.equal(payment.status, 'success');
    assert.equal(payment.subscriptionAppliedAt, null);
  });
});

describe('when Paystack is unreachable', () => {
  it('leaves the payment pending so the next run retries it', async () => {
    await seedPending('nph-error', 2 * HOUR);
    setPaystackClient(fakePaystack({ 'nph-error': new Error('gateway timeout') }).client);

    const result = await reconcilePendingPayments(NOW);

    assert.equal(result.failed, 1);
    assert.equal(result.applied, 0);
    // Still pending, deliberately. Marking it failed on a transient outage
    // would tell a dealer their payment did not work when it may well have.
    assert.equal((await db.doc('payments/nph-error').get()).data().status, 'pending');
  });

  it('one bad reference does not stop the others', async () => {
    await seedPending('nph-a', 3 * HOUR);
    await seedPending('nph-b', 2 * HOUR);
    setPaystackClient(
      fakePaystack({
        'nph-a': new Error('gateway timeout'),
        'nph-b': { status: 'success' },
      }).client,
    );

    const result = await reconcilePendingPayments(NOW);

    assert.equal(result.checked, 2);
    assert.equal(result.failed, 1);
    assert.equal(result.applied, 1);
    assert.equal((await db.doc(`stores/${STORE_ID}`).get()).data().subscription.plan, 'monthly');
  });
});
