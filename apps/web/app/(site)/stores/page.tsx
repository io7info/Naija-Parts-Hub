import Link from 'next/link'
import { MapPin, Package, CalendarDays, ChevronRight } from 'lucide-react'
import { VerifiedBadge } from '@/components/brand/badges'
import { StoreInitials } from '@/components/brand/store-card'
import { listPublicStores } from '@/lib/repositories/marketplace'

/**
 * Rendered per request, not prerendered.
 *
 * Two reasons. Prerendering would run these Firestore reads during
 * `next build`, making the build itself require production credentials for
 * pages it never serves. And a marketplace baked at build time is stale the
 * moment a dealer publishes: a listing would not appear until the next deploy.
 *
 * Revisit with revalidate once traffic justifies caching over freshness.
 */
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Verified Stores — Naija Parts Hub',
  description: 'Browse verified automotive parts dealers with physical stores across Nigeria.',
}

export default async function StoresPage() {
  // Approved and visible only — the filter lives in the repository so it cannot
  // drift from the security rule that enforces the same predicate.
  const stores = await listPublicStores()

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="font-heading text-3xl font-bold text-foreground">Verified Stores</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Every dealer below has an approved physical store location in Nigeria. Contact them directly to buy parts.
      </p>

      {stores.length === 0 && (
        <p className="mt-8 rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          No verified stores yet. Dealers appear here once an administrator approves them.
        </p>
      )}

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {stores.map((store) => (
          <Link
            key={store.slug}
            href={`/store/${store.slug}`}
            className="group flex flex-col rounded-2xl border border-border bg-card p-5 transition-colors hover:border-orange/40"
          >
            <div className="flex items-center gap-3">
              <StoreInitials name={store.name} size={56} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate font-heading text-base font-semibold text-foreground">{store.name}</p>
                </div>
                {store.verified && (
                  <span className="mt-1 inline-flex">
                    <VerifiedBadge compact />
                  </span>
                )}
              </div>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{store.tagline}</p>
            <ul className="mt-4 space-y-1.5 text-xs text-muted-foreground">
              <li className="flex items-center gap-1.5">
                <MapPin className="size-3.5 text-orange" />
                {store.address}
              </li>
              <li className="flex items-center gap-1.5">
                <Package className="size-3.5 text-orange" />
                {store.activeListings} active listings
              </li>
              <li className="flex items-center gap-1.5">
                <CalendarDays className="size-3.5 text-orange" />
                Verified since {store.memberSince}
              </li>
            </ul>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-orange">
              Visit store
              <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
