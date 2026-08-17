'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { LayoutGrid, List, SlidersHorizontal, X } from 'lucide-react'
import { ProductCard } from '@/components/brand/product-card'
import { EmptyState } from '@/components/brand/ui-bits'
import { sanitizeSearchTerm, track } from '@/lib/analytics'
import { cn } from '@/lib/utils'
import { type Condition, type Product } from '@/lib/marketplace'

const conditions = ['New', 'Used'] as const
const makes = ['Toyota', 'Honda', 'Bajaj', 'Caterpillar', 'Massey Ferguson']

type Sort = 'relevant' | 'newest' | 'low' | 'high'

const sortLabels: Record<Sort, string> = {
  relevant: 'Most Relevant',
  newest: 'Newest',
  low: 'Price: Low to High',
  high: 'Price: High to Low',
}

/**
 * Marketplace browsing.
 *
 * Search, category, state and condition live in the URL and are answered by
 * Firestore; price and vehicle make are refined here over the fetched page.
 *
 * The split is not arbitrary. Filtering entirely in the browser was wrong, not
 * just slow: with 120 listings downloaded and the rest never fetched, a buyer
 * searching for a part that exists past that boundary is told it does not. All
 * four URL filters now have composite indexes for every combination, so their
 * answers come from the whole collection.
 *
 * The remaining two are a known Phase 1 limitation, stated rather than hidden.
 * Price and vehicle make have no index and no URL parameter, so they narrow the
 * fetched page only. Two things keep that honest: they can only ever remove
 * rows from an already-correct server-side result, and `truncated` tells the
 * buyer when they are looking at a page rather than the whole market. If the
 * catalogue outgrows that, they want indexes and URL parameters of their own.
 *
 * URL-driven also means a category tile, a shared link and the back button all
 * work, and a crawler sees a real filtered page.
 */
