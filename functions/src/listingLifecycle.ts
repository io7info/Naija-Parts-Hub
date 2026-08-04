import { onCall } from 'firebase-functions/v2/https';
import {
  ERROR_CODE,
  type DeleteListingRequest,
  type Listing,
  type UnpublishListingRequest,
} from '@nph/contracts';
import { FieldValue, Timestamp, auth, db, listingRef, storage, storeRef } from './lib/admin';
import { fail, requireAuth, requireString } from './lib/guards';

/**
 * Unpublish and delete.
 *
 * Both run as callables rather than client writes so `activeListingCount` — the
 * value publishListing's transaction depends on — can never drift. If a dealer
 * could archive a listing with a direct write, the counter would over-report and
 * they would be locked out below their real limit.
 */

async function releaseActiveSlot(
  uid: string,
  listingId: string,
  mode: 'archive' | 'delete',
): Promise<{ activeListingCount: number }> {
  return db.runTransaction(async (tx) => {
    const sRef = storeRef(uid);
    const lRef = listingRef(listingId);
    // getAll returns one snapshot per ref, in order.
    const snaps = await tx.getAll(sRef, lRef);
    const storeSnap = snaps[0]!;
    const listingSnap = snaps[1]!;

    if (!listingSnap.exists) {
      fail('not-found', ERROR_CODE.LISTING_INCOMPLETE, 'Listing not found.');
    }
    const listing = listingSnap.data() as Listing;
    if (listing.storeId !== uid) {
      fail('permission-denied', ERROR_CODE.STORE_NOT_APPROVED, 'Listing belongs to another store.');
    }

    const wasActive = listing.status === 'active';
    const currentCount = storeSnap.exists
      ? ((storeSnap.data()?.activeListingCount as number | undefined) ?? 0)
      : 0;
    const now = Timestamp.now();

    if (mode === 'delete') {
      tx.delete(lRef);
    } else {
      tx.update(lRef, {
        status: 'archived',
        publiclyVisible: false,
        updatedAt: now,
      });
    }

    if (wasActive && storeSnap.exists) {
      // Clamp at zero. Without this, a counter that has drifted low would go
      // negative and silently hand the dealer extra free listings.
      const next = Math.max(0, currentCount - 1);
      tx.update(sRef, { activeListingCount: next, updatedAt: now });
      return { activeListingCount: next };
    }

    return { activeListingCount: currentCount };
  });
}

export const unpublishListing = onCall<UnpublishListingRequest>(async (request) => {
  const uid = requireAuth(request);
  const listingId = requireString(request.data?.listingId, 'listingId', { max: 128 });
  const { activeListingCount } = await releaseActiveSlot(uid, listingId, 'archive');
  return { listingId, status: 'archived' as const, activeListingCount };
});

export const deleteListing = onCall<DeleteListingRequest>(async (request) => {
  const uid = requireAuth(request);
  const listingId = requireString(request.data?.listingId, 'listingId', { max: 128 });

  // Capture image paths before the document goes away.
  const snap = await listingRef(listingId).get();
  const images = ((snap.data()?.images as { path?: string }[] | undefined) ?? [])
    .map((i) => i.path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0);

  const { activeListingCount } = await releaseActiveSlot(uid, listingId, 'delete');

  // Best-effort Storage cleanup. A failure here must not fail the delete — the
  // document is already gone and the objects are orphaned at worst.
  await Promise.allSettled(images.map((path) => storage().bucket().file(path).delete()));

  return { listingId, deleted: true, activeListingCount };
});

/**
 * Account deletion (Apple Guideline 5.1.1(v) / Google Play requirement).
 *
 * Not named in the SOW. Flagged during review as a hard store-rejection risk
 * for any app with account registration, and added to Phase 1 scope.
 */
export const deleteAccount = onCall(async (request) => {
  const uid = requireAuth(request);
  if (request.data?.confirmation !== 'DELETE') {
    fail('invalid-argument', ERROR_CODE.LISTING_INCOMPLETE, 'Confirmation required.');
  }

  const listings = await db.collection('listings').where('storeId', '==', uid).get();

  // Storage objects first — once the documents are gone we lose the paths.
  const paths = listings.docs.flatMap((d) =>
    ((d.data().images as { path?: string }[] | undefined) ?? [])
      .map((i) => i.path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0),
  );
  await Promise.allSettled(paths.map((p) => storage().bucket().file(p).delete()));

  const storeSnap = await storeRef(uid).get();
  const slug = storeSnap.data()?.slug as string | undefined;

  const batch = db.batch();
  listings.docs.forEach((d) => batch.delete(d.ref));
  if (slug) batch.delete(db.collection('storeSlugs').doc(slug));
  batch.delete(storeRef(uid));
  await batch.commit();

  await db.collection('adminActions').add({
    action: 'account.deleted',
    targetId: uid,
    adminId: null,
    timestamp: FieldValue.serverTimestamp(),
  });

  // Last: revoking the auth user invalidates the token making this call.
  await auth().deleteUser(uid);

  return { deleted: true };
});
