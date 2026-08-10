import { onCall } from 'firebase-functions/v2/https';
import {
  ERROR_CODE,
  type AdminManageCategoryRequest,
  type AdminManageCategoryResponse,
} from '@nph/contracts';
import { COL, FieldValue, db } from './lib/admin';
import { fail, requireAdmin, requireOneOf, requireString } from './lib/guards';

/**
 * Category taxonomy management (SOW §9, "basic category management").
 *
 * The taxonomy was seeded once and then only changeable by re-running a script
 * with production credentials. This makes it an ordinary administrative action,
 * with the two safeguards that a direct Firestore write could not give:
 *
 *   1. Every change is recorded in `adminActions` by the same function that
 *      makes it, so there is no path that edits the taxonomy anonymously.
 *   2. Deactivating a category is checked against the listings that use it.
 *      That count is a read the client cannot be trusted to have done, and it
 *      is the difference between an informed decision and an accident.
 *
 * There is no delete. A category id is copied onto every listing that selects
 * it, and `categories/{id}` is the only place its display name exists — delete
 * it and those listings render an id, vanish from a filtered view, and cannot
 * be repaired from their own contents. Deactivation removes it from the dealer
 * picker and the marketplace nav, leaves existing listings working, and is
 * reversible.
 */

/** Ids are slugs: lowercase, digits and single hyphens. */
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Listings referencing a category, and how many are live. */
async function usage(categoryId: string): Promise<{ total: number; live: number }> {
  const snap = await db
    .collection(COL.listings)
    .where('categoryId', '==', categoryId)
    .select('status')
    .get();

  return {
    total: snap.size,
    live: snap.docs.filter((d) => d.get('status') === 'active').length,
  };
}

export const adminManageCategory = onCall<
  AdminManageCategoryRequest,
  Promise<AdminManageCategoryResponse>
>(async (request) => {
  const adminId = requireAdmin(request);
  const action = requireOneOf(
    request.data?.action,
    ['create', 'update', 'setActive'] as const,
    'action',
  );
  const categoryId = requireString(request.data?.categoryId, 'categoryId', { max: 60 });

  if (!ID_PATTERN.test(categoryId)) {
    fail(
      'invalid-argument',
      ERROR_CODE.LISTING_INCOMPLETE,
      'A category id may contain only lowercase letters, numbers and hyphens.',
    );
  }

  const ref = db.collection(COL.categories).doc(categoryId);
  const snap = await ref.get();

  if (action === 'create') {
    // Not an update in disguise: silently overwriting an existing category
    // would let a mistyped id rename someone else's live category.
    if (snap.exists) {
      fail('already-exists', ERROR_CODE.CATEGORY_EXISTS, 'That category id already exists.');
    }

    const name = requireString(request.data?.name, 'name', { max: 60 });
    const order = Number(request.data?.order ?? 0);

    await ref.set({
      categoryId,
      name,
      slug: categoryId,
      order: Number.isFinite(order) ? order : 0,
      active: true,
    });
  } else if (action === 'update') {
    if (!snap.exists) {
      fail('not-found', ERROR_CODE.LISTING_INCOMPLETE, 'That category does not exist.');
    }

    // The id is deliberately absent from this patch. It is written onto every
    // listing that chose it, so changing it here would orphan all of them.
    const patch: Record<string, unknown> = {};
    if (request.data?.name !== undefined) {
      patch.name = requireString(request.data.name, 'name', { max: 60 });
    }
    if (request.data?.order !== undefined) {
      const order = Number(request.data.order);
      if (!Number.isFinite(order)) {
        fail('invalid-argument', ERROR_CODE.LISTING_INCOMPLETE, 'Order must be a number.');
      }
      patch.order = order;
    }
    if (Object.keys(patch).length === 0) {
      fail('invalid-argument', ERROR_CODE.LISTING_INCOMPLETE, 'Nothing to update.');
    }

    await ref.update(patch);
  } else {
    if (!snap.exists) {
      fail('not-found', ERROR_CODE.LISTING_INCOMPLETE, 'That category does not exist.');
    }
    if (typeof request.data?.active !== 'boolean') {
      fail('invalid-argument', ERROR_CODE.LISTING_INCOMPLETE, 'active must be true or false.');
    }

    const active = request.data.active;

    if (!active) {
      // Refused while live listings depend on it. Those listings keep their
      // categoryId, so the marketplace would still filter on a category that
      // no longer appears in any nav — findable only by typing the URL.
      // Reactivating is the fix, but only if someone notices.
      const { total, live } = await usage(categoryId);
      if (live > 0) {
        fail(
          'failed-precondition',
          ERROR_CODE.CATEGORY_IN_USE,
          `${live} published listing${live === 1 ? '' : 's'} still use this category. ` +
            'Move or unpublish them first.',
          { listingCount: total },
        );
      }
    }

    await ref.update({ active });
  }

  await db.collection(COL.adminActions).add({
    action: `category.${action}`,
    targetId: categoryId,
    adminId,
    reason: null,
    timestamp: FieldValue.serverTimestamp(),
  });

  const after = await usage(categoryId);
  return { categoryId, listingCount: after.total };
});
