import { Suspense } from 'react'
import { listCategories } from '@/lib/repositories/categories'
import { listMarketplaceStates, listPublicListings } from '@/lib/repositories/marketplace'
import { type Condition } from '@/lib/marketplace'
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

/** Only 'New' and 'Used' exist; anything else is a hand-typed URL. */
function parseCondition(value: string | undefined): Condition | undefined {
  if (value?.toLowerCase() === 'new') return 'New'
  if (value?.toLowerCase() === 'used') return 'Used'
  return undefined
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string; category?: string; condition?: string }>
}) {
  const params = await searchParams

  // Fetched server-side so the listing grid is in the initial HTML: buyers
  // have no account, and a crawler must see the parts without running JS.
  //
  // The filters go to Firestore rather than being applied to a downloaded page.
  // Filtering 120 arbitrary listings in the browser gives a *wrong* answer once
  // there are more than 120 — the missing ones were never fetched, so a buyer
  // searching for a part that exists is told it does not.
  const [results, categories, states] = await Promise.all([
    listPublicListings({
      search: params.q?.trim() || undefined,
      categoryId: params.category || undefined,
      state: params.state || undefined,
      condition: parseCondition(params.condition),
      limit: 120,
    }),
    listCategories(),
    listMarketplaceStates(),
  ])

  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-12 text-sm text-muted-foreground">Loading parts…</div>}>
      <BrowseClient
        products={results.products}
        categories={categories.map((c) => ({ id: c.categoryId, name: c.name }))}
        states={states}
        initialQuery={params.q ?? ''}
        initialState={params.state ?? ''}
        initialCategory={params.category ?? ''}
        initialCondition={parseCondition(params.condition)}
        // The client re-applies whatever no index could cover, so the visible
        // result set matches the controls even when the query could not.
        unapplied={results.unapplied}
        truncated={results.truncated}
      />
    </Suspense>
  )
}
