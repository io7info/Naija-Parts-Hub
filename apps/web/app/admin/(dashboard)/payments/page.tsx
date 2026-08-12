import { requireAdmin } from '@/lib/admin-session'
import { listPayments } from '@/lib/repositories/admin-metrics'
import { PaymentsClient } from './payments-client'

// requireAdmin() runs before any JSX exists, so an unauthorised request
// produces no RSC payload to leak. The layout gate alone is not enough:
// Next renders layout and page concurrently, so a redirect from the layout
// still lets this page render into the redirect body.
export default async function PaymentsPage() {
  await requireAdmin()

  // Every dealer's transactions, which no client query may do — `payments`
  // scopes a dealer to their own. SOW §9, "Paystack payment-reference review".
  const payments = await listPayments()

  return <PaymentsClient payments={payments} />
}
