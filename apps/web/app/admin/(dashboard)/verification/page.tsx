import { requireAdmin } from '@/lib/admin-session'
import { listStoresForAdmin } from '@/lib/repositories/stores'
import { VerificationClient } from './verification-client'

// requireAdmin() runs before any JSX exists, so an unauthorised request
// produces no RSC payload to leak. The layout gate alone is not enough:
// Next renders layout and page concurrently, so a redirect from the layout
// still lets this page render into the redirect body.
export default async function VerificationPage() {
  await requireAdmin()

  // Read server-side with the Admin SDK. The Firestore rules deliberately
  // forbid clients enumerating stores (`allow list: if isAdmin()`), and dealer
  // records carry CAC numbers, phone numbers and addresses — so this must not
  // be fetched from the browser.
  const businesses = await listStoresForAdmin()

  return <VerificationClient businesses={businesses} />
}
