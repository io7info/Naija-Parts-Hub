'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { collection, onSnapshot, orderBy, query, where, doc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { AlertTriangle, CheckCircle2, Clock, CreditCard, Loader2, LogOut } from 'lucide-react'
import { gaAttribution, track } from '@/lib/analytics'
import { auth, db, functions } from '@/lib/firebase-client'
import { formatNaira } from '@/lib/marketplace'
import {
  PAYMENT_LABEL,
  PLAN_LABEL,
  paymentView,
  planPriceNaira,
  subscriptionView,
  type PaidPlan,
} from '@/lib/subscription-view'
import type { Payment, Store } from '@nph/contracts'
import { cn } from '@/lib/utils'

/**
 * The dealer's subscription (SOW §8).
 *
 * Client-rendered against the dealer's own Firebase session rather than a
 * server session cookie like the admin portal. The difference is what each
 * reads: an administrator's pages return other people's records through the
 * Admin SDK and therefore need server-side gating, while everything here is the
 * dealer's own store and their own payments — already scoped to
 * `request.auth.uid` by firestore.rules and proven by the emulator rules tests.
 * Adding a second session mechanism would mean a second thing to get wrong.
 *
 * Live snapshots, not one-shot reads. A dealer paying in another tab, or the
 * Paystack webhook landing while this page is open, updates the plan in front
 * of them — which is the difference between "did that work?" and watching it
 * work.
 */
const DATE = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })

