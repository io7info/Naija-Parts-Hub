import 'server-only'

import {
  MECHANIC_SPECIALTIES,
  businessTypeOf,
  type BusinessType,
  type IdentityStatus,
  type StoreStatus,
} from '@nph/contracts'

import { getAdminDb } from '../firebase-admin'

/** Specialty ids are stored; labels are display. Unknown ids are dropped. */
const SPECIALTY_LABELS: ReadonlyMap<string, string> = new Map<string, string>(
  MECHANIC_SPECIALTIES.map((s) => [s.id, s.label]),
)

/**
 * Store reads for the admin console.
 *
 * Server-side via the Admin SDK, so the browser never queries the `stores`
 * collection directly. That matters because dealer records carry CAC numbers,
 * phone numbers and addresses, and the Firestore rules deliberately forbid
 * enumerating stores from a client — `allow list: if isAdmin()`. Fetching here
 * keeps that rule intact rather than working around it.
 *
 * Every function assumes the caller has already passed requireAdmin(). The
 * Admin SDK bypasses security rules entirely, so authorisation must happen
 * before anything in this file runs.
 */

/** The shape the approved verification UI renders. */
export type AdminBusiness = {
  id: string
  /**
   * Which intake this application came through.
   *
   * Dealers and mechanics are reviewed against different criteria — a dealer
   * supplies a CAC number, a mechanic supplies verified BVN and NIN — so an
   * administrator has to be able to tell them apart before deciding anything.
   */
  businessType: BusinessType
  name: string
  owner: string
  cac: string
  phone: string
  whatsapp: string
  location: string
  submitted: string
  status: StoreStatus
  email: string
  address: string
  description: string
  slug: string
  activeListingCount: number
  rejectionReason: string | null

  /** Mechanics only. Services advertised, for the reviewer's context. */
  services: string[]
  /** Mechanics only. Count alone — the photos themselves are on the profile. */
  photoCount: number

  /**
   * Identity verification, mechanics only.
   *
   * Carries the status, the last four digits and the government name — enough
   * for an administrator to resolve a manual review, and nothing more. The
   * fingerprints are absent: they exist for duplicate detection and would be
   * meaningless here, and the raw identifiers were never stored at all.
   *
   * `adminReviewStore` refuses to approve a mechanic whose status is not
   * 'verified', so this is not merely informational — it explains a button
   * that will otherwise fail.
   */
  identity: {
    status: IdentityStatus
    verifiedName: string | null
    nameMatch: boolean | null
    bvnLast4: string | null
    ninLast4: string | null
    verifiedAt: string
    attempts: number
    /** Set when a withdrawn fingerprint key forced re-verification. */
    reverificationRequired: boolean
  } | null
}

const DATE = new Intl.DateTimeFormat('en-NG', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

/** Firestore Timestamp | Date | undefined -> display string. */
function formatSubmitted(value: unknown): string {
  if (!value) return '—'
  const date =
    typeof value === 'object' && value !== null && 'toDate' in value
      ? (value as { toDate(): Date }).toDate()
      : value instanceof Date
        ? value
        : null
  return date ? DATE.format(date) : '—'
}

function toBusiness(id: string, d: Record<string, unknown>): AdminBusiness {
  const city = (d.city as string) ?? ''
  const state = (d.state as string) ?? ''

  // Legacy stores carry no businessType — every one of them is a dealer.
  const businessType = businessTypeOf(d as { businessType?: BusinessType })
  const mechanic = (d.mechanic ?? {}) as { specialties?: unknown; photos?: unknown }
  const identity = (d.identity ?? null) as Record<string, unknown> | null

  return {
    id,
    businessType,
    services: Array.isArray(mechanic.specialties)
      ? (mechanic.specialties as string[])
          .map((sid) => SPECIALTY_LABELS.get(sid))
          .filter((l): l is string => Boolean(l))
      : [],
    photoCount: Array.isArray(mechanic.photos) ? mechanic.photos.length : 0,
    // Only mechanics have one, and only mechanics are gated on it.
    identity:
      businessType === 'mechanic' && identity
        ? {
            status: (identity.status as IdentityStatus) ?? 'unverified',
            verifiedName: (identity.verifiedName as string) ?? null,
            nameMatch: (identity.nameMatch as boolean) ?? null,
            bvnLast4: (identity.bvnLast4 as string) ?? null,
            ninLast4: (identity.ninLast4 as string) ?? null,
            verifiedAt: formatSubmitted(identity.verifiedAt),
            attempts: Number(identity.attempts ?? 0),
            reverificationRequired: Boolean(identity.reverificationRequiredAt),
          }
        : null,
    name: (d.businessName as string) || '(no name)',
    owner: (d.ownerName as string) ?? '—',
    cac: (d.cacNumber as string) ?? '—',
    phone: (d.phone as string) ?? '—',
    whatsapp: (d.whatsapp as string) ?? '',
    location: [city, state].filter(Boolean).join(', ') || '—',
    submitted: formatSubmitted(d.createdAt),
    status: ((d.status as StoreStatus) ?? 'pending'),
    // Registration collects no email — dealers authenticate by phone. Showing
    // a blank field is honest; inventing one would not be.
    email: '',
    address: (d.address as string) ?? '—',
    description: (d.description as string) ?? '',
    slug: (d.slug as string) ?? '',
    activeListingCount: Number(d.activeListingCount ?? 0),
    rejectionReason: (d.rejectionReason as string) ?? null,
  }
}

/**
 * All stores, newest first.
 *
 * Deliberately unfiltered: the verification screen shows counts for every
 * status tab at once, so filtering server-side would mean four round trips or
 * an inaccurate "All" count. Dealer volume in Phase 1 is small enough that one
 * read is cheaper; revisit with pagination when it isn't.
 */
export async function listStoresForAdmin(): Promise<AdminBusiness[]> {
  const snapshot = await getAdminDb().collection('stores').get()

  return snapshot.docs
    .map((doc) => toBusiness(doc.id, doc.data()))
    .sort((a, b) => {
      // Pending first — it is the queue an administrator actually works.
      if (a.status === 'pending' && b.status !== 'pending') return -1
      if (b.status === 'pending' && a.status !== 'pending') return 1
      return a.name.localeCompare(b.name)
    })
}

export async function getStoreForAdmin(storeId: string): Promise<AdminBusiness | null> {
  const doc = await getAdminDb().collection('stores').doc(storeId).get()
  return doc.exists ? toBusiness(doc.id, doc.data() as Record<string, unknown>) : null
}
