import type { Metadata } from 'next'
import Link from 'next/link'
import { CreditCard } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Dealer subscriptions',
  description:
    'Naija Parts Hub dealer plans. Checkout is not open yet — see the plans page for pricing.',
  // Not indexable while it cannot do anything.
  robots: { index: false, follow: false },
}

/**
 * Subscription management — checkout deliberately absent.
 *
 * This route previously rendered a working-looking Paystack checkout modal that
 * collected **card number, expiry and CVV** and did nothing with them. It sat on
 * a public, unauthenticated URL, and the only disclaimer was 12px grey text
 * below the Pay button.
 *
 * That component has been deleted rather than hidden behind a flag or a
 * disabled button. A form that asks Nigerian dealers for card details under this
 * brand must not be one commit or one conditional away from being live, and
 * deleting it removes the markup from the bundle entirely.
 *
 * Real checkout arrives with SOW §8, which needs `initializePayment`,
 * `verifyPayment` and the Paystack webhook in `functions/src` — none of which
 * exist yet. When they do, checkout is Paystack-hosted: the card details are
 * entered on Paystack's own page and never touch this origin.
 */
export default function DealerSubscriptionPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <CreditCard className="size-7" />
      </span>

      <h1 className="mt-6 font-[family-name:var(--font-heading)] text-2xl font-bold tracking-tight">
        Online checkout is not open yet
      </h1>

      <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">
        Dealer subscriptions are not yet available to buy online. Your store and every
        listing you have already published stay exactly as they are, and the free plan
        continues to include 10 active listings.
      </p>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        To upgrade in the meantime, contact us and we will arrange it directly.
      </p>

      <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
        <Link
          href="/plans"
          className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-[color:var(--orange-hover)]"
        >
          See plans and pricing
        </Link>
        <Link
          href="/contact"
          className="inline-flex h-11 items-center justify-center rounded-lg border border-border bg-background px-6 text-sm font-semibold transition-colors hover:bg-accent"
        >
          Contact us
        </Link>
      </div>

      <p className="mt-10 text-xs leading-relaxed text-muted-foreground">
        When checkout opens it will be handled by Paystack on their own secure page.
        Naija Parts Hub never asks for your card details.
      </p>
    </div>
  )
}