export function SubscriptionClient() {
  const router = useRouter()
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [store, setStore] = useState<Store | null>(null)
  const [payments, setPayments] = useState<(Payment & { id: string })[]>([])
  const [busyPlan, setBusyPlan] = useState<PaidPlan | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u)), [])

  useEffect(() => {
    if (!user) return
    return onSnapshot(doc(db, 'stores', user.uid), (snap) =>
      setStore(snap.exists() ? (snap.data() as Store) : null),
    )
  }, [user])

  useEffect(() => {
    if (!user) return
    // Constrained by storeId because the rule requires it: a `list` is only
    // permitted when the query itself proves every result belongs to the caller.
    const q = query(
      collection(db, 'payments'),
      where('storeId', '==', user.uid),
      orderBy('initializedAt', 'desc'),
    )
    return onSnapshot(q, (snap) =>
      setPayments(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Payment) }))),
    )
  }, [user])

  const view = useMemo(() => subscriptionView(store), [store])

  // Reported once the store has loaded, not on mount: `view` is 'free' while
  // the Firestore snapshot is still in flight, so reporting immediately would
  // record every paying dealer as being on the free plan.
  const viewReported = useRef(false)
  useEffect(() => {
    if (viewReported.current || !store) return
    viewReported.current = true
    track('dealer_subscription_view', {
      plan_state: view.state,
      plan: 'plan' in view ? view.plan : 'free',
    })
  }, [store, view])

  async function subscribe(plan: PaidPlan) {
    setBusyPlan(plan)
    setError(null)
    try {
      // Read before the callable, because these identifiers exist only in this
      // browser and only right now.
      //
      // This adds a bounded delay of at most 400ms before checkout — usually
      // none, since it returns immediately both when analytics is blocked and
      // when gtag.js has already loaded. It cannot hang or fail the payment:
      // gaAttribution always resolves and never rejects.
      const analytics = await gaAttribution()

      const result = await httpsCallable<
        {
          plan: PaidPlan
          callbackUrl: string
          analytics?: { clientId?: string; sessionId?: string }
        },
        { authorizationUrl: string }
      >(
        functions,
        'initializePayment',
      )({ plan, callbackUrl: '/dealer/subscription/callback', analytics })

      // After initialize succeeds, before the redirect. Firing on click would
      // count dealers whose checkout never opened — a failed callable, an
      // expired session — and make the drop-off between started and completed
      // look like abandonment rather than the error it was.
      track('payment_started', {
        plan,
        price_naira: planPriceNaira(plan),
        // Distinguishes a first purchase from a renewal or an upgrade, which
        // is the difference between acquisition and retention in the reports.
        from_state: view.state,
      })

      // Paystack's own hosted page. Card details are entered there and never
      // touch this origin — which is why there is no card form in this repo.
      //
      // assign() rather than assigning to location.href: the React compiler's
      // immutability rule treats writing a property on a module-scope object as
      // a mutation it cannot reason about. A method call says the same thing
      // and leaves the lint honest for cases that really are bugs.
      window.location.assign(result.data.authorizationUrl)
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not start checkout. Please try again.')
      setBusyPlan(null)
    }
  }

  if (user === undefined) {
    return <Centered><Loader2 className="size-6 animate-spin text-muted-foreground" /></Centered>
  }

  if (user === null) {
    return (
      <Centered>
        <p className="text-sm text-muted-foreground">Sign in to manage your subscription.</p>
        <Link
          href="/dealer/login?next=/dealer/subscription"
          className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-orange px-6 text-sm font-semibold text-white"
        >
          Dealer sign in
        </Link>
      </Centered>
    )
  }

  if (store === null) {
    return (
      <Centered>
        <p className="text-sm text-muted-foreground">
          No business is registered to this number yet. Register in the Naija Parts Hub app first.
        </p>
      </Centered>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">Subscription</h1>
          <p className="mt-1 text-sm text-muted-foreground">{store.businessName}</p>
        </div>
        <button
          type="button"
          onClick={async () => {
            await auth.signOut()
            router.replace('/')
          }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted"
        >
          <LogOut className="size-4" />
          Sign out
        </button>
      </div>

      {/* ---- Current state ------------------------------------------------ */}
      <section className="mt-6 rounded-2xl border border-border bg-card p-6">
        {view.state === 'free' && (
          <StatusBlock
            tone="neutral"
            icon={<CreditCard className="size-5" />}
            title="Free plan"
            body="Your store can have 10 active listings. Upgrade to publish up to 200."
          />
        )}

        {view.state === 'active' && (
          <StatusBlock
            tone="success"
            icon={<CheckCircle2 className="size-5" />}
            title={`${PLAN_LABEL[view.plan]} plan — active`}
            body={`Up to 200 active listings. Renews on ${DATE.format(view.expiresAt)} — ${view.daysLeft} day${view.daysLeft === 1 ? '' : 's'} left.`}
          />
        )}

        {view.state === 'grace' && (
          <StatusBlock
            tone="warning"
            icon={<Clock className="size-5" />}
            title="Your plan has expired — grace period"
            body={
              `Your ${PLAN_LABEL[view.plan].toLowerCase()} plan ended on ${DATE.format(view.expiredAt)}. ` +
              `Your listings stay live until ${DATE.format(view.graceEndsAt)} — ${view.daysLeft} day${view.daysLeft === 1 ? '' : 's'} left. ` +
              'Renew before then and nothing changes.'
            }
          />
        )}

        {view.state === 'expired' && (
          <StatusBlock
            tone="error"
            icon={<AlertTriangle className="size-5" />}
            title="Your plan has expired"
            body={
              `Your ${PLAN_LABEL[view.plan].toLowerCase()} plan ended on ${DATE.format(view.expiredAt)} and the grace period has passed. ` +
              'Your account is back on the free allowance of 10 active listings: the 10 most recently published stayed live, ' +
              'and the rest were moved back to drafts. Nothing was deleted — renew and you can publish them again from the app.'
            }
          />
        )}
      </section>

      {error && (
        <p className="mt-4 rounded-xl border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
          {error}
        </p>
      )}

      {/* ---- Plans -------------------------------------------------------- */}
      <section className="mt-8">
        <h2 className="font-heading text-lg font-semibold text-foreground">
          {view.state === 'active' ? 'Extend your plan' : 'Choose a plan'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {view.state === 'active'
            ? 'Renewing the same plan adds to the time you have already paid for.'
            : 'Payment is handled by Paystack. Card details are entered on their secure page.'}
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {(['monthly', 'yearly'] as const).map((plan) => {
            // No downgrade in Phase 1 — the backend refuses it, and offering a
            // button that returns an error is worse than not offering it.
            const blocked = plan === 'monthly' && view.state === 'active' && view.plan === 'yearly'
            return (
              <div key={plan} className="rounded-2xl border border-border bg-card p-5">
                <p className="font-heading text-base font-semibold text-foreground">
                  {PLAN_LABEL[plan]}
                </p>
                <p className="mt-1 text-2xl font-bold text-foreground">
                  {formatNaira(planPriceNaira(plan))}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {plan === 'monthly' ? '30 days' : '365 days'} · up to 200 active listings
                </p>

                <button
                  type="button"
                  disabled={busyPlan !== null || blocked}
                  onClick={() => subscribe(plan)}
                  title={
                    blocked
                      ? 'Your yearly plan is still running. Switching to monthly would end it early.'
                      : undefined
                  }
                  className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange text-sm font-semibold text-white transition-colors hover:bg-orange-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busyPlan === plan && <Loader2 className="size-4 animate-spin" />}
                  {blocked
                    ? 'Not available on a yearly plan'
                    : view.state === 'active' && view.plan === plan
                      ? 'Add another period'
                      : `Pay with Paystack`}
                </button>
              </div>
            )
          })}
        </div>
      </section>

      {/* ---- History ------------------------------------------------------ */}
      <section className="mt-10">
        <h2 className="font-heading text-lg font-semibold text-foreground">Payment history</h2>

        {payments.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No payments yet.</p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Plan</th>
                  <th className="px-4 py-3 font-semibold">Amount</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const state = paymentView(p)
                  const date = (p.initializedAt as unknown as { toDate?: () => Date })?.toDate?.()
                  return (
                    <tr key={p.id} className="border-b border-border last:border-0 align-top">
                      <td className="px-4 py-3 text-muted-foreground">
                        {date ? DATE.format(date) : '—'}
                        <div className="mt-0.5 font-mono text-[11px]">{p.id}</div>
                      </td>
                      <td className="px-4 py-3">{PLAN_LABEL[p.plan]}</td>
                      <td className="px-4 py-3">{formatNaira(p.amountKobo / 100)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                            state === 'applied' && 'bg-success/10 text-success',
                            state === 'pending' && 'bg-muted text-muted-foreground',
                            state === 'failed' && 'bg-muted text-muted-foreground',
                            state === 'needs-support' && 'bg-error/10 text-error',
                          )}
                        >
                          {PAYMENT_LABEL[state]}
                        </span>
                        {state === 'needs-support' && (
                          // Never folded into "failed". The money moved; telling
                          // a dealer otherwise contradicts their bank statement.
                          <p className="mt-1 max-w-xs text-xs text-error">
                            This payment went through but could not be applied. Contact support
                            with the reference above and we will sort it out.
                          </p>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
        Plans do not renew automatically — you choose when to pay again. Refunds and mid-term
        cancellation are not available in this release.
      </p>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      {children}
    </div>
  )
}

function StatusBlock({
  tone,
  icon,
  title,
  body,
}: {
  tone: 'neutral' | 'success' | 'warning' | 'error'
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div className="flex gap-4">
      <span
        className={cn(
          'inline-flex size-10 shrink-0 items-center justify-center rounded-xl',
          tone === 'neutral' && 'bg-muted text-muted-foreground',
          tone === 'success' && 'bg-success/10 text-success',
          tone === 'warning' && 'bg-orange/10 text-orange',
          tone === 'error' && 'bg-error/10 text-error',
        )}
      >
        {icon}
      </span>
      <div>
        <p className="font-heading text-base font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  )
}
