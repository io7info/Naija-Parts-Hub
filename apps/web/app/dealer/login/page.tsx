import type { Metadata } from 'next'
import Link from 'next/link'
import { Logo } from '@/components/brand/logo'

export const metadata: Metadata = {
  title: 'Dealer sign in',
  robots: { index: false, follow: false },
}

/**
 * STAGE 1 PLACEHOLDER — no authentication yet.
 *
 * Stage 12 replaces this with Firebase phone-OTP sign-in matching the dealer
 * app. It deliberately contains no mock auth: the prototype's sessionStorage
 * flag was removed rather than migrated, so there is nothing here that could be
 * mistaken for a working sign-in.
 */
export default function DealerLoginPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[color:var(--warm)] px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 text-center">
        <div className="flex justify-center">
          <Logo />
        </div>
        <h1 className="mt-6 font-[family-name:var(--font-heading)] text-xl font-semibold">
          Dealer sign in
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Phone sign-in for the website is not enabled yet. Dealers manage listings in the Naija
          Parts Hub mobile app.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-[color:var(--orange-hover)]"
        >
          Back to marketplace
        </Link>
      </div>
    </div>
  )
}
