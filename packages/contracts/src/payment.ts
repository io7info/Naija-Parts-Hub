import type { Kobo, Timestamp } from './common';
import type { SubscriptionPlan } from './store';

/**
 * A Paystack transaction (SOW §8).
 *
 * The document ID is the Paystack `reference`. That is the whole duplicate-
 * payment defence: a replayed webhook or a double verify cannot create a
 * second document, and activation runs inside a transaction that refuses to
 * act on a reference already marked `success`.
 *
 * Collection: `payments/{reference}`
 * Written exclusively by Cloud Functions. Dealers read their own; admins read
 * all (SOW §9, "Paystack payment-reference review").
 */

export type PaymentStatus = 'pending' | 'success' | 'failed' | 'abandoned';

export interface Payment {
  reference: string;
  storeId: string;
  plan: Exclude<SubscriptionPlan, 'free'>;

  /** What we asked Paystack to charge. Compared against the verified amount. */
  amountKobo: Kobo;
  status: PaymentStatus;

  /** Paystack's own status string, retained verbatim for support triage. */
  paystackStatus: string | null;
  /** 'card' | 'bank' | 'ussd' | 'bank_transfer' | ... as reported by Paystack. */
  channel: string | null;

  initializedAt: Timestamp;
  verifiedAt: Timestamp | null;

  /**
   * Which path confirmed the payment.
   *
   * 'webhook' and 'callback' race by design. 'reconciliation' means neither
   * arrived and the hourly job had to ask Paystack directly — which is worth
   * distinguishing, because a payment that only ever settles this way points at
   * a webhook that is not being delivered.
   */
  verifiedVia: 'webhook' | 'callback' | 'reconciliation' | null;

  /** Set when activation succeeded, so replays are trivially detectable. */
  subscriptionAppliedAt: Timestamp | null;

  /** Trimmed Paystack payload kept for reconciliation. Never surfaced publicly. */
  raw: Record<string, unknown> | null;
}

/**
 * Paystack events we act on. Every other event type is acknowledged with 200
 * and ignored — returning non-2xx would make Paystack retry indefinitely.
 */
export const HANDLED_PAYSTACK_EVENTS = ['charge.success'] as const;

/** Header carrying the HMAC-SHA512 signature of the raw request body. */
export const PAYSTACK_SIGNATURE_HEADER = 'x-paystack-signature';
