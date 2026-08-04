import type { Metadata } from 'next'
import Link from 'next/link'
import { Check } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Dealer Plans',
  description:
    'List up to 10 parts free. Upgrade to 200 active listings for ₦5,000 monthly or ₦50,000 yearly.',
  alternates: { canonical: '/plans' },
}

/**
 * Public pricing page.
 *
 * Deliberately has no checkout. Payment is initialised by a backend Cloud
 * Function and completed on Paystack-hosted checkout, so nothing here collects
 * card details. Signed-in dealers upgrade from /dealer/subscription.
 */
const PLANS = [
  {
    name: 'Free',
    price: '₦0',
    cadence: 'forever',
    limit: '10 active listings',
    features: ['Verified store page', 'Unlimited draft listings', 'WhatsApp and phone contact'],
    highlight: false,
  },
  {
    name: 'Monthly',
    price: '₦5,000',
    cadence: 'per 30 days',
    limit: '200 active listings',
    features: ['Everything in Free', 'Priority placement in search', 'Renew monthly'],
    highlight: true,
  },
  {
    name: 'Yearly',
    price: '₦50,000',
    cadence: 'per 365 days',
    limit: '200 active listings',
    features: ['Everything in Monthly', 'Two months free versus monthly', 'Renew yearly'],
    highlight: false,
  },
] as const

export default function PlansPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:py-16">
      <header className="mx-auto max-w-2xl text-center">
        <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold tracking-tight sm:text-4xl">
          Dealer plans
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Start free with 10 active listings. Upgrade when your stock outgrows it.
        </p>
      </header>

      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={[
              'flex flex-col rounded-xl border bg-card p-6',
              plan.highlight ? 'border-primary ring-1 ring-primary' : 'border-border',
            ].join(' ')}
          >
            {plan.highlight && (
              <span className="mb-3 inline-flex w-fit rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                Most popular
              </span>
            )}
            <h2 className="font-[family-name:var(--font-heading)] text-xl font-semibold">
              {plan.name}
            </h2>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-bold">{plan.price}</span>
              <span className="text-sm text-muted-foreground">{plan.cadence}</span>
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">{plan.limit}</p>

            <ul className="mt-6 flex-1 space-y-3">
              {plan.features.map((f) => (
                <li key={f} className="flex gap-2 text-sm text-muted-foreground">
                  <Check className="mt-0.5 size-4 shrink-0 text-[color:var(--success)]" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <Link
              href="/dealer/login"
              className={[
                'mt-6 inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors',
                plan.highlight
                  ? 'bg-primary text-primary-foreground hover:bg-[color:var(--orange-hover)]'
                  : 'border border-border bg-background hover:bg-accent',
              ].join(' ')}
            >
              {plan.name === 'Free' ? 'Create a store' : 'Choose plan'}
            </Link>
          </div>
        ))}
      </div>

      <p className="mt-10 text-center text-sm text-muted-foreground">
        Subscription fees are for platform access only. Naija Parts Hub never handles payment for
        parts — buyers pay dealers directly.
      </p>
    </div>
  )
}
