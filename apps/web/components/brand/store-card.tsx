import Link from 'next/link'
import { MapPin, Store as StoreIcon } from 'lucide-react'
import type { Store } from '@/lib/marketplace'
import { VerifiedBadge } from './badges'

export function StoreInitials({ name, size = 48 }: { name: string; size?: number }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
  return (
    <span
      className="inline-flex items-center justify-center rounded-xl bg-dark font-heading font-bold text-orange"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {initials}
    </span>
  )
}

export function StoreCard({ store, href }: { store: Store; href: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 transition-colors hover:border-orange/40"
    >
      <StoreInitials name={store.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-foreground">{store.name}</p>
          {store.verified && <VerifiedBadge compact />}
        </div>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="size-3" />
          {store.state}
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          <StoreIcon className="size-3" />
          {store.activeListings} active listings
        </p>
      </div>
    </Link>
  )
}
