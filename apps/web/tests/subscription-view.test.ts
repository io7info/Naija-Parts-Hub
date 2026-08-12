import { describe, expect, it } from 'vitest'
import { paymentView, subscriptionView } from '../lib/subscription-view'

/**
 * What a dealer is told about their own subscription.
 *
 * Every state here is a function of the clock, so `now` is a parameter and the
 * boundaries are testable exactly rather than by waiting. The states mirror the
 * backend's but answer a different question: the backend decides entitlement,
 * this decides what to say — and a dealer in grace is simultaneously entitled
 * to their full paid limit and needs telling their plan has lapsed.
 */

const DAY = 86_400_000
const T0 = Date.UTC(2026, 7, 1)

const ts = (ms: number) => ({ toDate: () => new Date(ms) })

const paid = (plan: 'monthly' | 'yearly', expiresAt: number, graceEndsAt?: number) => ({
  subscription: {
    plan,
    status: 'active' as const,
    startedAt: ts(T0),
    expiresAt: ts(expiresAt),
    graceEndsAt: ts(graceEndsAt ?? expiresAt + 7 * DAY),
    lastPaymentReference: 'nph-1',
  },
})

describe('a store that has never paid', () => {
  it('reads as free', () => {
    expect(subscriptionView(null, T0).state).toBe('free')
    expect(subscriptionView(undefined, T0).state).toBe('free')
  })

  it('reads as free when the subscription map is present but empty', () => {
    // Older stores predate the field. Degrading to free is right; throwing on a
    // dealer's own account page is not.
    expect(subscriptionView({ subscription: {} } as never, T0).state).toBe('free')
  })

  it('reads as free when a plan is named but never actually started', () => {
    expect(
      subscriptionView({ subscription: { plan: 'monthly' } } as never, T0).state,
    ).toBe('free')
  })
})

describe('an active plan', () => {
  const store = paid('monthly', T0 + 30 * DAY)

  it('counts the days remaining', () => {
    const view = subscriptionView(store as never, T0)
    expect(view.state).toBe('active')
    if (view.state !== 'active') return
    expect(view.daysLeft).toBe(30)
    expect(view.plan).toBe('monthly')
  })

  it('still reads active one millisecond before expiry', () => {
    expect(subscriptionView(store as never, T0 + 30 * DAY - 1).state).toBe('active')
  })

  it('rounds the last part-day up, so a plan ending today never reads as zero', () => {
    // "0 days left" on a plan that still works would send a dealer to pay again
    // for time they already have.
    const view = subscriptionView(store as never, T0 + 30 * DAY - 1000)
    expect(view.state === 'active' && view.daysLeft).toBe(1)
  })
})

describe('the grace period', () => {
  const store = paid('monthly', T0 + 30 * DAY)

  it('begins exactly at expiry', () => {
    expect(subscriptionView(store as never, T0 + 30 * DAY).state).toBe('grace')
  })

  it('reports when listings actually come down, not when the plan ended', () => {
    // The date a dealer needs is the deadline, not the anniversary.
    const view = subscriptionView(store as never, T0 + 31 * DAY)
    expect(view.state).toBe('grace')
    if (view.state !== 'grace') return
    expect(view.graceEndsAt.getTime()).toBe(T0 + 37 * DAY)
    expect(view.daysLeft).toBe(6)
  })

  it('lasts to the last millisecond', () => {
    expect(subscriptionView(store as never, T0 + 37 * DAY - 1).state).toBe('grace')
  })

  it('honours a stored grace end rather than recomputing it', () => {
    // Changing SUBSCRIPTION_GRACE_DAYS must not move the deadline for a dealer
    // already inside one — they were told a date.
    const custom = paid('monthly', T0 + 30 * DAY, T0 + 45 * DAY)
    const view = subscriptionView(custom as never, T0 + 40 * DAY)
    expect(view.state).toBe('grace')
    if (view.state !== 'grace') return
    expect(view.graceEndsAt.getTime()).toBe(T0 + 45 * DAY)
  })
})

describe('an expired plan', () => {
  const store = paid('yearly', T0 + 365 * DAY)

  it('starts exactly when grace ends', () => {
    expect(subscriptionView(store as never, T0 + 372 * DAY).state).toBe('expired')
  })

  it('keeps the original expiry date, which is what the dealer will ask about', () => {
    const view = subscriptionView(store as never, T0 + 400 * DAY)
    expect(view.state).toBe('expired')
    if (view.state !== 'expired') return
    expect(view.expiredAt.getTime()).toBe(T0 + 365 * DAY)
    expect(view.plan).toBe('yearly')
  })
})

describe('how a payment reads', () => {
  it('a completed payment that granted a plan is simply paid', () => {
    expect(paymentView({ status: 'success', subscriptionAppliedAt: ts(T0) } as never)).toBe(
      'applied',
    )
  })

  it('a successful charge that was never applied is its own state', () => {
    // The money moved and the plan did not start. Folding this into "failed"
    // would contradict the dealer's bank alert; folding it into "paid" would
    // hide that they have nothing to show for it.
    expect(paymentView({ status: 'success', subscriptionAppliedAt: null } as never)).toBe(
      'needs-support',
    )
  })

  it('an unfinished checkout is pending, not failed', () => {
    expect(paymentView({ status: 'pending', subscriptionAppliedAt: null } as never)).toBe('pending')
  })

  for (const status of ['failed', 'abandoned'] as const) {
    it(`${status} reads as not completed`, () => {
      expect(paymentView({ status, subscriptionAppliedAt: null } as never)).toBe('failed')
    })
  }
})
