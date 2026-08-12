import type { Metadata } from 'next'
import { SubscriptionClient } from './subscription-client'

export const metadata: Metadata = {
  title: 'Your subscription',
  description: 'Manage your Naija Parts Hub dealer plan.',
  // A dealer's own account page; nothing here belongs in a search index.
  robots: { index: false, follow: false },
}

/**
 * Dealer subscription management (SOW §8).
 *
 * This route previously rendered a working-looking checkout modal that
 * collected card number, expiry and CVV on a public, unauthenticated URL and
 * did nothing with them. That component was deleted rather than hidden, and
 * what replaces it never handles card data at all: `initializePayment` returns
 * a Paystack-hosted checkout URL, and the dealer enters their details on
 * Paystack's own page.
 *
 * No secret key exists anywhere in this bundle. The only Paystack credential
 * this project holds is `PAYSTACK_SECRET_KEY` in Secret Manager, read by Cloud
 * Functions; the browser never sees it, and there is no publishable key here
 * either, because the hosted flow does not need one.
 */
export default function DealerSubscriptionPage() {
  return <SubscriptionClient />
}
