import { randomBytes, randomUUID } from 'node:crypto';
import { onCall } from 'firebase-functions/v2/https';
import { onRequest } from 'firebase-functions/v2/https';
import {
  DEALER_EMAIL_DOMAIN,
  ERROR_CODE,
  HANDLED_PAYSTACK_EVENTS,
  PLANS,
  type InitializePaymentRequest,
  type InitializePaymentResponse,
  type Store,
  type VerifyPaymentRequest,
  type VerifyPaymentResponse,
} from '@nph/contracts';
import { COL, Timestamp, db, storeRef } from './lib/admin';
import { fail, requireAuth, requireOneOf } from './lib/guards';
import { applyVerifiedPayment } from './lib/applyPayment';
import { gaAttribution } from './lib/gaAttribution';
import { fromStore, isEntitled } from './lib/subscription';
import { billingUrl, siteOrigin } from './lib/site';
import {
  PAYSTACK_SECRET_KEY,
  PAYSTACK_SIGNATURE_HEADER,
  PaystackError,
  paystackClient,
  paystackSecret,
  verifyWebhookSignature,
} from './lib/paystack';

/**
 * Paystack subscription payments (SOW §8).
 *
 * Three entry points, and the asymmetry between them is the design:
 *
 *   initializePayment  dealer-authenticated. Creates the payment record and
 *                      hands back a Paystack-hosted checkout URL. No card data
 *                      ever touches our code or our clients.
 *   verifyPayment      dealer-authenticated. The browser coming back from
 *                      checkout, asking what happened.
 *   paystackWebhook    unauthenticated by necessity — Paystack has no account
 *                      here. Trust comes from an HMAC over the raw body.
 *
 * The last two both confirm the same transaction and will race. Both funnel
 * into applyVerifiedPayment, which is idempotent under a Firestore transaction,
 * so whichever loses is a no-op rather than a second month.
 */

/**
 * A reference we will recognise later.
 *
 * Prefixed so a human scanning the Paystack dashboard can tell our traffic from
 * anything else on the same account, and random rather than sequential so one
 * reference reveals nothing about another. This becomes the Firestore document
 * id, which is what makes duplicate payments impossible rather than merely
 * unlikely.
 */
function newReference(): string {
  return `nph-${Date.now().toString(36)}-${randomBytes(8).toString('hex')}`;
}

/**
 * Paystack requires an email; dealers register with a phone number.
 *
 * Their business email if they gave one, and a per-store address otherwise.
 * The synthetic form is deliberately routable-looking but unused — Paystack
 * only needs a syntactically valid address to key the customer record, and
 * inventing something that could collide with a real inbox would be worse.
 */
function customerEmail(storeId: string, store: Store): string {
  const email = store.email?.trim();
  return email && email.includes('@') ? email : `store-${storeId}@${DEALER_EMAIL_DOMAIN}`;
}

/**
 * Builds the return URL from a caller-supplied path.
 *
 * The origin is fixed server-side and the caller may only influence the path.
 * Accepting a full URL would make this an open redirect: an attacker sends a
 * dealer to a real Paystack checkout that returns them to a page the attacker
 * controls, which is a convincing place to ask for a password.
 */
function callbackUrl(path: string | undefined): string {
  if (!path || !path.startsWith('/') || path.startsWith('//')) {
    return `${billingUrl()}/callback`;
  }
  return `${siteOrigin()}${path}`;
}

export const initializePayment = onCall<
  InitializePaymentRequest,
  Promise<InitializePaymentResponse>
