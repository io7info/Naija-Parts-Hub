import {
  FREE_ACTIVE_LISTING_LIMIT,
  PAID_ACTIVE_LISTING_LIMIT,
  PLANS,
  SUBSCRIPTION_GRACE_DAYS,
  type Store,
  type Subscription,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from '@nph/contracts';

/**
 * Subscription lifecycle (SOW §8), as agreed with the client:
 *
 *   1. Manual renewal. No auto-charge, no stored card, no Paystack Plans API —
 *      every payment is a one-off transaction that extends the period.
 *   2. On expiry, a 7-day grace window keeps listings live.
 *   3. After grace, the dealer returns to the 10 free active listings; the
 *      10 most recently published survive and the rest go back to draft.
 *   4. A monthly-to-yearly upgrade gives 365 days from the upgrade date, with
 *      no proration.
 *   5. Refunds are outside Phase 1.
 *
 * Pure functions, deliberately. Time arrives as a parameter rather than being
 * read from the clock, so every transition can be tested at an exact instant
 * instead of by waiting or by stubbing Date. The Firestore work that uses them
 * lives in the callables and the sweep.
 */

const DAY_MS = 86_400_000;

/** Plain millisecond epochs, so this file never depends on the Admin SDK. */
export type Instant = number;

export type SubscriptionState = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  startedAt: Instant | null;
  expiresAt: Instant | null;
  graceEndsAt: Instant | null;
  lastPaymentReference: string | null;
};

/** A store that has never paid. */
export const freeSubscription = (): SubscriptionState => ({
  plan: 'free',
  status: 'none',
  startedAt: null,
  expiresAt: null,
  graceEndsAt: null,
  lastPaymentReference: null,
});

/**
 * The subscription a successful payment produces.
 *
 * `now + durationDays`, never `expiresAt + durationDays`. Renewing early would
 * otherwise stack time the dealer has not used yet, and — per decision 4 —
 * upgrading from monthly to yearly grants a full 365 days from the upgrade
 * date rather than prorating the unused monthly remainder. That is the client's
 * choice and it favours the dealer, so the simpler rule is also the generous
 * one.
 */
export function activate(
  plan: Exclude<SubscriptionPlan, 'free'>,
  reference: string,
  now: Instant,
): SubscriptionState {
  const expiresAt = now + PLANS[plan].durationDays * DAY_MS;

  return {
    plan,
    status: 'active',
    startedAt: now,
    expiresAt,
    graceEndsAt: expiresAt + SUBSCRIPTION_GRACE_DAYS * DAY_MS,
    lastPaymentReference: reference,
  };
}

/**
 * What the subscription's status *should* be at [now].
 *
 * Derived rather than trusted. The stored `status` is only as current as the
 * last sweep, so a store whose expiry passed an hour ago still reads `active`
 * until the nightly job runs. Anything making an entitlement decision has to
 * ask this instead, or a lapsed dealer keeps a 200-listing ceiling for up to a
 * day.
 */
export function statusAt(sub: SubscriptionState, now: Instant): SubscriptionStatus {
  if (sub.plan === 'free' || sub.expiresAt === null) return 'none';
  if (now < sub.expiresAt) return 'active';

  // graceEndsAt is stored rather than recomputed, so changing the grace period
  // later does not retroactively move the deadline for anyone mid-lapse.
  const graceEnd = sub.graceEndsAt ?? sub.expiresAt + SUBSCRIPTION_GRACE_DAYS * DAY_MS;
  return now < graceEnd ? 'grace' : 'expired';
}

/** True while the paid ceiling applies — active, or inside the grace window. */
export function isEntitled(sub: SubscriptionState, now: Instant): boolean {
  const status = statusAt(sub, now);
  return status === 'active' || status === 'grace';
}

/**
 * Entitlement ceiling for a store at a given moment.
 *
 * The grace window is why `grace` counts as paid: a dealer whose plan lapses on
 * a Friday does not have their stock pulled off the marketplace over the
 * weekend before they have had a chance to renew.
 */
export function limitFor(sub: SubscriptionState, now: Instant): number {
  return isEntitled(sub, now) ? PAID_ACTIVE_LISTING_LIMIT : FREE_ACTIVE_LISTING_LIMIT;
}

/**
 * Reads a stored Firestore subscription into the plain shape above.
 *
 * Tolerates a missing or partial `subscription` map: stores created before this
 * feature existed have one, but a defensive read here is cheaper than a
 * migration, and a store that somehow lacks it must degrade to free rather
 * than throw inside a payment transaction.
 */
export function fromStore(store: Pick<Store, 'subscription'> | undefined): SubscriptionState {
  const sub = store?.subscription as Partial<Subscription> | undefined;
  if (!sub?.plan) return freeSubscription();

  return {
    plan: sub.plan,
    status: sub.status ?? 'none',
    startedAt: toInstant(sub.startedAt),
    expiresAt: toInstant(sub.expiresAt),
    graceEndsAt: toInstant(sub.graceEndsAt),
    lastPaymentReference: sub.lastPaymentReference ?? null,
  };
}

/**
 * Milliseconds from whatever shape a stored timestamp arrived in.
 *
 * `@nph/contracts` keeps `Timestamp` structural — `{seconds, nanoseconds}` —
 * so the same types can be read by firebase-admin, the web SDK and mirrored
 * into Dart. That means the compiler does not know about `toMillis()` even
 * though every value the Admin SDK hands back has one, so this checks for it
 * and falls back to the structural fields.
 */
export function toInstant(value: unknown): Instant | null {
  if (!value) return null;
  if (typeof value === 'number') return value;
  if (typeof value !== 'object') return null;

  if ('toMillis' in value && typeof (value as { toMillis: unknown }).toMillis === 'function') {
    return (value as { toMillis(): number }).toMillis();
  }
  if ('seconds' in value) {
    const { seconds, nanoseconds } = value as { seconds: number; nanoseconds?: number };
    return seconds * 1000 + Math.floor((nanoseconds ?? 0) / 1_000_000);
  }
  return null;
}

/**
 * Which listings survive when a subscription lapses (decision 3).
 *
 * The 10 most recently *published* stay active; everything else returns to
 * draft. Publication order, not creation order: a dealer judges their catalogue
 * by what buyers are currently seeing, and a part drafted last year but
 * published yesterday is current stock.
 *
 * Returns the ids to unpublish, so the caller does the writing and this stays
 * testable with plain objects.
 */
export function listingsToUnpublish(
  active: { id: string; publishedAt: Instant | null; createdAt: Instant | null }[],
  keep = FREE_ACTIVE_LISTING_LIMIT,
): string[] {
  const ranked = [...active].sort((a, b) => {
    const at = a.publishedAt ?? a.createdAt ?? 0;
    const bt = b.publishedAt ?? b.createdAt ?? 0;
    // Ties broken by id so the result is deterministic — otherwise two runs of
    // the sweep could disagree about which listing survives.
    return bt - at || a.id.localeCompare(b.id);
  });

  return ranked.slice(keep).map((l) => l.id);
}
