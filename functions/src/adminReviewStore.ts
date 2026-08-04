import { onCall } from 'firebase-functions/v2/https';
import {
  ERROR_CODE,
  type AdminModerateListingRequest,
  type AdminReviewStoreRequest,
  type Listing,
} from '@nph/contracts';
import { COL, FieldValue, Timestamp, db, listingRef, storeRef } from './lib/admin';
import { fail, requireAdmin, requireOneOf, requireString } from './lib/guards';

/**
 * Admin verification actions (SOW section 3) and listing moderation (§9).
 *
 * Callables rather than direct writes because `status` and `visible` are
 * backend-controlled: a dealer with a valid token could otherwise approve
 * themselves through the REST API. Admin identity comes from a custom claim,
 * never from a Firestore document.
 */

export const adminReviewStore = onCall<AdminReviewStoreRequest>(async (request) => {
  const adminId = requireAdmin(request);
  const storeId = requireString(request.data?.storeId, 'storeId', { max: 128 });
  const action = requireOneOf(
    request.data?.action,
    ['approve', 'reject', 'suspend', 'reactivate'] as const,
    'action',
  );

  if ((action === 'reject' || action === 'suspend') && !request.data?.reason?.trim()) {
    fail('invalid-argument', ERROR_CODE.LISTING_INCOMPLETE, 'A reason is required.');
  }

  const ref = storeRef(storeId);
  const snap = await ref.get();
  if (!snap.exists) {
    fail('not-found', ERROR_CODE.STORE_NOT_APPROVED, 'Store not found.');
  }

  const now = Timestamp.now();
  const patch: Record<string, unknown> = { updatedAt: now, reviewedBy: adminId };

  switch (action) {
    case 'approve':
      patch.status = 'approved';
      patch.visible = true;
      patch.approvedAt = now;
      patch.rejectionReason = null;
      break;
    case 'reject':
      patch.status = 'rejected';
      patch.visible = false;
      patch.rejectionReason = request.data.reason?.trim() ?? null;
      break;
    case 'suspend':
      // Status, not deletion: listings come down but the dealer's data and
      // slug survive so a reactivation restores everything intact.
      patch.status = 'suspended';
      patch.visible = false;
      patch.rejectionReason = request.data.reason?.trim() ?? null;
      break;
    case 'reactivate':
      patch.status = 'approved';
      patch.visible = true;
      patch.rejectionReason = null;
      break;
  }

  await ref.update(patch);

  // onStoreWritten fans the visibility change out to this store's listings.
  await db.collection(COL.adminActions).add({
    action: `store.${action}`,
    targetId: storeId,
    adminId,
    reason: request.data?.reason?.trim() ?? null,
    timestamp: FieldValue.serverTimestamp(),
  });

  return { storeId, action, status: patch.status };
});

export const adminModerateListing = onCall<AdminModerateListingRequest>(async (request) => {
  const adminId = requireAdmin(request);
  const listingId = requireString(request.data?.listingId, 'listingId', { max: 128 });
  const action = requireOneOf(request.data?.action, ['remove', 'restore'] as const, 'action');

  const ref = listingRef(listingId);
  const snap = await ref.get();
  if (!snap.exists) {
    fail('not-found', ERROR_CODE.LISTING_INCOMPLETE, 'Listing not found.');
  }
  const listing = snap.data() as Listing;
  const now = Timestamp.now();

  const removed = action === 'remove';
  await ref.update({
    moderation: {
      removed,
      removedBy: removed ? adminId : null,
      removedReason: removed ? (request.data?.reason?.trim() ?? null) : null,
      removedAt: removed ? now : null,
    },
    // Removal hides the listing immediately regardless of its own status.
    publiclyVisible: removed
      ? false
      : listing.status === 'active' && listing.storeApproved && listing.storeVisible,
    updatedAt: now,
  });

  await db.collection(COL.adminActions).add({
    action: `listing.${action}`,
    targetId: listingId,
    adminId,
    reason: request.data?.reason?.trim() ?? null,
    timestamp: FieldValue.serverTimestamp(),
  });

  return { listingId, action };
});