>({ secrets: [PAYSTACK_SECRET_KEY] }, async (request) => {
  const storeId = requireAuth(request);
  const plan = requireOneOf(request.data?.plan, ['monthly', 'yearly'] as const, 'plan');

  const snap = await storeRef(storeId).get();
  if (!snap.exists) {
    fail('not-found', ERROR_CODE.STORE_NOT_APPROVED, 'Register your business first.');
  }
  const store = snap.data() as Store;

  // A pending or rejected dealer cannot publish at all, so a paid plan would
  // buy them nothing. Taking the money anyway and refusing the benefit is the
  // worst of both, and refunds are outside Phase 1.
  if (store.status !== 'approved') {
    fail(
      'failed-precondition',
      store.status === 'suspended' ? ERROR_CODE.STORE_SUSPENDED : ERROR_CODE.STORE_NOT_APPROVED,
      store.status === 'suspended'
        ? 'Your business is suspended. Contact support before subscribing.'
        : 'Your business must be approved before you can subscribe.',
    );
  }

  // No downgrade in Phase 1.
  //
  // `activate` starts a plan change from the payment date with no proration, so
  // a yearly dealer buying a monthly plan in month two would pay ₦5,000 to
  // replace 300 remaining days with 30 — silently destroying what they had
  // already bought. Refunds are outside Phase 1, so there would be no way to
  // put it right afterwards.
  //
  // The UI never offers this, but the UI is not a security boundary: this
  // callable is reachable directly with a valid dealer token. Refusing here is
  // what makes the absence of a downgrade flow a fact rather than an omission.
  const current = fromStore(store);
  if (plan === 'monthly' && current.plan === 'yearly' && isEntitled(current, Date.now())) {
    fail(
      'failed-precondition',
      ERROR_CODE.DOWNGRADE_NOT_SUPPORTED,
      'Your yearly plan is still running. Switching to monthly would end it early, ' +
        'so it is not available. Contact support if you need to change plan.',
    );
  }

  const amountKobo = PLANS[plan].priceKobo;
  const reference = newReference();

  // Written before Paystack is called, not after. The webhook can arrive
  // before our own HTTP response does — Paystack fires it the instant the
  // charge clears — and applyVerifiedPayment refuses references it has never
  // seen. Creating the record afterwards would drop the fastest payments.
  await db.collection(COL.payments).doc(reference).set({
    reference,
    storeId,
    plan,
    amountKobo,
    status: 'pending',
    paystackStatus: null,
    channel: null,
    initializedAt: Timestamp.now(),
    verifiedAt: null,
    verifiedVia: null,
    subscriptionAppliedAt: null,
    raw: null,
    analytics: {
      ...gaAttribution(request.data?.analytics),
      // Generated here, once, and never again for this reference. GA4
      // deduplicates `purchase` on it, so it has to survive webhook retries
      // and the callback racing them — which it does, because every later
      // path reads this document rather than making its own.
      //
      // Server-generated so a client cannot choose it, and deliberately not
      // derived from the Paystack reference: see PaymentAnalytics.
      transactionId: randomUUID(),
    },
  });

  try {
    const result = await paystackClient().initializeTransaction({
      email: customerEmail(storeId, store),
      amountKobo,
      reference,
      callbackUrl: callbackUrl(request.data?.callbackUrl),
      metadata: { storeId, plan, businessName: store.businessName },
    });

    return { reference, authorizationUrl: result.authorizationUrl, amountKobo };
  } catch (error) {
    // The record stays, marked failed. Deleting it would lose the evidence
    // that a dealer tried and could not pay, which is exactly what support
    // needs when they call to say the button is broken.
    await db.collection(COL.payments).doc(reference).update({
      status: 'failed',
      paystackStatus: error instanceof PaystackError ? error.message : 'initialization-failed',
    });

    fail(
      'unavailable',
      ERROR_CODE.PAYMENT_NOT_VERIFIED,
      'Could not reach Paystack. Please try again in a moment.',
    );
  }
});

