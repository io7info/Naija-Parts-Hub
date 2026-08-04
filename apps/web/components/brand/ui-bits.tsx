'use client'

import Link from 'next/link'
import { Search, Mic, X, PackageSearch } from 'lucide-react'
import {
  Car,
  Bike,
  Truck,
  Tractor,
  Forklift,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const iconMap: Record<string, LucideIcon> = {
  Car,
  Bike,
  Truck,
  Tractor,
  Forklift,
  Zap,
}

export function CategoryCard({
  label,
  icon,
  href,
  compact = false,
}: {
  label: string
  icon: string
  href: string
  compact?: boolean
}) {
  const Icon = iconMap[icon] ?? Car
  return (
    <Link
      href={href}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card text-center transition-colors hover:border-orange/40 hover:bg-warm',
        compact ? 'p-3' : 'p-4',
      )}
    >
      <span className="inline-flex size-11 items-center justify-center rounded-xl bg-orange/10 text-orange">
        <Icon className="size-5" />
      </span>
      <span className="text-xs font-semibold leading-tight text-foreground">{label}</span>
    </Link>
  )
}

export function SearchBar({
  placeholder = 'Search part name, SKU, vehicle, or brand',
  value,
  onChange,
  withVoice = true,
  className,
}: {
  placeholder?: string
  value?: string
  onChange?: (v: string) => void
  withVoice?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5',
        className,
      )}
    >
      <Search className="size-4 shrink-0 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
      {withVoice && (
        <button type="button" aria-label="Voice search" className="shrink-0 text-muted-foreground hover:text-orange">
          <Mic className="size-4" />
        </button>
      )}
    </div>
  )
}

export function FilterChip({
  label,
  active = false,
  onClick,
}: {
  label: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
        active
          ? 'border-orange bg-orange text-white'
          : 'border-border bg-card text-foreground hover:border-orange/40',
      )}
    >
      {label}
    </button>
  )
}

export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
  icon: Icon = PackageSearch,
}: {
  title: string
  message: string
  actionLabel?: string
  onAction?: () => void
  icon?: LucideIcon
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Icon className="size-7" />
      </span>
      <h3 className="mt-4 font-heading text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">{message}</p>
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 rounded-xl bg-orange px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-hover"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}

export function SectionHeader({
  title,
  actionLabel = 'See all',
  href,
}: {
  title: string
  actionLabel?: string
  href?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-heading text-lg font-semibold text-foreground">{title}</h2>
      {href && (
        <Link href={href} className="text-xs font-semibold text-orange hover:text-orange-hover">
          {actionLabel}
        </Link>
      )}
    </div>
  )
}

export function CloseIconButton({ onClick, className }: { onClick?: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-full text-foreground hover:bg-muted',
        className,
      )}
    >
      <X className="size-4" />
    </button>
  )
}
