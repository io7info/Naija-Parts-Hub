'use client'

import { useState } from 'react'
import { Check, Download, Lock, CreditCard, X, ShieldCheck } from 'lucide-react'
import { formatNaira } from '@/lib/marketplace'
import { cn } from '@/lib/utils'

type PlanId = 'monthly' | 'yearly'

const plans = [
  {
    id: 'free' as const,
    name: 'Free Plan',
    price: 0,
    period: 'forever',
    listings: '10 active listings',
    features: ['Verified store profile', 'Direct WhatsApp & call buttons', 'Appear in search results'],
    current: true,
  },
  {
    id: 'monthly' as const,
    name: 'Monthly',
    price: 5000,
    period: '30 days',
    listings: 'Up to 200 active listings',
    features: ['Everything in Free', 'Priority placement in search', 'Featured store badge', 'Listing analytics'],
    highlight: false,
  },
  {
    id: 'yearly' as const,
    name: 'Yearly',
    price: 50000,
    period: '365 days',
    listings: 'Up to 200 active listings',
    features: ['Everything in Monthly', 'Save ₦10,000 vs monthly', 'Priority support', 'Renewal reminders'],
    highlight: true,
    save: 'Save ₦10,000',
  },
]

const payments = [
  { ref: 'NPH-PS-2026-0417', plan: 'Yearly', amount: 50000, date: '12 Jan 2026', status: 'Successful' },
  { ref: 'NPH-PS-2025-0388', plan: 'Monthly', amount: 5000, date: '05 Dec 2025', status: 'Successful' },
  { ref: 'NPH-PS-2025-0311', plan: 'Monthly', amount: 5000, date: '04 Nov 2025', status: 'Successful' },
]

export function SubscriptionClient() {
  const [checkout, setCheckout] = useState<PlanId | null>(null)

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="max-w-2xl">
        <h1 className="font-heading text-3xl font-bold text-foreground">Dealer Subscriptions</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Publish up to 10 listings for free. Upgrade to list up to 200 active products and boost your store&apos;s
          visibility. Subscriptions are billed securely through Paystack.
        </p>
      </div>

      {/* Current plan banner */}
      <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-orange/30 bg-orange/5 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-orange">Current Plan</p>
          <p className="mt-1 font-heading text-lg font-semibold text-foreground">Free Plan · 8 of 10 listings used</p>
          <p className="text-sm text-muted-foreground">No active paid subscription. Upgrade any time below.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-foreground sm:self-auto">
          <ShieldCheck className="size-4 text-success" />
          Verified dealer
        </span>
      </div>

      {/* Plans */}
      <div className="mt-8 grid gap-5 lg:grid-cols-3">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={cn(
              'relative flex flex-col rounded-2xl border bg-card p-6',
              plan.highlight ? 'border-orange shadow-sm' : 'border-border',
            )}
          >
            {plan.highlight && (
              <span className="absolute -top-3 left-6 rounded-full bg-orange px-3 py-1 text-xs font-semibold text-white">
                Best value
              </span>
            )}
            <h2 className="font-heading text-lg font-semibold text-foreground">{plan.name}</h2>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="font-heading text-3xl font-bold text-foreground">{formatNaira(plan.price)}</span>
              <span className="text-sm text-muted-foreground">/ {plan.period}</span>
            </div>
            {'save' in plan && plan.save && (
              <span className="mt-1 inline-flex w-fit rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
                {plan.save}
              </span>
            )}
            <p className="mt-3 text-sm font-semibold text-foreground">{plan.listings}</p>
            <ul className="mt-4 flex-1 space-y-2.5">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" />
                  {f}
                </li>
              ))}
            </ul>
            {'current' in plan && plan.current ? (
              <button
                disabled
                className="mt-6 w-full rounded-xl border border-border py-2.5 text-sm font-semibold text-muted-foreground"
              >
                Current plan
              </button>
            ) : (
              <button
                onClick={() => setCheckout(plan.id as PlanId)}
                className={cn(
                  'mt-6 w-full rounded-xl py-2.5 text-sm font-semibold transition-colors',
                  plan.highlight
                    ? 'bg-orange text-white hover:bg-orange-hover'
                    : 'border border-orange text-orange hover:bg-orange/5',
                )}
              >
                Choose {plan.name}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Payment history */}
      <div className="mt-12">
        <h2 className="font-heading text-xl font-semibold text-foreground">Payment History</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Subscription start &amp; expiry dates and Paystack references for your records.
        </p>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border bg-warm text-left text-xs font-semibold text-muted-foreground">
                <th className="px-4 py-3">Paystack Reference</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.ref} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-mono text-xs text-foreground">{p.ref}</td>
                  <td className="px-4 py-3 text-foreground">{p.plan}</td>
                  <td className="px-4 py-3 text-foreground">{formatNaira(p.amount)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.date}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button className="inline-flex items-center gap-1 text-xs font-semibold text-orange hover:text-orange-hover">
                      <Download className="size-3.5" />
                      Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Paystack checkout modal (mockup only) */}
      {checkout && (
        <CheckoutModal
          plan={checkout}
          amount={checkout === 'monthly' ? 5000 : 50000}
          onClose={() => setCheckout(null)}
        />
      )}
    </div>
  )
}

function CheckoutModal({ plan, amount, onClose }: { plan: PlanId; amount: number; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
        <button
          onClick={onClose}
          aria-label="Close checkout"
          className="absolute right-4 top-4 inline-flex size-8 items-center justify-center rounded-full hover:bg-muted"
        >
          <X className="size-4" />
        </button>
        <div className="flex items-center gap-2 text-success">
          <span className="inline-flex size-9 items-center justify-center rounded-xl bg-success/10">
            <CreditCard className="size-5" />
          </span>
          <span className="font-heading text-base font-semibold text-foreground">Paystack Checkout</span>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          You are subscribing to the <span className="font-semibold text-foreground capitalize">{plan}</span> plan.
        </p>
        <div className="mt-4 rounded-xl border border-border bg-warm p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Amount due</span>
            <span className="font-heading text-lg font-bold text-foreground">{formatNaira(amount)}</span>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          <Field label="Card number" placeholder="0000 0000 0000 0000" />
          <div className="flex gap-3">
            <Field label="Expiry" placeholder="MM / YY" />
            <Field label="CVV" placeholder="123" />
          </div>
        </div>
        <button className="mt-5 w-full rounded-xl bg-orange py-3 text-sm font-semibold text-white transition-colors hover:bg-orange-hover">
          Pay {formatNaira(amount)}
        </button>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3.5" />
          Secured by Paystack · This is a design mockup — no real payment is processed.
        </p>
      </div>
    </div>
  )
}

function Field({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <label className="block flex-1">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <input
        placeholder={placeholder}
        className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-orange"
      />
    </label>
  )
}
