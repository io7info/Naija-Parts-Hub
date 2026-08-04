'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { Eye, RotateCcw, Trash2, Loader2, AlertCircle } from 'lucide-react'
import { AdminPageHeader } from '@/components/admin/page-header'
import { StatusBadge } from '@/components/brand/badges'
import { formatNaira } from '@/lib/marketplace'
import { functions } from '@/lib/firebase-client'
import { cn } from '@/lib/utils'
import type { AdminModListing } from '@/lib/repositories/admin-metrics'

/**
 * Listing moderation — SOW §9.
 *
 * Remove and Restore call `adminModerateListing`, which re-verifies the
 * super_admin claim server-side. The callable is the only path: it also
 * recomputes `publiclyVisible` and appends to `adminActions`, so writing the
 * document directly from here would hide a listing while leaving no record of
 * who hid it.
 *
 * The prototype also offered "Unpublish" and "Flag Seller". Neither has a
 * backend — unpublishing is the dealer's own `status` field, and seller
 * flagging does not exist in the SOW. Both are removed rather than left as
 * buttons that quietly do nothing.
 */
const filters = ['active', 'draft', 'archived', 'removed'] as const
/** The four real states, excluding the 'all' pseudo-filter. */
type ListingState = (typeof filters)[number]
type Filter = ListingState | 'all'

/** Moderation state is the removal flag first, then the dealer's own status. */
function displayStatus(listing: AdminModListing): ListingState {
  return listing.removed ? 'removed' : (listing.status as ListingState)
}

export function ModerationClient({ listings }: { listings: AdminModListing[] }) {
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const rows = listings.filter((l) => (filter === 'all' ? true : displayStatus(l) === filter))

  async function moderate(listing: AdminModListing, action: 'remove' | 'restore') {
    setBusyId(listing.id)
    setError(null)
    try {
      await httpsCallable(functions, 'adminModerateListing')({
        listingId: listing.id,
        action,
      })
      // Re-run the server component so each row reflects what was actually
      // written, rather than an optimistic guess that can disagree with it.
      router.refresh()
    } catch (e) {
      const message = (e as { message?: string })?.message
      setError(message || `Could not ${action} this listing.`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <AdminPageHeader title="Listing Moderation" subtitle="Review and remove product listings" />

      <div className="p-5 sm:p-8">
        <div className="flex flex-wrap gap-2">
          {(['all', ...filters] as Filter[]).map((f) => {
            const count =
              f === 'all' ? listings.length : listings.filter((l) => displayStatus(l) === f).length
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold capitalize transition-colors',
                  filter === f
                    ? 'border-orange bg-orange text-white'
                    : 'border-border bg-card text-foreground hover:border-orange/40',
                )}
              >
                {f}
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[10px]',
                    filter === f ? 'bg-white/20' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {error && (
          <p className="mt-4 flex gap-2 rounded-xl border border-error/30 bg-error/10 p-3 text-xs leading-relaxed text-error">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </p>
        )}

        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((l) => {
            const status = displayStatus(l)
            const busy = busyId === l.id
            return (
              <div
                key={l.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card"
              >
                <div className="flex gap-3 p-4">
                  <div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-muted">
                    {l.image ? (
                      // unoptimized: images live in Firebase Storage behind
                      // signed download URLs, which the Next image optimizer
                      // cannot re-fetch without the token being proxied.
                      <Image src={l.image} alt={l.name} fill className="object-cover" unoptimized />
                    ) : (
                      <span className="flex size-full items-center justify-center text-[10px] text-muted-foreground">
                        No photo
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-sm font-semibold text-foreground">{l.name}</p>
                      <StatusBadge status={status} />
                    </div>
                    <p className="mt-1 font-heading text-base font-bold text-orange">
                      {formatNaira(l.price)}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {l.store} · {l.submitted}
                    </p>
                    <p className="text-xs text-muted-foreground">{l.category}</p>
                    {l.removedReason && (
                      <p className="mt-1 text-xs text-error">Removed: {l.removedReason}</p>
                    )}
                  </div>
                </div>
                <div className="mt-auto flex flex-wrap gap-1.5 border-t border-border p-3">
                  {/* Only a live listing has a public URL worth opening. */}
                  {status === 'active' && (
                    <Link
                      href={`/parts/${l.id}`}
                      target="_blank"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
                    >
                      <Eye className="size-3.5" />
                      View
                    </Link>
                  )}

                  {l.removed ? (
                    <button
                      disabled={busy}
                      onClick={() => moderate(l, 'restore')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-success transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="size-3.5" />
                      )}
                      Restore
                    </button>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() => moderate(l, 'remove')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-error transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                      Remove
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          {rows.length === 0 && (
            <p className="col-span-full py-10 text-center text-sm text-muted-foreground">
              No listings in this category.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
