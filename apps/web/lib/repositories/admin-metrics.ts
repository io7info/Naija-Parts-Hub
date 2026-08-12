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

export type AdminPayment = {
  reference: string
  storeId: string
  store: string
  plan: string
  amount: number
  status: string
  paystackStatus: string | null
  channel: string | null
  initializedAt: string
  verifiedAt: string | null
  verifiedVia: string | null
  /** Money moved but no subscription was granted. The row that needs a human. */
  needsSupport: boolean
}

/**
 * Every Paystack transaction (SOW §9, "Paystack payment-reference review").
 *
 * Read through the Admin SDK because it spans all dealers, which no client
 * query is permitted to do — `payments` allows a dealer to read only their own.
 *
 * The store name is joined in from `stores`, because a reference alone is
 * useless during a support call: the caller says "I paid on Tuesday", not
 * "nph-mf3k2-a91c".
 */
export async function listPayments(limit = 200): Promise<AdminPayment[]> {
  const snapshot = await getAdminDb()
    .collection('payments')
    .orderBy('initializedAt', 'desc')
    .limit(limit)
    .get()

  if (snapshot.empty) return []

  // One read per distinct store rather than per payment: a dealer renewing
  // monthly for a year is twelve rows and one business.
  const storeIds = [...new Set(snapshot.docs.map((d) => d.get('storeId') as string))]
  const stores = await getAdminDb().getAll(
    ...storeIds.map((id) => getAdminDb().collection('stores').doc(id)),
  )
  const names = new Map(
    stores.map((s) => [s.id, (s.get('businessName') as string) ?? '(deleted store)']),
  )

  return snapshot.docs.map((doc) => {
    const d = doc.data() as Doc
    const status = (d.status as string) ?? 'pending'
    return {
      reference: doc.id,
      storeId: (d.storeId as string) ?? '',
      store: names.get(d.storeId as string) ?? '(deleted store)',
      plan: (d.plan as string) ?? '—',
      amount: koboToNaira(d.amountKobo as number),
      status,
      paystackStatus: (d.paystackStatus as string) ?? null,
      channel: (d.channel as string) ?? null,
      initializedAt: formatDate(d.initializedAt),
      verifiedAt: d.verifiedAt ? formatDate(d.verifiedAt) : null,
      verifiedVia: (d.verifiedVia as string) ?? null,
      // Succeeded at Paystack, never applied here. Rare, not self-correcting,
      // and the dealer has been charged — so it is surfaced rather than left to
      // be noticed.
      needsSupport: status === 'success' && !d.subscriptionAppliedAt,
    }
  })
}
