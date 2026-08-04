import 'server-only'

import { koboToNaira, type Condition, type Product, type Store } from '../marketplace'
import { getAdminDb } from '../firebase-admin'

/**
 * Public marketplace reads.
 *
 * Server-side by design, for two reasons:
 *
 *   1. Buyers have no account (SOW §1), so there is no authenticated client to
 *      query with. Server rendering also gives the crawlable HTML the SEO
 *      requirement depends on.
 *   2. Every query filters on `publiclyVisible`, the single backend-maintained
 *      boolean that collapses `status === 'active' && storeApproved &&
 *      storeVisible && !moderation.removed`. Filtering on that one field is
 *      what keeps these reads aligned with the security rule instead of
 *      re-deriving the predicate here, where it could drift.
 *
 * A suspended dealer's listings disappear from the marketplace because a
 * trigger flips that flag — never because this file remembered to check.
 */

type Doc = Record<string, unknown>

const MONTH_YEAR = new Intl.DateTimeFormat('en-NG', { month: 'short', year: 'numeric' })

function toDate(value: unknown): Date | null {
  if (!value) return null
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    return (value as { toDate(): Date }).toDate()
  }
  return value instanceof Date ? value : null
}

/** "3 days ago" — relative, because buyers judge freshness, not calendar dates. */
function postedLabel(value: unknown): string {
  const date = toDate(value)
  if (!date) return 'Recently'

  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? '' : 's'} ago`
  if (days < 365) return `${Math.floor(days / 30)} month${days < 60 ? '' : 's'} ago`
  return MONTH_YEAR.format(date)
}

function toProduct(id: string, d: Doc): Product {
  const images = Array.isArray(d.images)
    ? (d.images as { url?: string }[]).map((i) => i?.url).filter((u): u is string => !!u)
    : []

  const city = (d.storeCity as string) ?? ''
  const state = (d.storeState as string) ?? ''

  return {
    id,
    name: (d.name as string) ?? '',
    price: koboToNaira(d.priceKobo as number),
    // The contract stores lowercase; the design renders capitalised.
    condition: ((d.condition as string) === 'used' ? 'Used' : 'New') as Condition,
    location: [city, state].filter(Boolean).join(', '),
    state,
    storeSlug: (d.storeSlug as string) ?? '',
    storeName: (d.storeBusinessName as string) ?? '',
    // Only approved stores are ever publicly visible, so anything returned by
    // these queries is by definition from a verified dealer.
    verified: true,
    category: (d.categoryId as string) ?? '',
    image: images[0] ?? '',
    images,
    partNumber: (d.partNumber as string) ?? '',
    compatible: [d.compatibleMake, d.compatibleModel].filter(Boolean).join(' '),
    postedLabel: postedLabel(d.publishedAt ?? d.createdAt),
    inStock: Number(d.quantity ?? 0) > 0,
    vehicleMake: (d.compatibleMake as string) ?? '',
    vehicleModel: (d.compatibleModel as string) ?? '',
    description: (d.description as string) ?? '',
    storePhone: (d.storePhone as string) ?? '',
    storeWhatsapp: (d.storeWhatsapp as string) ?? '',
  }
}

function toStore(d: Doc, categories: string[] = []): Store {
  const city = (d.city as string) ?? ''
  const state = (d.state as string) ?? ''
  const created = toDate(d.approvedAt ?? d.createdAt)

  return {
    slug: (d.slug as string) ?? '',
    name: (d.businessName as string) ?? '',
    tagline: [city, state].filter(Boolean).join(', ') || 'Automotive parts dealer',
    address: (d.address as string) ?? '',
    phone: (d.phone as string) ?? '',
    whatsapp: (d.whatsapp as string) ?? '',
    state,
    verified: true,
    activeListings: Number(d.activeListingCount ?? 0),
    memberSince: created ? MONTH_YEAR.format(created) : '—',
    categories,
    about: (d.description as string) ?? '',
  }
}

/**
 * Publicly visible listings, newest first.
 *
 * `limit` is applied in Firestore rather than after fetching, so an unbounded
 * marketplace never turns into an unbounded read.
 */
export async function listPublicListings(options: {
  categoryId?: string
  state?: string
  storeSlug?: string
  limit?: number
} = {}): Promise<Product[]> {
  let query = getAdminDb()
    .collection('listings')
    .where('publiclyVisible', '==', true)

  if (options.categoryId) query = query.where('categoryId', '==', options.categoryId)
  if (options.state) query = query.where('storeState', '==', options.state)
  if (options.storeSlug) query = query.where('storeSlug', '==', options.storeSlug)

  const snapshot = await query.limit(options.limit ?? 60).get()

  return snapshot.docs
    .map((doc) => toProduct(doc.id, doc.data()))
    // Sorted here rather than with orderBy: combining orderBy with the filters
    // above would demand a composite index per filter combination, and Phase 1
    // volumes do not justify five indexes to order one page of results.
    .sort((a, b) => b.postedLabel.localeCompare(a.postedLabel))
}

export async function getPublicListing(listingId: string): Promise<Product | null> {
  const doc = await getAdminDb().collection('listings').doc(listingId).get()
  if (!doc.exists) return null

  const data = doc.data() as Doc
  // Re-checked on the single-document path: a `get` bypasses the query filter,
  // so without this a removed or suspended listing stays reachable by URL.
  if (data.publiclyVisible !== true) return null

  return toProduct(doc.id, data)
}

/** Approved, visible stores for the directory. */
export async function listPublicStores(limit = 60): Promise<Store[]> {
  const snapshot = await getAdminDb()
    .collection('stores')
    .where('status', '==', 'approved')
    .where('visible', '==', true)
    .limit(limit)
    .get()

  return snapshot.docs
    .map((doc) => toStore(doc.data()))
    .filter((store) => store.slug)
    .sort((a, b) => b.activeListings - a.activeListings)
}

export async function getPublicStore(slug: string): Promise<Store | null> {
  const snapshot = await getAdminDb()
    .collection('stores')
    .where('slug', '==', slug)
    .where('status', '==', 'approved')
    .where('visible', '==', true)
    .limit(1)
    .get()

  if (snapshot.empty) return null

  const listings = await listPublicListings({ storeSlug: slug })
  const categories = [...new Set(listings.map((l) => l.category).filter(Boolean))]

  return toStore(snapshot.docs[0]!.data(), categories)
}

/** Slugs for generateStaticParams. Empty is valid — a new project has no stores. */
export async function listPublicStoreSlugs(): Promise<string[]> {
  const stores = await listPublicStores(200)
  return stores.map((s) => s.slug)
}

export async function listPublicListingIds(): Promise<string[]> {
  const snapshot = await getAdminDb()
    .collection('listings')
    .where('publiclyVisible', '==', true)
    .limit(200)
    .get()
  return snapshot.docs.map((doc) => doc.id)
}
