import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

import { emulatorTarget } from './helpers.mjs';

/**
 * applyVerifiedPayment — where a payment becomes subscription time.
 *
 * Driven directly against the Firestore emulator rather than through the
 * callables, because the properties that matter are transactional, not
 * HTTP-shaped: a replayed reference must not grant a second month, a tampered
 * amount must not grant anything, and two confirmations racing must produce one
 * activation. Calling the function itself makes those assertable without a
 * functions emulator, without Paystack, and without any API key — the
 * verification result is just an object.
 *
 * The Paystack round trip is the one thing not covered here. It is two HTTP
 * requests behind an interface, and it is what the sandbox run with real test
 * keys will exercise.
 */

const PROJECT_ID = 'demo-naija-parts-hub';
const FIRESTORE = emulatorTarget('FIRESTORE_EMULATOR_HOST', 8080);

process.env.FIRESTORE_EMULATOR_HOST ??= `${FIRESTORE.host}:${FIRESTORE.port}`;
process.env.GCLOUD_PROJECT ??= PROJECT_ID;

const STORE_ID = 'pay-dealer';
const DAY = 86_400_000;
const T0 = 1_760_000_000_000;

let app;
let db;
let applyVerifiedPayment;

/** A Paystack verify response, as our client would have normalised it. */
function verification(overrides = {}) {
  return {
    status: 'success',
    reference: 'nph-ref-1',
    amountKobo: 500_000,
    channel: 'card',
    currency: 'NGN',
    paidAt: '2026-08-10T12:00:00.000Z',
    raw: {
      id: 12345,
      status: 'success',
      reference: 'nph-ref-1',
      amount: 500_000,
      gateway_response: 'Successful',
      // Deliberately present: the trim step must drop it.
      customer: { email: 'dealer@example.com', phone: '+2348031234567' },
      authorization: { bin: '408408', last4: '4081', bank: 'TEST BANK' },
    },
    ...overrides,
  };
}

async function seedStore(subscription = { plan: 'free', status: 'none' }) {
  await db.doc(`stores/${STORE_ID}`).set({
    storeId: STORE_ID,
    businessName: 'Ladipo Auto Spares',
    ownerName: 'Tinuoye Adeyemi',
    phone: '+2349053114741',
    status: 'approved',
    visible: true,
    activeListingCount: 0,
    subscription,
  });
}

async function seedPayment(reference, overrides = {}) {
  await db.doc(`payments/${reference}`).set({
    reference,
    storeId: STORE_ID,
    plan: 'monthly',
    amountKobo: 500_000,
    status: 'pending',
    paystackStatus: null,
    channel: null,
    initializedAt: Timestamp.fromMillis(T0),
    verifiedAt: null,
    verifiedVia: null,
    subscriptionAppliedAt: null,
    raw: null,
    ...overrides,
  });
}

before(async () => {
  // The DEFAULT app, deliberately unnamed. functions/lib/lib/admin.js calls
  // getFirestore() on the default app at module load, guarded by
  // getApps().length === 0 — so a named app here satisfies the guard without
  // creating the app the module then asks for.
  app = initializeApp({ projectId: PROJECT_ID });
  db = getFirestore(app);
  ({ applyVerifiedPayment } = await import('../../functions/lib/lib/applyPayment.js'));
});

after(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  for (const c of ['stores', 'payments']) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
});

