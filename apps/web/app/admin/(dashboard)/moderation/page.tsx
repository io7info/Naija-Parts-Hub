import { requireAdmin } from '@/lib/admin-session'
import { listListingsForModeration } from '@/lib/repositories/admin-metrics'
import { ModerationClient } from './moderation-client'

// requireAdmin() runs before any JSX exists, so an unauthorised request
// produces no RSC payload to leak. The layout gate alone is not enough:
// Next renders layout and page concurrently, so a redirect from the layout
// still lets this page render into the redirect body.
export default async function ModerationPage() {
  await requireAdmin()

  // Read with the Admin SDK: the moderation queue must include listings that
  // are already removed or still drafts, which no client query is allowed to
  // see under the security rules.
  const listings = await listListingsForModeration()

  return <ModerationClient listings={listings} />
}