export function BrowseClient({
  products,
  categories,
  states,
  initialQuery,
  initialState,
  initialCategory,
  initialCondition,
  unapplied,
  truncated,
}: {
  products: Product[]
  categories: { id: string; name: string }[]
  states: string[]
  initialQuery: string
  initialState: string
  initialCategory: string
  initialCondition?: Condition
  unapplied: { state?: string; condition?: Condition }
  truncated: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const [query, setQuery] = useState(initialQuery)
  const [selectedMakes, setSelectedMakes] = useState<string[]>([])
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [sort, setSort] = useState<Sort>('relevant')
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [showFilters, setShowFilters] = useState(false)

  /** Rewrites one search param and re-runs the server query. */
  function setParam(key: string, value: string | undefined) {
    const next = new URLSearchParams(searchParams.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    startTransition(() => router.push(`/parts?${next.toString()}`, { scroll: false }))
  }

  function toggle(list: string[], setter: (v: string[]) => void, value: string) {
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
  }

  function clearAll() {
    setQuery('')
    setSelectedMakes([])
    setMinPrice('')
    setMaxPrice('')
    startTransition(() => router.push('/parts', { scroll: false }))
  }

  const results = useMemo(() => {
    let list: Product[] = products.filter((p) => {
      // Typing narrows what is on screen immediately; submitting re-queries
      // Firestore for the authoritative answer. Without this the input would
      // feel dead until Enter.
      if (query && query !== initialQuery) {
        const q = query.toLowerCase()
        const hay = `${p.name} ${p.partNumber} ${p.vehicleMake} ${p.vehicleModel} ${p.category}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      // Re-applied here only when no index could cover them alongside the rest.
      if (unapplied.state && p.state !== unapplied.state) return false
      if (unapplied.condition && p.condition !== unapplied.condition) return false

      if (selectedMakes.length && !selectedMakes.includes(p.vehicleMake)) return false
      if (minPrice && p.price < Number(minPrice)) return false
      if (maxPrice && p.price > Number(maxPrice)) return false
      return true
    })
    if (sort === 'low') list = [...list].sort((a, b) => a.price - b.price)
    if (sort === 'high') list = [...list].sort((a, b) => b.price - a.price)
    // 'relevant' and 'newest' both keep the server's order, which is
    // createdAt descending.
    return list
  }, [products, query, initialQuery, unapplied, selectedMakes, minPrice, maxPrice, sort])

  const activeCategory = categories.find((c) => c.id === initialCategory)
  const heading = initialQuery
    ? `${initialQuery.charAt(0).toUpperCase() + initialQuery.slice(1)} parts for sale`
    : activeCategory
      ? `${activeCategory.name} parts for sale`
      : 'All automotive parts for sale'

  const filterPanel = (
    <div className="space-y-6">
      <FilterGroup title="Category">
        {categories.map((c) => (
          <CheckRow
            key={c.id}
            label={c.name}
            checked={initialCategory === c.id}
            onChange={() => setParam('category', initialCategory === c.id ? undefined : c.id)}
          />
        ))}
      </FilterGroup>

      <FilterGroup title="Condition">
        {conditions.map((c) => (
          <CheckRow
            key={c}
            label={c}
            checked={initialCondition === c}
            onChange={() => setParam('condition', initialCondition === c ? undefined : c.toLowerCase())}
          />
        ))}
      </FilterGroup>

      <FilterGroup title="State">
        {states.length === 0 ? (
          <p className="text-sm text-muted-foreground">No verified dealers yet.</p>
        ) : (
          states.map((s) => (
            <CheckRow
              key={s}
              label={s}
              checked={initialState === s}
              onChange={() => setParam('state', initialState === s ? undefined : s)}
            />
          ))
        )}
      </FilterGroup>

      <FilterGroup title="Price range (₦)">
        <div className="flex items-center gap-2">
          <input
            inputMode="numeric"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value.replace(/\D/g, ''))}
            placeholder="Min"
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-orange"
          />
          <span className="text-muted-foreground">–</span>
          <input
            inputMode="numeric"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value.replace(/\D/g, ''))}
            placeholder="Max"
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-orange"
          />
        </div>
      </FilterGroup>

      <FilterGroup title="Vehicle make">
        {makes.map((m) => (
          <CheckRow
            key={m}
            label={m}
            checked={selectedMakes.includes(m)}
            onChange={() => toggle(selectedMakes, setSelectedMakes, m)}
          />
        ))}
      </FilterGroup>

      {/* No "Verified sellers only" control.
          Every publicly visible listing already belongs to an approved,
          visible dealer — publiclyVisible is false otherwise — so the filter
          could never remove a row. A control that appears to narrow results
          and cannot is worse than no control: a buyer who ticks it and sees
          the same list concludes the filters do not work. */}
      <button
        type="button"
        onClick={clearAll}
        className="w-full rounded-xl border border-border py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
      >
        Clear all filters
      </button>
    </div>
  )

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Search bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          // Only an explicit submit counts as a search. Changing a category or
          // condition filter also re-queries, but reporting those as searches
          // would bury the terms buyers actually type — which is the reason
          // this event exists.
          const search = sanitizeSearchTerm(query)
          track('search', {
            search_term: search.term,
            search_words_dropped: search.dropped,
            category_filter: initialCategory || undefined,
            surface: 'browse',
          })
          setParam('q', query.trim() || undefined)
        }}
        className="flex gap-2 rounded-2xl border border-border bg-card p-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search part name, SKU, vehicle, or brand"
          className="w-full rounded-xl px-4 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          aria-label="Search parts"
        />
        <button
          type="submit"
          className="shrink-0 rounded-xl bg-orange px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-hover"
        >
          Search
        </button>
      </form>

      <h1 className="mt-6 font-heading text-2xl font-bold text-foreground">
        {heading}
        {initialState ? ` in ${initialState}` : ''}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
        {pending ? 'Searching…' : `${results.length} listing${results.length === 1 ? '' : 's'} found`}
        {truncated && !pending ? ' — showing the newest 120, narrow your filters to see more' : ''}
      </p>

      <div className="mt-6 flex gap-8">
        {/* Sidebar (desktop) */}
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="sticky top-24">
            <h2 className="mb-4 font-heading text-base font-semibold text-foreground">Filters</h2>
            {filterPanel}
          </div>
        </aside>

        {/* Results */}
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setShowFilters(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground lg:hidden"
            >
              <SlidersHorizontal className="size-4" />
              Filters
            </button>
            <div className="ml-auto flex items-center gap-2">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none"
                aria-label="Sort results"
              >
                {(Object.keys(sortLabels) as Sort[]).map((s) => (
                  <option key={s} value={s}>
                    {sortLabels[s]}
                  </option>
                ))}
              </select>
              <div className="hidden items-center rounded-xl border border-border bg-card p-0.5 sm:flex">
                <button
                  type="button"
                  onClick={() => setLayout('grid')}
                  aria-label="Grid view"
                  className={cn('rounded-lg p-1.5', layout === 'grid' ? 'bg-muted text-foreground' : 'text-muted-foreground')}
                >
                  <LayoutGrid className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setLayout('list')}
                  aria-label="List view"
                  className={cn('rounded-lg p-1.5', layout === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground')}
                >
                  <List className="size-4" />
                </button>
              </div>
            </div>
          </div>

          {results.length === 0 ? (
            <EmptyState
              title="No matching parts found"
              message="Try another part name, vehicle model, category, or location."
              actionLabel="Clear Filters"
              onAction={clearAll}
            />
          ) : layout === 'grid' ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              {results.map((p) => (
                <ProductCard key={p.id} product={p} href={`/parts/${p.id}`} />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {results.map((p) => (
                <ProductCard key={p.id} product={p} href={`/parts/${p.id}`} layout="list" />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Mobile filter drawer */}
      {showFilters && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowFilters(false)} />
          <div className="absolute inset-y-0 left-0 w-80 max-w-[85%] overflow-y-auto bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-heading text-base font-semibold text-foreground">Filters</h2>
              <button
                type="button"
                onClick={() => setShowFilters(false)}
                aria-label="Close filters"
                className="inline-flex size-8 items-center justify-center rounded-full hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            </div>
            {filterPanel}
          </div>
        </div>
      )}
    </div>
  )
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2.5 text-sm font-semibold text-foreground">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5">
      <input type="checkbox" checked={checked} onChange={onChange} className="size-4 accent-orange" />
      <span className="text-sm text-foreground">{label}</span>
    </label>
  )
}