describe('a successful payment grants exactly one period', () => {
  it('activates the plan and stamps the expiry', async () => {
    await seedStore();
    await seedPayment('nph-ref-1');

    const outcome = await applyVerifiedPayment(verification(), 'callback', T0);

    assert.equal(outcome.applied, true);
    assert.equal(outcome.plan, 'monthly');

    const sub = (await db.doc(`stores/${STORE_ID}`).get()).data().subscription;
    assert.equal(sub.plan, 'monthly');
    assert.equal(sub.status, 'active');
    assert.equal(sub.expiresAt.toMillis(), T0 + 30 * DAY);
    assert.equal(sub.graceEndsAt.toMillis(), T0 + 37 * DAY);
    assert.equal(sub.lastPaymentReference, 'nph-ref-1');
  });

  it('marks the payment applied so a replay can see it', async () => {
    await seedStore();
    await seedPayment('nph-ref-1');
    await applyVerifiedPayment(verification(), 'webhook', T0);

    const payment = (await db.doc('payments/nph-ref-1').get()).data();
    assert.equal(payment.status, 'success');
    assert.equal(payment.verifiedVia, 'webhook');
    assert.ok(payment.subscriptionAppliedAt);
  });

  it('a yearly plan runs 365 days', async () => {
    await seedStore();
    await seedPayment('nph-ref-1', { plan: 'yearly', amountKobo: 5_000_000 });

    await applyVerifiedPayment(verification({ amountKobo: 5_000_000 }), 'callback', T0);

    const sub = (await db.doc(`stores/${STORE_ID}`).get()).data().subscription;
    assert.equal(sub.expiresAt.toMillis(), T0 + 365 * DAY);
  });
});

describe('duplicate-payment prevention (SOW §8)', () => {
  it('a replayed reference does not extend the subscription', async () => {
    // The bug that costs real money: Paystack retries webhooks, and the browser
    // callback confirms the same transaction independently. Applying twice
    // would silently give sixty days for one payment.
    await seedStore();
    await seedPayment('nph-ref-1');

    const first = await applyVerifiedPayment(verification(), 'webhook', T0);
    const second = await applyVerifiedPayment(verification(), 'callback', T0 + 1000);

    assert.equal(first.applied, true);
    assert.equal(second.applied, false);
    assert.equal(second.reason, 'already-applied');

    const sub = (await db.doc(`stores/${STORE_ID}`).get()).data().subscription;
    assert.equal(sub.expiresAt.toMillis(), T0 + 30 * DAY, 'expiry must not move');
  });

  it('the webhook and the callback racing produce one activation', async () => {
    await seedStore();
    await seedPayment('nph-ref-1');

    // Fired together. The transaction is what serialises them; a check outside
    // it would let both read subscriptionAppliedAt as null and both activate.
    const outcomes = await Promise.all([
      applyVerifiedPayment(verification(), 'webhook', T0),
      applyVerifiedPayment(verification(), 'callback', T0),
    ]);

    assert.equal(outcomes.filter((o) => o.applied).length, 1, 'exactly one must apply');

    const sub = (await db.doc(`stores/${STORE_ID}`).get()).data().subscription;
    assert.equal(sub.expiresAt.toMillis(), T0 + 30 * DAY);
  });

  it('a second, genuinely new payment appends a further period', async () => {
    // Renewal must still work, and renewing early must not cost the dealer the
    // days they had already paid for: the new period starts where the old one
    // ended, not at the moment of payment.
    await seedStore();
    await seedPayment('nph-ref-1');
    await applyVerifiedPayment(verification(), 'callback', T0);

    await seedPayment('nph-ref-2');
    await applyVerifiedPayment(verification({ reference: 'nph-ref-2' }), 'callback', T0 + 20 * DAY);

    const sub = (await db.doc(`stores/${STORE_ID}`).get()).data().subscription;
    assert.equal(sub.expiresAt.toMillis(), T0 + 60 * DAY, 'two months bought, two months given');
    assert.equal(sub.lastPaymentReference, 'nph-ref-2');
  });

  it('upgrading to yearly restarts from the upgrade date', async () => {
    // The client's rule: 365 days from the upgrade, absorbing the unused
    // monthly remainder rather than adding it.
    await seedStore();
    await seedPayment('nph-ref-1');
    await applyVerifiedPayment(verification(), 'callback', T0);

    await seedPayment('nph-ref-2', { plan: 'yearly', amountKobo: 5_000_000 });
    const upgradeAt = T0 + 10 * DAY;
    await applyVerifiedPayment(
      verification({ reference: 'nph-ref-2', amountKobo: 5_000_000 }),
      'callback',
      upgradeAt,
    );

    const sub = (await db.doc(`stores/${STORE_ID}`).get()).data().subscription;
    assert.equal(sub.plan, 'yearly');
    assert.equal(sub.expiresAt.toMillis(), upgradeAt + 365 * DAY);
  });
});

