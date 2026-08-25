import { onCall } from 'firebase-functions/v2/https';
import {
  AUTOMOTIVE_CATEGORIES,
  ERROR_CODE,
  FIELD_LIMITS,
  MAX_WORKSHOP_PHOTOS,
  MECHANIC_SPECIALTIES,
  slugCandidates,
  slugify,
  validateSlug,
  type BusinessType,
  type RegisterStoreRequest,
  type RegisterStoreResponse,
} from '@nph/contracts';
import { COL, FieldValue, Timestamp, db, slugRef, storeRef } from './lib/admin';
import { fail, optionalString, requireAuth, requireString } from './lib/guards';

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

    // Absent means parts dealer. An installed copy of the app that predates
    // mechanics sends no such field, and it must keep registering dealers
    // exactly as it does today rather than failing on an unknown value.
    const businessType: BusinessType = data.businessType === 'mechanic' ? 'mechanic' : 'parts_dealer';
    const isMechanic = businessType === 'mechanic';

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

      // CAC is a *business* registration number. Dealers run registered shops
      // and must supply one; most independent mechanics are not incorporated,
      // and requiring it would exclude the majority of legitimate ones. Their
      // identity is proven by BVN and NIN instead — see verifyMechanicIdentity.
      cacNumber: isMechanic
        ? optionalString(data.cacNumber, 40)
        : requireString(data.cacNumber, 'cacNumber', { max: 40 }),
      address: requireString(data.address, 'address', { max: FIELD_LIMITS.address }),
      state: requireString(data.state, 'state', { max: 60 }),
      city: requireString(data.city, 'city', { max: 60 }),
      description:
        typeof data.description === 'string'
          ? data.description.trim().slice(0, FIELD_LIMITS.description)
          : '',

      // Optional, from the client-approved registration design. Trimmed and
      // capped rather than required — a dealer who skips them still registers.
      email: optionalString(data.email, FIELD_LIMITS.email),
      landmark: optionalString(data.landmark, FIELD_LIMITS.landmark),
      // Constrained to the known list. An unrecognised value is dropped rather
      // than rejected: it is a classification, not a security boundary, and
      // failing registration over it would be disproportionate.
      automotiveCategory: (AUTOMOTIVE_CATEGORIES as readonly string[]).includes(
        (data.automotiveCategory ?? '').trim(),
      )
        ? data.automotiveCategory!.trim()
        : '',
    };

    /**
     * The mechanic half of the profile, filtered against the known lists.
     *
     * Specialties are intersected with MECHANIC_SPECIALTIES rather than
     * trusted: they drive the public service filter, and a free-text value
     * would be a mechanic nobody can find. At least one is required — a
     * mechanic advertising no service is invisible to every search.
     *
     * Photos are capped rather than rejected past the limit. A client that
     * sends eleven has a bug, but failing the whole registration over the
     * eleventh would lose a completed form; taking the first ten loses
     * nothing the mechanic can't re-add later.
     */
    const mechanicProfile = (() => {
      if (!isMechanic) return null;

      const allowed = new Set(MECHANIC_SPECIALTIES.map((s) => s.id as string));
      const specialties = Array.isArray(data.mechanic?.specialties)
        ? [...new Set(data.mechanic!.specialties.filter((s) => allowed.has(s)))]
        : [];

      if (specialties.length === 0) {
        fail(
          'invalid-argument',
          ERROR_CODE.LISTING_INCOMPLETE,
          'Choose at least one service you offer.',
        );
      }

      const photos = Array.isArray(data.mechanic?.photos)
        ? data.mechanic!.photos.filter((p) => typeof p === 'string' && p.length > 0)
        : [];

      return { specialties, photos: photos.slice(0, MAX_WORKSHOP_PHOTOS) };
    })();

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
        ...(mechanicProfile ? { mechanic: mechanicProfile } : {}),

        // --- backend-controlled from here (ADR-001 #4) ---
        businessType,

        /**
         * Mechanics start unverified, and that is a hard block on approval —
         * see adminReviewStore. Written here rather than left absent so the
         * admin queue can filter on it and a mechanic's own app can show them
         * what is outstanding.
         *
         * Dealers get no identity block at all. The client was explicit that
         * BVN and NIN are not to be added to the parts dealer flow, and an
         * empty block on every dealer document would invite exactly that.
         */
        ...(isMechanic
          ? {
              identity: {
                status: 'unverified',
                provider: null,
                reference: null,
                verifiedAt: null,
                bvnLast4: null,
                ninLast4: null,
                bvnFingerprint: null,
                ninFingerprint: null,
                nameMatch: null,
                verifiedName: null,
                attempts: 0,
                lockedUntil: null,
              },
            }
          : {}),

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
      // Recorded so the admin audit trail distinguishes the two intakes; they
      // have different review criteria and different approval prerequisites.
      businessType,
      timestamp: FieldValue.serverTimestamp(),
    });

    return { storeId: uid, slug, status: 'pending' };
  },
);
