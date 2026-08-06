/**
 * Marketplace view models.
 *
 * The shapes the approved public components render, plus the formatting they
 * share. Deliberately separate from the Firestore documents in @nph/contracts:
 * a `Listing` carries moderation flags, search tokens and denormalised store
 * state that no browser needs, and mapping at the repository boundary keeps
 * those out of the client bundle entirely.
 *
 * Safe to import from client components — types and pure functions only, with
 * no Firebase import of any kind. LISTING_CATEGORIES is a plain array of
 * strings, so importing it here adds no Firebase code to the bundle.
 */

import { LISTING_CATEGORIES, type ListingCategoryId } from '@nph/contracts'

export type Condition = 'New' | 'Used'

/** A public listing, as the product card and detail page render it. */
export type Product = {
  id: string
  name: string
  /** Naira, not kobo. Converted once at the repository boundary. */
  price: number
  condition: Condition
  location: string
  state: string
  storeSlug: string
  storeName: string
  verified: boolean
  category: string
  image: string
  images: string[]
  partNumber: string
  compatible: string
  postedLabel: string
  inStock: boolean
  vehicleMake: string
  vehicleModel: string
  description: string
  /** E.164, for the WhatsApp and call actions. Empty when the dealer set none. */
  storePhone: string
  storeWhatsapp: string
}

/** A public store, as the directory and storefront render it. */
export type Store = {
  slug: string
  name: string
  tagline: string
  address: string
  phone: string
  whatsapp: string
  state: string
  verified: boolean
  activeListings: number
  memberSince: string
  categories: string[]
  about: string
}

export const NAIRA = '₦'

export function formatNaira(value: number): string {
  return `${NAIRA}${value.toLocaleString('en-NG')}`
}

/**
 * Money is stored as integer kobo and displayed in naira.
 *
 * Kept in one place because the two units are trivially confusable and a
 * factor-of-100 pricing error is not a subtle bug to a dealer.
 */
export function koboToNaira(kobo: number): number {
  return Math.round(Number(kobo) || 0) / 100
}

/**
 * The marketplace category nav.
 *
 * Derived from LISTING_CATEGORIES rather than written out, because each tile
 * links to `/parts?category=<id>` and that id goes straight into
 * `where('categoryId', '==', …)`. Any id the dealer app cannot produce is a
 * tile that leads to an empty page.
 *
 * That is not hypothetical. These tiles used to render AUTOMOTIVE_CATEGORIES —
 * 'car', 'motorcycle', 'truck', 'tractor', 'heavy', 'electrical' — which is the
 * vertical a *store* declares at registration (SOW §7), not the category a
 * *part* is filed under. No listing has ever carried `categoryId: 'car'`, so
 * five of the six tiles could only ever return nothing, and the sixth worked by
 * coincidence of both lists containing 'electrical'.
 *
 * Icons live here and not in the contract: they are a web presentation detail,
 * and the Flutter app picks its own.
 */
const CATEGORY_ICONS: Record<ListingCategoryId, string> = {
  engine: 'Cog',
  brake: 'Disc',
  suspension: 'Waves',
  electrical: 'Zap',
  body: 'Car',
  transmission: 'Settings2',
  filters: 'Filter',
  other: 'Wrench',
}

export const categories = LISTING_CATEGORIES.map((c) => ({
  id: c.id,
  label: c.name,
  icon: CATEGORY_ICONS[c.id],
}))

export type CategoryId = ListingCategoryId

/**
 * Nigerian numbers to E.164 digits, which is what wa.me expects.
 *
 * Dealers type 0803…; the country code replaces that trunk zero. Passing
 * "2340803…" to WhatsApp silently opens a chat with no one.
 */
export function toE164Digits(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (!digits) return ''

  if (digits.startsWith('234')) {
    // "+234 (0)803…" is common Nigerian notation, and stripping punctuation
    // leaves the trunk zero stranded after the country code as 2340803….
    // WhatsApp accepts that number and opens a chat with nobody.
    const national = digits.slice(3)
    return `234${national.startsWith('0') ? national.slice(1) : national}`
  }

  if (digits.startsWith('0')) return `234${digits.slice(1)}`
  return `234${digits}`
}

/** "+234 903 672 6262" for display. Falls back to the raw value if unparseable. */
export function formatNigerianPhone(raw: string): string {
  const d = toE164Digits(raw)
  if (d.length !== 13) return raw ?? ''
  return `+${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`
}
