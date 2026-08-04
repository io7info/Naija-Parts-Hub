import 'server-only'

import type { StoreStatus } from '@nph/contracts'

import { getAdminDb } from '../firebase-admin'

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
  return {
    id,
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
