import { onCall } from 'firebase-functions/v2/https';
import {
  ERROR_CODE,
  FIELD_LIMITS,
  slugCandidates,
  slugify,
  validateSlug,
  type RegisterStoreRequest,
  type RegisterStoreResponse,
} from '@nph/contracts';
import { COL, FieldValue, Timestamp, db, slugRef, storeRef } from './lib/admin';
import { fail, requireAuth, requireString } from './lib/guards';

/**
 * Dealer registration (SOW section 2).
 *
 * The store document id is the caller's uid, so ownership checks in security
 * rules reduce to `uid == storeId` and there is no way to register on behalf of
 * someone else.
 *
 * Runs as a callable rather than a client write because the slug must be
 * reserved atomically: Firestore has no unique constraint, so uniqueness is
 * enforced by creating `storeSlugs/{slug}` inside the same transaction. The
 * create fails if the id already exists, and we fall through to the next
 * candidate.
 *
 * Status is always 'pending'. Approval is a separate admin action (SOW §3).
 */
export const registerStore = onCall<RegisterStoreRequest, Promise<RegisterStoreResponse>>(
  async (request) => {
    const uid = requireAuth(request);
    const data = request.data ?? ({} as RegisterStoreRequest);

    if (data.acceptedTerms !== true) {
      fail(
        'invalid-argument',
        ERROR_CODE.LISTING_INCOMPLETE,
        'Terms and Privacy Policy must be accepted.',
      );
    }

    const profile = {
      businessName: requireString(data.businessName, 'businessName', {
        max: FIELD_LIMITS.businessName,
      }),
      ownerName: requireString(data.ownerName, 'ownerName', { max: FIELD_LIMITS.ownerName }),
      // Trust the verified phone on the token over anything the client sends.
      phone: (request.auth?.token.phone_number as string | undefined) ?? requireString(data.phone, 'phone', { max: 20 }),
      whatsapp: typeof data.whatsapp === 'string' ? data.whatsapp.trim().slice(0, 20) : '',
      cacNumber: requireString(data.cacNumber, 'cacNumber', { max: 40 }),
      address: requireString(data.address, 'address', { max: FIELD_LIMITS.address }),
      state: requireString(data.state, 'state', { max: 60 }),
      city: requireString(data.city, 'city', { max: 60 }),
      description:
        typeof data.description === 'string'
          ? data.description.trim().slice(0, FIELD_LIMITS.description)
          : '',
    };

    // An explicit preferred slug must be valid; otherwise derive from the name.
    if (data.preferredSlug) {
      const rejection = validateSlug(slugify(data.preferredSlug));
      if (rejection) {
        fail('invalid-argument', ERROR_CODE.SLUG_TAKEN, `Store URL rejected: ${rejection}.`);
      }
    }

    const candidates = slugCandidates(data.preferredSlug || profile.businessName);
    const ref = storeRef(uid);

    const slug = await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) {
        fail('already-exists', ERROR_CODE.ALREADY_REGISTERED, 'This account already has a store.');
      }

      // Read every candidate first — Firestore transactions require all reads
      // before any write.
      const slugSnaps = await tx.getAll(...candidates.map((c) => slugRef(c)));
      const free = slugSnaps.find((s) => !s.exists);
      if (!free) {
        fail('resource-exhausted', ERROR_CODE.SLUG_TAKEN, 'Could not allocate a store URL.');
      }
      const chosen = free.id;

      const now = Timestamp.now();
      tx.create(slugRef(chosen), { storeId: uid, createdAt: now });
      tx.create(ref, {
        storeId: uid,
        ...profile,

        // --- backend-controlled from here (ADR-001 #4) ---
        slug: chosen,
        status: 'pending',
        rejectionReason: null,
        visible: false,
        activeListingCount: 0,
        subscription: {
          plan: 'free',
          status: 'none',
          startedAt: null,
          expiresAt: null,
          graceEndsAt: null,
          lastPaymentReference: null,
        },
        termsAcceptedAt: now,
        createdAt: now,
        updatedAt: now,
        approvedAt: null,
        reviewedBy: null,
      });

      return chosen;
    });

    await db.collection(COL.adminActions).add({
      action: 'store.registered',
      targetId: uid,
      adminId: null,
      timestamp: FieldValue.serverTimestamp(),
    });

    return { storeId: uid, slug, status: 'pending' };
  },
);