export const verifyPayment = onCall<VerifyPaymentRequest, Promise<VerifyPaymentResponse>>(
  { secrets: [PAYSTACK_SECRET_KEY] },
  async (request) => {
    const storeId = requireAuth(request);
    const reference = request.data?.reference;
    if (typeof reference !== 'string' || !reference) {
      fail('invalid-argument', ERROR_CODE.PAYMENT_NOT_VERIFIED, 'A payment reference is required.');
    }

    const snap = await db.collection(COL.payments).doc(reference).get();
    // Ownership checked before Paystack is called: otherwise this callable is a
    // free oracle for probing whether an arbitrary reference exists.
    if (!snap.exists || (snap.data() as { storeId: string }).storeId !== storeId) {
      fail('not-found', ERROR_CODE.PAYMENT_NOT_VERIFIED, 'Payment not found.');
    }

    const verification = await paystackClient().verifyTransaction(reference);
    const outcome = await applyVerifiedPayment(verification, 'callback');

    if (outcome.applied) {
      return {
        reference,
        status: 'success',
        expiresAt: new Date(outcome.expiresAt).toISOString(),
      };
    }

    // 'already-applied' is a success from the dealer's point of view — the
    // webhook simply got there first. Reporting it as a failure would send
    // someone to support over a payment that worked.
    if (outcome.reason === 'already-applied') {
      const store = (await storeRef(storeId).get()).data() as Store | undefined;
      const expires = store?.subscription?.expiresAt as { toMillis?: () => number } | undefined;
      return {
        reference,
        status: 'success',
        expiresAt: expires?.toMillis ? new Date(expires.toMillis()).toISOString() : null,
      };
    }

    if (outcome.reason === 'amount-mismatch') {
      fail(
        'failed-precondition',
        ERROR_CODE.AMOUNT_MISMATCH,
        'The amount paid does not match the plan. Contact support with your reference.',
      );
    }

    return {
      reference,
      status: verification.status === 'success' ? 'failed' : 'pending',
      expiresAt: null,
    };
  },
);

/**
 * Paystack's server-to-server confirmation.
 *
 * `onRequest`, not `onCall`, for one reason: the signature is an HMAC over the
 * **raw** bytes, and only onRequest exposes `rawBody`. A callable parses the
 * body first, and a re-serialised payload produces a different digest — every
 * legitimate webhook would be rejected.
 *
 * Status codes carry meaning to Paystack, which retries on anything that is not
 * 2xx. So:
 *   401  bad or absent signature — the one case where a retry is pointless and
 *        the request should be visibly refused.
 *   200  everything else, including events we ignore and payments we decline
 *        to apply. A 500 on an unknown event type would have Paystack retrying
 *        it for days.
 */
export const paystackWebhook = onRequest(
  { secrets: [PAYSTACK_SECRET_KEY], cors: false },
  async (req, res) => {
    const signature = req.get(PAYSTACK_SIGNATURE_HEADER);

    if (!verifyWebhookSignature(req.rawBody, signature, paystackSecret())) {
      console.warn('paystackWebhook: rejected a request with an invalid signature.');
      res.status(401).send('invalid signature');
      return;
    }

    const event = req.body as { event?: string; data?: { reference?: string } };

    if (!HANDLED_PAYSTACK_EVENTS.includes(event?.event as never)) {
      // Acknowledged and ignored. Paystack sends transfer, refund and customer
      // events on the same endpoint; none of them mean anything here.
      res.status(200).send('ignored');
      return;
    }

    const reference = event.data?.reference;
    if (!reference) {
      res.status(200).send('no reference');
      return;
    }

    try {
      // Re-verified against Paystack rather than trusted from the payload. The
      // signature proves the message came from Paystack, but re-asking is the
      // difference between "this body claims ₦50,000" and "Paystack confirms
      // ₦50,000" — and it costs one request on a path that runs once per sale.
      const verification = await paystackClient().verifyTransaction(reference);
      const outcome = await applyVerifiedPayment(verification, 'webhook');

      console.info(
        `paystackWebhook: ${reference} -> ${outcome.applied ? 'applied' : outcome.reason}`,
      );
    } catch (error) {
      // Logged and acknowledged. Returning 500 would make Paystack retry, and
      // if the failure is our own bug it retries for days. The payment record
      // still exists and the dealer's own verify call will settle it.
      console.error(`paystackWebhook: ${reference} failed to apply`, error);
    }

    res.status(200).send('ok');
  },
);
