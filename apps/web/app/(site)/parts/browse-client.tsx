'use client'

import { useMemo, useState } from 'react'
import { LayoutGrid, List, SlidersHorizontal, X } from 'lucide-react'
import { ProductCard } from '@/components/brand/product-card'
import { EmptyState } from '@/components/brand/ui-bits'
import { cn } from '@/lib/utils'
import { type Product } from '@/lib/marketplace'

const conditions = ['New', 'Used'] as const
const states = ['Lagos', 'Kano', 'Anambra', 'Kaduna']
const makes = ['Toyota', 'Honda', 'Bajaj', 'Caterpillar', 'Massey Ferguson']

type Sort = 'relevant' | 'newest' | 'low' | 'high'

const sortLabels: Record<Sort, string> = {
  relevant: 'Most Relevant',
  newest: 'Newest',
  low: 'Price: Low to High',
  high: 'Price: High to Low',
}

export function BrowseClient({
  products,
  initialQuery,
  initialState,
}: {
  products: Product[]
  initialQuery: string
  initialState: string
}) {
  const [query, setQuery] = useState(initialQuery)
  const [selectedStates, setSelectedStates] = useState<string[]>(initialState ? [initialState] : [])
  const [selectedConditions, setSelectedConditions] = useState<string[]>([])
  const [selectedMakes, setSelectedMakes] = useState<string[]>([])
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [sort, setSort] = useState<Sort>('relevant')
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [showFilters, setShowFilters] = useState(false)

  function toggle(list: string[], setter: (v: string[]) => void, value: string) {
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
  }

  function clearAll() {
    setQuery('')
    setSelectedStates([])
    setSelectedConditions([])
    setSelectedMakes([])
    setMinPrice('')
    setMaxPrice('')
    setVerifiedOnly(false)
  }

  const results = useMemo(() => {
    let list: Product[] = products.filter((p) => {
      if (query) {
        const q = query.toLowerCase()
        const hay = `${p.name} ${p.partNumber} ${p.vehicleMake} ${p.vehicleModel} ${p.category}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (selectedStates.length && !selectedStates.includes(p.state)) return false
      if (selectedConditions.length && !selectedConditions.includes(p.condition)) return false
      if (selectedMakes.length && !selectedMakes.includes(p.vehicleMake)) return false
      if (minPrice && p.price < Number(minPrice)) return false
      if (maxPrice && p.price > Number(maxPrice)) return false
      if (verifiedOnly && !p.verified) return false
      return true
    })
    if (sort === 'low') list = [...list].sort((a, b) => a.price - b.price)
    if (sort === 'high') list = [...list].sort((a, b) => b.price - a.price)
    return list
  }, [products, query, selectedStates, selectedConditions, selectedMakes, minPrice, maxPrice, verifiedOnly, sort])

  const heading = query
    ? `${query.charAt(0).toUpperCase() + query.slice(1)} parts for sale`
    : 'All automotive parts for sale'

  const filterPanel = (
    <div className="space-y-6">
      <FilterGroup title="Condition">
        {conditions.map((c) => (
          <CheckRow
            key={c}
            label={c}
            checked={selectedConditions.includes(c)}
            onChange={() => toggle(selectedConditions, setSelectedConditions, c)}
          />
        ))}
      </FilterGroup>

      <FilterGroup title="State">
        {states.map((s) => (
          <CheckRow
            key={s}
            label={s}
            checked={selectedStates.includes(s)}
            onChange={() => toggle(selectedStates, setSelectedStates, s)}
          />
        ))}
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

      <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5">
        <input
          type="checkbox"
          checked={verifiedOnly}
          onChange={(e) => setVerifiedOnly(e.target.checked)}
          className="size-4 accent-orange"
        />
        <span className="text-sm font-medium text-foreground">Verified sellers only</span>
      </label>

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
      <div className="rounded-2xl border border-border bg-card p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search part name, SKU, vehicle, or brand"
          className="w-full rounded-xl px-4 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          aria-label="Search parts"
        />
      </div>

      <h1 className="mt-6 font-heading text-2xl font-bold text-foreground">
        {heading}
        {selectedStates.length === 1 ? ` in ${selectedStates[0]}` : ''}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{results.length} listings found</p>

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
