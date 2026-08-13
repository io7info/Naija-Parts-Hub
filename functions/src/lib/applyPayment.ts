import type { Payment, SubscriptionPlan } from '@nph/contracts';
import { COL, Timestamp, db } from './admin';
import { activate, fromStore } from './subscription';
import type { VerifyResult } from './paystack';

/**
 * Turning a verified Paystack transaction into subscription time.
 *
 * One function, shared by both paths that can confirm a payment — the browser
 * returning from checkout, and Paystack's webhook. They race by design:
 * whichever arrives first activates, and the other must be a no-op rather than
 * a second month.
 *
 * Everything happens inside a Firestore transaction over `payments/{reference}`
 * and the store document. The document id *is* the Paystack reference, so a
 * replay cannot create a second payment record — and the transaction re-reads
 * `subscriptionAppliedAt` under lock, which is what makes "already applied"
 * a fact rather than a guess. Checking before the transaction would let two
 * concurrent confirmations both read `null` and both grant a period.
 *
 * SOW §8: "duplicate-payment prevention".
 */

export type ApplyOutcome =
  | { applied: true; plan: Exclude<SubscriptionPlan, 'free'>; expiresAt: number }
  /** Already applied, or not a success — either way, nothing changed. */
  | { applied: false; reason: 'already-applied' | 'not-successful' | 'amount-mismatch' | 'unknown-reference' };

export async function applyVerifiedPayment(
  verification: VerifyResult,
  // 'reconciliation' is the hourly job asking Paystack directly when neither
  // fast path reported back. Same activation, different provenance — and a
  // payment that only ever settles that way means the webhook is not arriving.
  via: 'webhook' | 'callback' | 'reconciliation',
  now: number = Date.now(),
): Promise<ApplyOutcome> {
  const paymentRef = db.collection(COL.payments).doc(verification.reference);

  return db.runTransaction(async (tx) => {
    const paymentSnap = await tx.get(paymentRef);

    // Every reference we would honour was written by initializePayment before
    // the dealer was sent to Paystack. An unknown one is either a webhook for
    // another Paystack account sharing the endpoint, or someone guessing.
    if (!paymentSnap.exists) {
      return { applied: false, reason: 'unknown-reference' } as const;
    }

    const payment = paymentSnap.data() as Payment;

    // The replay guard. Read inside the transaction, so two confirmations
    // arriving together serialise and the loser sees the winner's write.
    if (payment.subscriptionAppliedAt) {
      return { applied: false, reason: 'already-applied' } as const;
    }

    const successful = verification.status === 'success';

    // Amount is compared against what *we* asked for, not against the plan
    // price directly: the payment record captured the price at initialization,
    // so a later price change cannot retroactively invalidate a transaction a
    // dealer already paid.
    const amountMatches = verification.amountKobo === payment.amountKobo;

    if (!successful || !amountMatches) {
      // Recorded rather than silently dropped. A mismatch is the signature of
      // a tampered callback, and support needs to see it happened at all.
      //
      // The status stored is Paystack's own, even when the amount is wrong: a
      // mismatched-but-successful charge really did take the dealer's money,
      // and writing 'failed' there would tell support the opposite. What marks
      // it as unhonoured is `subscriptionAppliedAt` staying null — "paid but
      // not applied" is exactly the anomaly worth surfacing.
      tx.update(paymentRef, {
        status: mapStatus(verification.status),
        paystackStatus: verification.status,
        channel: verification.channel,
        verifiedAt: Timestamp.fromMillis(now),
        verifiedVia: via,
        raw: trim(verification.raw),
      });
      return {
        applied: false,
        reason: successful ? 'amount-mismatch' : 'not-successful',
      } as const;
    }

    const storeRef = db.collection(COL.stores).doc(payment.storeId);
    const storeSnap = await tx.get(storeRef);
    if (!storeSnap.exists) {
      // The dealer deleted their account mid-checkout. Refunds are outside
      // Phase 1, so the payment is recorded as successful and left unapplied
      // for a human to resolve.
      tx.update(paymentRef, {
        status: 'success',
        paystackStatus: verification.status,
        verifiedAt: Timestamp.fromMillis(now),
        verifiedVia: via,
        raw: trim(verification.raw),
      });
      return { applied: false, reason: 'unknown-reference' } as const;
    }

    // The current subscription is passed so a same-plan renewal appends to the
    // time already paid for rather than resetting the clock.
    const next = activate(
      payment.plan,
      verification.reference,
      now,
      fromStore(storeSnap.data() as never),
    );

    tx.update(storeRef, {
      subscription: {
        plan: next.plan,
        status: next.status,
        startedAt: Timestamp.fromMillis(next.startedAt!),
        expiresAt: Timestamp.fromMillis(next.expiresAt!),
        graceEndsAt: Timestamp.fromMillis(next.graceEndsAt!),
        lastPaymentReference: next.lastPaymentReference,
      },
      updatedAt: Timestamp.fromMillis(now),
    });

    tx.update(paymentRef, {
      status: 'success',
      paystackStatus: verification.status,
      channel: verification.channel,
      verifiedAt: Timestamp.fromMillis(now),
      verifiedVia: via,
      subscriptionAppliedAt: Timestamp.fromMillis(now),
      raw: trim(verification.raw),
    });

    // Note what is deliberately absent: nothing republishes the listings an
    // earlier lapse unpublished. They are drafts now, and which ones come back
    // is the dealer's decision — the app cannot know which ten of two hundred
    // they want live, and guessing wrong is worse than asking.
    return { applied: true, plan: payment.plan, expiresAt: next.expiresAt! } as const;
  });
}

/** Paystack's status vocabulary onto ours. */
function mapStatus(paystackStatus: string): Payment['status'] {
  switch (paystackStatus) {
    case 'success':
      return 'success';
    case 'abandoned':
      return 'abandoned';
    default:
      return 'failed';
  }
}

/**
 * The slice of Paystack's payload worth keeping.
 *
 * Their verify response embeds the full customer object and, depending on
 * channel, card metadata. Storing it verbatim would put a bank name, card bin
 * and last four digits into a document the dealer can read — data we have no
 * reason to hold and every reason not to. These fields are what reconciliation
 * actually needs.
 */
function trim(raw: Record<string, unknown>): Record<string, unknown> {
  const keep = ['id', 'domain', 'status', 'reference', 'amount', 'currency', 'channel', 'paid_at', 'created_at', 'gateway_response'];
  const out: Record<string, unknown> = {};
  for (const key of keep) {
    if (raw[key] !== undefined) out[key] = raw[key];
  }
  return out;
}