describe('a payment we will not honour', () => {
  it('refuses an amount that does not match what we asked for', async () => {
    // The attack: intercept the callback and claim a ₦5,000 payment bought the
    // ₦50,000 yearly plan.
    await seedStore();
    await seedPayment('nph-ref-1', { plan: 'yearly', amountKobo: 5_000_000 });

    const outcome = await applyVerifiedPayment(verification({ amountKobo: 500_000 }), 'callback', T0);

    assert.equal(outcome.applied, false);
    assert.equal(outcome.reason, 'amount-mismatch');
    assert.equal((await db.doc(`stores/${STORE_ID}`).get()).data().subscription.plan, 'free');
  });

  it('records a mismatched charge as successful, because it was', async () => {
    // The dealer's money did move. Writing 'failed' would tell support the
    // opposite; subscriptionAppliedAt staying null is what marks it unhonoured.
    await seedStore();
    await seedPayment('nph-ref-1', { amountKobo: 5_000_000 });
    await applyVerifiedPayment(verification({ amountKobo: 500_000 }), 'callback', T0);

    const payment = (await db.doc('payments/nph-ref-1').get()).data();
    assert.equal(payment.status, 'success');
    assert.equal(payment.subscriptionAppliedAt, null);
  });

  it('refuses a failed transaction', async () => {
    await seedStore();
    await seedPayment('nph-ref-1');

    const outcome = await applyVerifiedPayment(verification({ status: 'failed' }), 'webhook', T0);

    assert.equal(outcome.applied, false);
    assert.equal(outcome.reason, 'not-successful');
    assert.equal((await db.doc('payments/nph-ref-1').get()).data().status, 'failed');
  });

  it('refuses an abandoned transaction and keeps Paystack\'s wording', async () => {
    await seedStore();
    await seedPayment('nph-ref-1');
    await applyVerifiedPayment(verification({ status: 'abandoned' }), 'webhook', T0);

    assert.equal((await db.doc('payments/nph-ref-1').get()).data().status, 'abandoned');
  });

  it('refuses a reference we never issued', async () => {
    // A webhook for another Paystack account sharing the endpoint, or someone
    // guessing. Nothing exists to apply it to.
    await seedStore();

    const outcome = await applyVerifiedPayment(verification({ reference: 'not-ours' }), 'webhook', T0);
    assert.equal(outcome.applied, false);
    assert.equal(outcome.reason, 'unknown-reference');
  });

  it('does not activate a store that no longer exists', async () => {
    // Account deleted mid-checkout. The payment is recorded as successful and
    // left for a human, since refunds are outside Phase 1.
    await seedPayment('nph-ref-1');

    const outcome = await applyVerifiedPayment(verification(), 'webhook', T0);

    assert.equal(outcome.applied, false);
    const payment = (await db.doc('payments/nph-ref-1').get()).data();
    assert.equal(payment.status, 'success');
    assert.equal(payment.subscriptionAppliedAt, null);
  });
});

describe('what is stored from Paystack', () => {
  it('keeps the fields reconciliation needs', async () => {
    await seedStore();
    await seedPayment('nph-ref-1');
    await applyVerifiedPayment(verification(), 'callback', T0);

    const raw = (await db.doc('payments/nph-ref-1').get()).data().raw;
    assert.equal(raw.reference, 'nph-ref-1');
    assert.equal(raw.amount, 500_000);
    assert.equal(raw.gateway_response, 'Successful');
  });

  it('drops the customer and card metadata', async () => {
    // Dealers can read their own payment documents. Paystack's verify response
    // carries the card bin, last four and bank name; none of that has any
    // reason to be stored, and storing it makes this collection sensitive.
    await seedStore();
    await seedPayment('nph-ref-1');
    await applyVerifiedPayment(verification(), 'callback', T0);

    const raw = (await db.doc('payments/nph-ref-1').get()).data().raw;
    assert.equal(raw.customer, undefined);
    assert.equal(raw.authorization, undefined);
    assert.ok(!JSON.stringify(raw).includes('4081'));
    assert.ok(!JSON.stringify(raw).includes('TEST BANK'));
  });
});
