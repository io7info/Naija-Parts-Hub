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

export type ListingQuery = {
  /** Free text, matched against the prefix tokens the trigger generates. */
  search?: string
  categoryId?: string
  state?: string
  condition?: Condition
  storeId?: string
  limit?: number
}

/** What the caller asked for, and what the query could actually apply. */
export type ListingResults = {
  products: Product[]
  /** Filters left for the client, because no index covers them together. */
  unapplied: { state?: string; condition?: Condition }
  /** True when the limit was reached, so results are a page, not the whole set. */
  truncated: boolean
}

/**
 * The filter combinations firestore.indexes.json actually covers.
 *
 * Firestore needs a composite index per combination of equality filters plus an
 * `orderBy`, and it fails the query outright rather than degrading. Rather than
 * guess, this mirrors the declared indexes exactly:
 *
 *   search | search+category | category | category+state | category+condition
 *   state  | condition       | storeId  | (none)
 *
 * Anything else — search+state, state+condition, all three — has no index, so
 * the widest supported subset runs in Firestore and the remainder is handed
 * back for the client to refine. That keeps ordering and the limit meaningful
 * server-side without adding an index per permutation a buyer might click.
 */
function planFilters(q: ListingQuery) {
  const applied: ListingQuery = {}
  const unapplied: ListingResults['unapplied'] = {}

  if (q.search) {
    applied.search = q.search
    if (q.categoryId) applied.categoryId = q.categoryId
    if (q.state) unapplied.state = q.state
    if (q.condition) unapplied.condition = q.condition
    return { applied, unapplied }
  }

  if (q.categoryId) {
    applied.categoryId = q.categoryId
    // Only one of these can join category in an index; state is the more
    // selective of the two in this market, and condition is a coarse binary.
    if (q.state) {
      applied.state = q.state
      if (q.condition) unapplied.condition = q.condition
    } else if (q.condition) {
      applied.condition = q.condition
    }
    return { applied, unapplied }
  }

  if (q.state) {
    applied.state = q.state
    if (q.condition) unapplied.condition = q.condition
    return { applied, unapplied }
  }

  if (q.condition) applied.condition = q.condition
  return { applied, unapplied }
}

/**
 * Publicly visible listings, genuinely newest first.
 *
 * Ordering is `orderBy('createdAt', 'desc')` in Firestore. It used to be a
 * client-side sort on `postedLabel`, which compares strings like "Today",
 * "Yesterday" and "3 days ago" alphabetically — so the marketplace was not in
 * date order at all, and the limit selected an arbitrary page rather than the
 * newest one.
 *
 * `limit` is applied in Firestore rather than after fetching, so an unbounded
 * marketplace never turns into an unbounded read.
 */
export async function listPublicListings(q: ListingQuery = {}): Promise<ListingResults> {
  const { applied, unapplied } = planFilters(q)
  const limit = q.limit ?? 60

  let query = getAdminDb()
    .collection('listings')
    .where('publiclyVisible', '==', true)

  if (applied.search) {
    // Prefix tokens, lowercased to match generateSearchTokens. Buys "bra" ->
    // "brake"; buys no typo tolerance, which is the documented trade.
    query = query.where('searchTokens', 'array-contains', applied.search.trim().toLowerCase())
  }
  if (applied.categoryId) query = query.where('categoryId', '==', applied.categoryId)
  if (applied.state) query = query.where('storeState', '==', applied.state)
  if (applied.condition) {
    query = query.where('condition', '==', applied.condition === 'Used' ? 'used' : 'new')
  }
  if (q.storeId) query = query.where('storeId', '==', q.storeId)

  const snapshot = await query.orderBy('createdAt', 'desc').limit(limit).get()

  return {
    products: snapshot.docs.map((doc) => toProduct(doc.id, doc.data())),
    unapplied,
    truncated: snapshot.size === limit,
  }
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

/**
 * A storefront and its listings in one call.
 *
 * The listings come back rather than being fetched again by the caller: the
 * store's category chips are derived from them, so the query has to run here
 * anyway, and `storeId` is the dealer's auth uid — returning it so a page could
 * re-query would put that uid in public HTML.
 */
export async function getPublicStore(
  slug: string,
): Promise<{ store: Store; products: Product[] } | null> {
  const snapshot = await getAdminDb()
    .collection('stores')
    .where('slug', '==', slug)
    .where('status', '==', 'approved')
    .where('visible', '==', true)
    .limit(1)
    .get()

  if (snapshot.empty) return null

  // By id, not slug: `publiclyVisible + storeId + createdAt` is indexed and
  // `storeSlug` is not, and the ordered query needs an index to run at all.
  const doc = snapshot.docs[0]!
  const { products } = await listPublicListings({ storeId: doc.id, limit: 120 })
  const categories = [...new Set(products.map((l) => l.category).filter(Boolean))]

  return { store: toStore(doc.data(), categories), products }
}

/**
 * States a buyer can usefully filter by.
 *
 * Derived from the approved, visible stores rather than a hardcoded list. The
 * previous four names were a design placeholder; Nigeria has 36 states plus the
 * FCT, and offering all 37 would give a buyer 33 filters that return nothing.
 * Offering only the states with a verified dealer in them means every option in
 * the list leads somewhere.
 *
 * Reads stores rather than listings because there are far fewer of them and a
 * store's state is the same state the listings denormalize onto themselves.
 */
export async function listMarketplaceStates(): Promise<string[]> {
  const snapshot = await getAdminDb()
    .collection('stores')
    .where('status', '==', 'approved')
    .where('visible', '==', true)
    .select('state')
    .get()

  return [...new Set(snapshot.docs.map((d) => d.get('state') as string).filter(Boolean))].sort()
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
