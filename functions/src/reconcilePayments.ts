import { onSchedule } from 'firebase-functions/v2/scheduler';
import { COL, Timestamp, db } from './lib/admin';
import { applyVerifiedPayment } from './lib/applyPayment';
import { PAYSTACK_SECRET_KEY, PaystackError, paystackClient } from './lib/paystack';

/**
 * Settles payments that neither confirmation path ever reported back on.
 *
 * A transaction is confirmed two ways: Paystack's webhook, and the dealer's
 * browser returning to the callback. Both usually arrive. Neither is
 * guaranteed:
 *
 *   - the dealer closes the tab on Paystack's success screen, so no callback;
 *   - the webhook is misconfigured, blocked, or pointed at the wrong URL.
 *
 * When both miss, `payments/{reference}` stays `pending` forever while Paystack
 * has taken the dealer's money. Nothing flags it — the admin console's "needs
 * attention" filter looks for `success` without an activation, and a stuck
 * record is not `success`. The dealer's own history shows "Awaiting payment"
 * for a charge that already left their account.
 *
 * That is not hypothetical. It happened in local testing: two ₦50,000
 * transactions succeeded at Paystack and sat pending, and the only reason
 * anybody noticed was that someone thought to ask Paystack directly. In
 * production it would have been a support call, if the dealer bothered.
 *
 * So this asks, hourly, on the dealer's behalf. It is also the belt to the
 * webhook's braces: if the webhook is ever broken in production, subscriptions
 * still activate — an hour late rather than never — and `verifiedVia:
 * 'reconciliation'` in the admin console is the signal that it is broken.
 */

/** Old enough that both fast paths have certainly had their chance. */
const STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * How many to settle per run.
 *
 * Each one is a Paystack API call, so an unbounded batch would turn a backlog
 * into a rate-limit problem. Anything left over is picked up next hour, and a
 * backlog this large means the webhook is down — which the log line below is
 * meant to make obvious.
 */
const MAX_PER_RUN = 50;

export type ReconcileResult = {
  checked: number;
  applied: number;
  settled: number;
  failed: number;
};

export async function reconcilePendingPayments(
  now: number = Date.now(),
): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, applied: 0, settled: 0, failed: 0 };

  const snapshot = await db
    .collection(COL.payments)
    .where('status', '==', 'pending')
    .where('initializedAt', '<', Timestamp.fromMillis(now - STALE_AFTER_MS))
    .orderBy('initializedAt', 'desc')
    .limit(MAX_PER_RUN)
    .get();

  if (snapshot.empty) return result;

  const client = paystackClient();

  for (const doc of snapshot.docs) {
    result.checked += 1;

    try {
      const verification = await client.verifyTransaction(doc.id);
      const outcome = await applyVerifiedPayment(verification, 'reconciliation', now);

      if (outcome.applied) {
        result.applied += 1;
        // Loud on purpose. A payment that only ever settles here is one the
        // webhook should have delivered and did not.
        console.warn(
          `reconcilePayments: ${doc.id} activated by reconciliation — ` +
            'neither the webhook nor the callback reported this payment.',
        );
      } else {
        // Abandoned or failed at Paystack. applyVerifiedPayment has already
        // written the real status, so the row stops claiming to be pending.
        result.settled += 1;
      }
    } catch (error) {
      // One bad reference must not stop the rest. Left pending deliberately:
      // the next run retries it, which is the right behaviour for a transient
      // Paystack outage.
      result.failed += 1;
      console.error(
        `reconcilePayments: ${doc.id} could not be verified` +
          (error instanceof PaystackError ? ` (${error.message})` : ''),
        error,
      );
    }
  }

  return result;
}

export const reconcileStalePayments = onSchedule(
  {
    // Hourly, matching the stale threshold: a payment is checked within about
    // two hours of being made, and usually much sooner because the webhook
    // handles it in seconds.
    schedule: 'every 1 hours',
    timeZone: 'Africa/Lagos',
    secrets: [PAYSTACK_SECRET_KEY],
    // No retry. Every payment left unsettled is retried next hour anyway, and
    // an immediate retry after a Paystack outage would just fail again.
    retryCount: 0,
  },
  async () => {
    const result = await reconcilePendingPayments();
    if (result.checked === 0) return;

    console.info(
      `reconcilePayments: checked ${result.checked}, activated ${result.applied}, ` +
        `settled ${result.settled}, failed ${result.failed}.`,
    );
  },
);
