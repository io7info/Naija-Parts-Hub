import 'server-only'

import { type Category } from '@nph/contracts'
import { getAdminDb } from '../firebase-admin'

/**
 * The listing taxonomy, read from Firestore.
 *
 * Firestore is the source of truth, not `LISTING_CATEGORIES` in the contracts.
 * That constant is what the collection is *seeded* with; once an administrator
 * can add a category from the portal, a hardcoded list in the web bundle would
 * mean a new category appears in the dealer app immediately and on the
 * marketplace only after a deploy.
 *
 * Read through the Admin SDK for the same reason as every other public read:
 * buyers have no account, and the page is server-rendered so a crawler sees
 * the categories without running JS. The rules allow public reads of this
 * collection either way — nothing here is sensitive — so this is about
 * rendering, not access.
 */

/** Active categories in the administrator's chosen order. */
export async function listCategories(): Promise<Category[]> {
  const snapshot = await getAdminDb().collection('categories').where('active', '==', true).get()

  return snapshot.docs
    .map((doc) => ({ ...(doc.data() as Category), categoryId: doc.id }))
    // Sorted here rather than with orderBy: combining it with the `active`
    // filter needs a composite index, and a taxonomy of this size does not
    // justify one. The dealer app sorts the same way for the same reason.
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

/** Every category including deactivated ones — the admin portal's view. */
export async function listAllCategories(): Promise<Category[]> {
  const snapshot = await getAdminDb().collection('categories').get()

  return snapshot.docs
    .map((doc) => ({ ...(doc.data() as Category), categoryId: doc.id }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

/**
 * How many listings reference each category, and how many of those are live.
 *
 * The portal needs both numbers before it will let an administrator deactivate
 * a category: deactivating one that dealers are actively using hides it from
 * the picker while leaving their listings pointing at it, which is survivable —
 * but doing it unknowingly is not.
 *
 * One read of the listings collection rather than a count query per category,
 * because Phase 1 volumes are small and eight aggregation queries cost more
 * than one scan of a few hundred documents.
 */
export async function categoryUsage(): Promise<Record<string, { total: number; live: number }>> {
  const snapshot = await getAdminDb().collection('listings').select('categoryId', 'status').get()

  const usage: Record<string, { total: number; live: number }> = {}
  for (const doc of snapshot.docs) {
    const id = doc.get('categoryId') as string | undefined
    if (!id) continue
    usage[id] ??= { total: 0, live: 0 }
    usage[id].total += 1
    if (doc.get('status') === 'active') usage[id].live += 1
  }
  return usage
}
