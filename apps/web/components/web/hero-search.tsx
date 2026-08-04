'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Search, MapPin } from 'lucide-react'

const nigerianStates = [
  'All Nigeria',
  'Lagos',
  'Kano',
  'Anambra',
  'Kaduna',
  'Rivers',
  'Oyo',
  'Abuja (FCT)',
]

export function HeroSearch() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [state, setState] = useState('All Nigeria')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (state !== 'All Nigeria') params.set('state', state)
    router.push(`/parts${params.toString() ? `?${params.toString()}` : ''}`)
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm sm:flex-row sm:items-center"
    >
      <div className="flex flex-1 items-center gap-2 rounded-xl px-3 py-2.5">
        <Search className="size-5 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Part name, SKU, vehicle, or brand"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          aria-label="Search parts"
        />
      </div>
      <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 sm:w-52 sm:border-l sm:border-border">
        <MapPin className="size-5 shrink-0 text-muted-foreground" />
        <select
          value={state}
          onChange={(e) => setState(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
          aria-label="Filter by state"
        >
          {nigerianStates.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-orange-hover"
      >
        <Search className="size-4" />
        Search
      </button>
    </form>
  )
}
