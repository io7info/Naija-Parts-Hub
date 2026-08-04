'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { ProductCard } from '@/components/brand/product-card'
import { EmptyState } from '@/components/brand/ui-bits'
import { FilterChip } from '@/components/brand/ui-bits'
import type { Product } from '@/lib/marketplace'

export function StoreProducts({ items }: { items: Product[] }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')

  const cats = useMemo(() => ['All', ...Array.from(new Set(items.map((p) => p.category)))], [items])

  const filtered = useMemo(
    () =>
      items.filter((p) => {
        if (category !== 'All' && p.category !== category) return false
        if (query && !p.name.toLowerCase().includes(query.toLowerCase())) return false
        return true
      }),
    [items, query, category],
  )

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search within this store"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Search store products"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {cats.map((c) => (
          <FilterChip key={c} label={c} active={category === c} onClick={() => setCategory(c)} />
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No products found"
          message="Try a different search term or category filter."
          actionLabel="Clear search"
          onAction={() => {
            setQuery('')
            setCategory('All')
          }}
        />
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {filtered.map((p) => (
            <ProductCard key={p.id} product={p} href={`/parts/${p.id}`} />
          ))}
        </div>
      )}
    </div>
  )
}
