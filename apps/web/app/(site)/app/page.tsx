import type { Metadata } from 'next'
import Link from 'next/link'
import { Smartphone } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Get the app',
  description:
    'The Naija Parts Hub dealer app for Android and iOS is coming soon. Dealers list and manage parts from their phone.',
  alternates: { canonical: '/app' },
}

/**
 * Placeholder for "Get the app".
 *
 * Deliberately carries NO App Store or Play Store badges or links: the app is
 * not published, and fake store links are both misleading and a common cause of
 * store-listing rejection when they are eventually added for real.
 *
 * It also states plainly that the app is for dealers, not buyers — buyers use
 * this responsive website and need no account (ADR-001 #5).
 */
export default function GetTheAppPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
      <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-[color:var(--warm)]">
        <Smartphone className="size-8 text-primary" />
      </div>

      <h1 className="mt-6 font-[family-name:var(--font-heading)] text-3xl font-bold tracking-tight">
        The dealer app is coming soon
      </h1>

      <p className="mt-4 text-lg text-muted-foreground">
        The Naija Parts Hub app lets verified dealers add parts, upload photos and manage stock from
        their phone — including while offline.
      </p>

      <div className="mt-8 rounded-xl border border-border bg-card p-6 text-left">
        <h2 className="font-[family-name:var(--font-heading)] text-base font-semibold">
          Buying parts?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You don&apos;t need the app or an account. Browse the marketplace and contact dealers
          directly by phone or WhatsApp.
        </p>
        <Link
          href="/parts"
          className="mt-4 inline-flex h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-[color:var(--orange-hover)]"
        >
          Browse parts
        </Link>
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        Are you a dealer?{' '}
        <Link href="/plans" className="font-medium text-primary hover:underline">
          See dealer plans
        </Link>
      </p>
    </div>
  )
}
