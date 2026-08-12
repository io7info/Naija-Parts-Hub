import type { Metadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import { Logo } from '@/components/brand/logo'
import { DealerLoginForm } from './login-form'

export const metadata: Metadata = {
  title: 'Dealer sign in',
  robots: { index: false, follow: false },
}

/**
 * Phone-OTP sign-in, matching the dealer app's identity.
 *
 * This route was a placeholder for most of the project — dealers did everything
 * in the app, so the website had nobody to authenticate. Subscriptions changed
 * that: Apple's Guideline 3.1.1 forbids an iOS app pointing at an external
 * purchase flow, so the iOS build carries no upgrade link and the website is
 * the only route to a paid plan. A dealer who cannot sign in here cannot pay.
 *
 * Suspense because the form reads `?next=` with useSearchParams, which opts the
 * component into client-side rendering and needs a boundary above it.
 */
export default function DealerLoginPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-warm px-4 py-12">
      <Link href="/" className="mb-6">
        <Logo />
      </Link>

      <Suspense
        fallback={
          <div className="h-80 w-full max-w-sm animate-pulse rounded-2xl border border-border bg-card" />
        }
      >
        <DealerLoginForm />
      </Suspense>

      <p className="mt-6 text-xs text-muted-foreground">
        Operated by Lytod Motors Ltd · RC 1207675
      </p>
    </div>
  )
}
