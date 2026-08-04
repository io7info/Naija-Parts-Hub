import { Suspense } from 'react'
import { listPublicListings } from '@/lib/repositories/marketplace'
import { BrowseClient } from './browse-client'

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

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string; category?: string }>
}) {
  const params = await searchParams
  // Fetched server-side so the listing grid is in the initial HTML: buyers
  // have no account, and a crawler must see the parts without running JS.
  const products = await listPublicListings({ limit: 120 })
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-12 text-sm text-muted-foreground">Loading parts…</div>}>
      <BrowseClient
        products={products}
        initialQuery={params.q ?? ''}
        initialState={params.state ?? ''}
      />
    </Suspense>
  )
}
