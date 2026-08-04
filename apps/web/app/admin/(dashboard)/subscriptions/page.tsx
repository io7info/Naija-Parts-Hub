import { requireAdmin } from '@/lib/admin-session'
import { listSubscriptions } from '@/lib/repositories/admin-metrics'
import { SubscriptionsClient } from './subscriptions-client'

// requireAdmin() runs before any JSX exists, so an unauthorised request
// produces no RSC payload to leak. The layout gate alone is not enough:
// Next renders layout and page concurrently, so a redirect from the layout
// still lets this page render into the redirect body.
export default async function AdminSubscriptionsPage() {
  await requireAdmin()

  const subscriptions = await listSubscriptions()

  return <SubscriptionsClient subscriptions={subscriptions} />
}
