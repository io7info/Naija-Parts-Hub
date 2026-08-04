import 'server-only'

import type { StoreStatus, SubscriptionPlan, SubscriptionStatus } from '@nph/contracts'

import { koboToNaira } from '../marketplace'
import { getAdminDb } from '../firebase-admin'

/**
 * Admin dashboard reads.
 *
 * Derived from Firestore rather than stored as counters. Phase 1 dealer volume
 * is small enough that two collection reads are cheaper than maintaining
 * aggregate documents, and a derived number cannot drift from the records it
 * describes — which matters more here than raw speed, because these figures
 * are what an administrator acts on.
 *
 * Every function assumes requireAdmin() has already run. The Admin SDK bypasses
 * security rules completely.
 */

type Doc = Record<string, unknown>

const DATE = new Intl.DateTimeFormat('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })
const MONTH = new Intl.DateTimeFormat('en-NG', { month: 'short' })

function toDate(value: unknown): Date | null {
  if (!value) return null
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    return (value as { toDate(): Date }).toDate()
  }
  return value instanceof Date ? value : null
}

function formatDate(value: unknown): string {
  const date = toDate(value)
  return date ? DATE.format(date) : '—'
}

export type OverviewStat = { label: string; value: string; hint: string }
export type ChartPoint = { label: string; value: number }

export type AdminOverview = {
  stats: OverviewStat[]
  newStoresByMonth: ChartPoint[]
  listingsByCategory: ChartPoint[]
  subscriptionBreakdown: ChartPoint[]
  recentActivity: { title: string; detail: string; when: string }[]
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const db = getAdminDb()
  const [storeSnap, listingSnap] = await Promise.all([
    db.collection('stores').get(),
    db.collection('listings').get(),
  ])

  // Typed as Doc[]: spreading a DocumentData into an object literal drops the
  // index signature, and every field access below then fails to compile.
  const stores: Doc[] = storeSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Doc) }))
  const listings: Doc[] = listingSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Doc) }))

  const byStatus = (status: StoreStatus) => stores.filter((s) => s.status === status).length
  const activeListings = listings.filter((l) => l.publiclyVisible === true).length
  const paid = stores.filter(
    (s) => (s.subscription as { plan?: SubscriptionPlan } | undefined)?.plan !== 'free',
  ).length

  const stats: OverviewStat[] = [
    {
      label: 'Total dealers',
      value: String(stores.length),
      hint: `${byStatus('approved')} approved`,
    },
    {
      label: 'Pending verification',
      value: String(byStatus('pending')),
      hint: byStatus('pending') > 0 ? 'Awaiting review' : 'Queue clear',
    },
    {
      label: 'Live listings',
      value: String(activeListings),
      hint: `${listings.length} total`,
    },
    {
      label: 'Paid subscriptions',
      value: String(paid),
      hint: `${stores.length - paid} on free plan`,
    },
  ]

  // Last six months including the current one, so an empty month still shows
  // as a zero column rather than collapsing the axis.
  const now = new Date()
  const newStoresByMonth: ChartPoint[] = Array.from({ length: 6 }, (_, i) => {
    const month = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const next = new Date(month.getFullYear(), month.getMonth() + 1, 1)
    const value = stores.filter((s) => {
      const created = toDate(s.createdAt)
      return created && created >= month && created < next
    }).length
    return { label: MONTH.format(month), value }
  })

  const categoryCounts = new Map<string, number>()
  for (const listing of listings) {
    if (listing.publiclyVisible !== true) continue
    const key = (listing.categoryId as string) || 'uncategorised'
    categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1)
  }
  const listingsByCategory = [...categoryCounts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)

  const planCounts = new Map<string, number>()
  for (const store of stores) {
    const plan = (store.subscription as { plan?: string } | undefined)?.plan ?? 'free'
    planCounts.set(plan, (planCounts.get(plan) ?? 0) + 1)
  }
  const subscriptionBreakdown = [...planCounts.entries()].map(([label, value]) => ({
    label,
    value,
  }))

  const recentActivity = stores
    .map((s) => ({ store: s, at: toDate(s.updatedAt ?? s.createdAt) }))
    .filter((entry): entry is { store: Doc; at: Date } => entry.at instanceof Date)
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 6)
    .map(({ store, at }) => ({
      title: (store.businessName as string) || '(unnamed store)',
      detail: `Status: ${store.status as string}`,
      when: DATE.format(at),
    }))

  return { stats, newStoresByMonth, listingsByCategory, subscriptionBreakdown, recentActivity }
}

export type AdminModListing = {
  id: string
  name: string
  store: string
  storeSlug: string
  price: number
  category: string
  status: string
  removed: boolean
  removedReason: string | null
  image: string
  submitted: string
}

/**
 * Listings for the moderation queue.
 *
 * Unfiltered by visibility on purpose: an administrator needs to see what has
 * already been removed in order to reinstate it, so filtering to visible
 * listings would make removal a one-way door.
 */
export async function listListingsForModeration(limit = 100): Promise<AdminModListing[]> {
  const snapshot = await getAdminDb().collection('listings').limit(limit).get()

  return snapshot.docs
    .map((doc) => {
      const d = doc.data() as Doc
      const moderation = (d.moderation ?? {}) as Doc
      const images = Array.isArray(d.images) ? (d.images as { url?: string }[]) : []
      return {
        id: doc.id,
        name: (d.name as string) ?? '(untitled)',
        store: (d.storeBusinessName as string) ?? '—',
        storeSlug: (d.storeSlug as string) ?? '',
        price: koboToNaira(d.priceKobo as number),
        category: (d.categoryId as string) ?? '—',
        status: (d.status as string) ?? 'draft',
        removed: moderation.removed === true,
        removedReason: (moderation.removedReason as string) ?? null,
        image: images[0]?.url ?? '',
        submitted: formatDate(d.createdAt),
      }
    })
    .sort((a, b) => Number(b.removed) - Number(a.removed) || a.name.localeCompare(b.name))
}

export type AdminSubscription = {
  id: string
  store: string
  plan: SubscriptionPlan
  status: SubscriptionStatus
  startedAt: string
  expiresAt: string
  amount: number
  reference: string | null
}

export async function listSubscriptions(): Promise<AdminSubscription[]> {
  const snapshot = await getAdminDb().collection('stores').get()

  return snapshot.docs
    .map((doc) => {
      const d = doc.data() as Doc
      const sub = (d.subscription ?? {}) as Doc
      return {
        id: doc.id,
        store: (d.businessName as string) ?? '(unnamed store)',
        plan: ((sub.plan as SubscriptionPlan) ?? 'free'),
        status: ((sub.status as SubscriptionStatus) ?? 'none'),
        startedAt: formatDate(sub.startedAt),
        expiresAt: formatDate(sub.expiresAt),
        // Paystack is paused, so no payment has been recorded yet. Showing 0
        // is accurate; inventing revenue would not be.
        amount: koboToNaira(sub.lastPaymentKobo as number),
        reference: (sub.lastPaymentReference as string) ?? null,
      }
    })
    .sort((a, b) => {
      // Paid plans first — the ones with money attached are what get audited.
      if (a.plan !== 'free' && b.plan === 'free') return -1
      if (b.plan !== 'free' && a.plan === 'free') return 1
      return a.store.localeCompare(b.store)
    })
}
