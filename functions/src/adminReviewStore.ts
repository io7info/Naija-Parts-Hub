import { onCall } from 'firebase-functions/v2/https';
import {
  ERROR_CODE,
  identityVerified,
  isMechanic,
  type AdminModerateListingRequest,
  type AdminReviewStoreRequest,
  type Listing,
  type Store,
} from '@nph/contracts';
import { COL, FieldValue, Timestamp, db, listingRef, storeRef } from './lib/admin';
import { fail, requireAdmin, requireOneOf, requireString } from './lib/guards';
import { resolveKeyring, trustCompromised } from './lib/identity';

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

  /**
   * A mechanic cannot be approved until BVN and NIN have been verified.
   *
   * The client's requirement, enforced here rather than in the admin UI,
   * because the UI is not a security boundary: this callable is reachable
   * with any administrator's token. Hiding the button would make the rule a
   * convention; refusing the action makes it a fact.
   *
   * Only 'approve' and 'reactivate' are gated. An unverified mechanic can
   * still be rejected or suspended — those are how an administrator disposes
   * of an application that will never verify, and blocking them would leave
   * such records stuck in the queue forever.
   *
   * Dealers are untouched: they carry no identity block, and isMechanic() is
   * false for every one of them including the legacy records with no
   * businessType field at all.
   */
  const store = snap.data() as Store;
  const approving = action === 'approve' || action === 'reactivate';

  if (approving && isMechanic(store) && !identityVerified(store)) {
    fail(
      'failed-precondition',
      ERROR_CODE.IDENTITY_NOT_VERIFIED,
      'This mechanic has not completed BVN and NIN verification, so they cannot be approved yet.',
    );
  }

  /**
   * A verification produced under a compromised fingerprint key is not
   * evidence any more.
   *
   * When a key leaks, anyone holding it can recover the identifiers behind
   * stored fingerprints — eleven digits is a small enough space to enumerate —
   * and mint a fingerprint that collides with a real one, which is exactly what
   * the duplicate-account check assumes is impossible. So a record written
   * under such a key must be re-verified rather than trusted indefinitely.
   *
   * FAILS CLOSED, AND ONLY FOR MECHANICS.
   *
   * An earlier version treated an unreadable keyring as "no compromise known"
   * and allowed the approval, so that a missing secret could not freeze the
   * dealer queue this callable also serves. That was fail-open on a security
   * decision: the one circumstance where the keyring is missing is the same
   * circumstance where nobody can tell whether a key was withdrawn.
   *
   * The dealer queue is protected by the guard below rather than by weakening
   * the check — dealers never enter this branch at all, so an unreadable
   * keyring cannot affect them. For a mechanic it is reported as a temporary
   * platform fault, which is what it is: not a judgement about the mechanic,
   * and not a pass.
   */
  if (approving && isMechanic(store)) {
    let ring;
    try {
      ring = resolveKeyring();
    } catch {
      fail(
        'unavailable',
        ERROR_CODE.IDENTITY_PROVIDER_UNAVAILABLE,
        'Identity verification is not configured, so mechanic approvals are paused. ' +
          'This is a configuration problem, not a problem with this application.',
      );
      throw new Error('unreachable');
    }

    if (trustCompromised(ring, store.identity?.fingerprintKeyVersion)) {
      fail(
        'failed-precondition',
        ERROR_CODE.IDENTITY_NOT_VERIFIED,
        'This mechanic was verified using a key that has since been withdrawn. ' +
          'They must complete verification again before approval.',
      );
    }
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
