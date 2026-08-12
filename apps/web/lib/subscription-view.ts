import { PLANS, SUBSCRIPTION_GRACE_DAYS, type Payment, type Store } from '@nph/contracts'

/**
 * How a subscription reads to the dealer who owns it.
 *
 * Pure, and separate from the component, for the same reason the backend keeps
 * its state machine pure: every one of these states is a function of the clock,
 * and the only sane way to test "what does a dealer see three days into their
 * grace period" is to pass in that instant.
 *
 * The states mirror the backend's, deliberately, but they are not the same
 * thing: the backend cares about entitlement, this cares about what to say. A
 * dealer in grace is entitled to their full paid limit *and* needs to be told
 * their plan has lapsed — one fact, two audiences.
 */

export type SubscriptionView =
  | { state: 'free' }
  | { state: 'active'; plan: PaidPlan; expiresAt: Date; daysLeft: number }
  | { state: 'grace'; plan: PaidPlan; expiredAt: Date; graceEndsAt: Date; daysLeft: number }
  | { state: 'expired'; plan: PaidPlan; expiredAt: Date }

export type PaidPlan = 'monthly' | 'yearly'

const DAY = 86_400_000

function toDate(value: unknown): Date | null {
  if (!value) return null
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    return (value as { toDate(): Date }).toDate()
  }
  if (typeof value === 'object' && value !== null && 'seconds' in value) {
    return new Date((value as { seconds: number }).seconds * 1000)
  }
  return value instanceof Date ? value : null
}

/** Whole days remaining, never negative, rounded up so "today" reads as 1. */
function daysUntil(target: Date, now: number): number {
  return Math.max(0, Math.ceil((target.getTime() - now) / DAY))
}

export function subscriptionView(
  store: Pick<Store, 'subscription'> | null | undefined,
  now: number = Date.now(),
): SubscriptionView {
  const sub = store?.subscription
  const plan = sub?.plan
  const expiresAt = toDate(sub?.expiresAt)

  if (!plan || plan === 'free' || !expiresAt) return { state: 'free' }

  if (now < expiresAt.getTime()) {
    return { state: 'active', plan, expiresAt, daysLeft: daysUntil(expiresAt, now) }
  }

  // graceEndsAt is read rather than recomputed, so a change to the grace period
  // does not silently move the deadline for a dealer already inside one.
  const graceEndsAt =
    toDate(sub?.graceEndsAt) ?? new Date(expiresAt.getTime() + SUBSCRIPTION_GRACE_DAYS * DAY)

  if (now < graceEndsAt.getTime()) {
    return {
      state: 'grace',
      plan,
      expiredAt: expiresAt,
      graceEndsAt,
      daysLeft: daysUntil(graceEndsAt, now),
    }
  }

  return { state: 'expired', plan, expiredAt: expiresAt }
}

export const PLAN_LABEL: Record<PaidPlan, string> = {
  monthly: 'Monthly',
  yearly: 'Yearly',
}

export function planPriceNaira(plan: PaidPlan): number {
  return PLANS[plan].priceKobo / 100
}

/**
 * What a payment record means, in the dealer's terms.
 *
 * The interesting case is `needs-support`: Paystack took the money and the
 * subscription was not applied. That happens when the amount did not match what
 * was initialized, or the store vanished mid-checkout. It is rare, it is not
 * self-correcting, and a dealer must never be left thinking a successful charge
 * simply did not count — so it gets its own state rather than being folded into
 * "failed", which would be a lie about their bank statement.
 */
export type PaymentView = 'pending' | 'applied' | 'needs-support' | 'failed'

export function paymentView(payment: Pick<Payment, 'status' | 'subscriptionAppliedAt'>): PaymentView {
  if (payment.status === 'success') {
    return payment.subscriptionAppliedAt ? 'applied' : 'needs-support'
  }
  if (payment.status === 'pending') return 'pending'
  return 'failed'
}

export const PAYMENT_LABEL: Record<PaymentView, string> = {
  pending: 'Awaiting payment',
  applied: 'Paid',
  'needs-support': 'Paid — not applied',
  failed: 'Not completed',
}
