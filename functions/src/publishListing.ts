import { onCall } from 'firebase-functions/v2/https';
import {
  ERROR_CODE,
  PAID_ACTIVE_LISTING_LIMIT,
  generateSearchTokens,
  type PublishListingRequest,
  type PublishListingResponse,
  type Store,
  type Listing,
} from '@nph/contracts';
import { COL, FieldValue, Timestamp, db, listingRef, storeRef } from './lib/admin';
import { fail, requireAuth, requireString } from './lib/guards';
import { fromStore, limitFor } from './lib/subscription';

const UPGRADE_URL = process.env.UPGRADE_URL ?? 'https://naijapartshub.ng/upgrade';

/**
 * Entitlement ceiling for a store's current plan.
 *
 * A lapsed paid plan still counts as paid while inside its grace window, so a
 * dealer whose payment slips on a Friday does not have listings pulled down
 * over the weekend.
 *
 * Derived from `expiresAt` rather than read from the stored `status`. That
 * field is only as fresh as the last nightly sweep, so between expiry and the
 * next run it still says `active` — and publishing is exactly where that gap
 * would be exploited, since a dealer who notices could add 190 listings on a
 * subscription that ended hours ago.
 */
export function activeLimitFor(store: Pick<Store, 'subscription'>, now = Date.now()): number {
  return limitFor(fromStore(store), now);
}

/**
 * Publish a draft listing (SOW sections 4 and 5).
 *
 * This is the single chokepoint that makes SOW §5 true — "the limit cannot be
 * bypassed through the mobile app, web platform, or direct API access". The
 * clients are not a security boundary: any dealer holding a valid ID token can
 * call the Firestore REST API directly. So `status: 'active'` is denied to all
 * clients in firestore.rules and can only be set here.
 *
 * Concurrency: the count lives on the store document as `activeListingCount`,
 * and the transaction reads that document before writing it. Two simultaneous
 * publishes therefore contend on the same document — Firestore aborts and
 * retries the loser, so they serialise. A `count(*)` query would not give this
 * guarantee: both callers could read 9 and both succeed, yielding 11 active
 * listings on a free plan.
 */
export const publishListing = onCall<PublishListingRequest, Promise<PublishListingResponse>>(
  async (request) => {
    const uid = requireAuth(request);
    const listingId = requireString(request.data?.listingId, 'listingId', { max: 128 });

    const result = await db.runTransaction(async (tx) => {
      const sRef = storeRef(uid);
      const lRef = listingRef(listingId);

      // All reads before any write — a Firestore transaction requirement.
      // getAll returns exactly one snapshot per ref, in order, so the
      // assertions are safe under noUncheckedIndexedAccess.
      const snaps = await tx.getAll(sRef, lRef);
      const storeSnap = snaps[0]!;
      const listingSnap = snaps[1]!;

      if (!storeSnap.exists) {
        fail('failed-precondition', ERROR_CODE.STORE_NOT_APPROVED, 'No store found for this account.');
      }
      const store = storeSnap.data() as Store;

      if (store.status === 'suspended') {
        fail('permission-denied', ERROR_CODE.STORE_SUSPENDED, 'This business is suspended.');
      }
      if (store.status !== 'approved') {
        fail(
          'failed-precondition',
          ERROR_CODE.STORE_NOT_APPROVED,
          'Your business is still awaiting approval.',
        );
      }

      if (!listingSnap.exists) {
        fail('not-found', ERROR_CODE.LISTING_INCOMPLETE, 'Listing not found.');
      }
      const listing = listingSnap.data() as Listing;

      // Ownership. Belt-and-braces: rules already pin storeId as immutable.
      if (listing.storeId !== uid) {
        fail('permission-denied', ERROR_CODE.STORE_NOT_APPROVED, 'Listing belongs to another store.');
      }

      if (listing.moderation?.removed === true) {
        fail(
          'failed-precondition',
          ERROR_CODE.LISTING_INCOMPLETE,
          'This listing was removed by an administrator.',
        );
      }

      // Idempotent: republishing an already-active listing must not
      // double-increment the counter.
      if (listing.status === 'active') {
        return {
          listingId,
          status: 'active' as const,
          activeListingCount: store.activeListingCount,
          limit: activeLimitFor(store),
        };
      }

      // Minimum viable listing (SOW §4).
      if (!listing.name?.trim() || !listing.categoryId?.trim()) {
        fail(
          'failed-precondition',
          ERROR_CODE.LISTING_INCOMPLETE,
          'A listing needs at least a name and a category before publishing.',
        );
      }

      // The category must still exist and still be offered.
      //
      // The security rules only check that `categoryId` is a non-empty string,
      // and a draft can outlive the category it was written against — an
      // administrator retires one, and every draft still carrying it would
      // otherwise publish into a category absent from the marketplace nav and
      // from the dealer's own picker. Reachable only by typing the URL, and
      // invisible to the dealer who published it.
      //
      // Read here rather than in the getAll above because the id comes from the
      // listing, which that call is fetching. Still legal: Firestore only
      // requires every read to precede every write, and nothing has been
      // written yet.
      const categorySnap = await tx.get(
        db.collection(COL.categories).doc(listing.categoryId.trim()),
      );
      if (!categorySnap.exists || categorySnap.get('active') !== true) {
        fail(
          'failed-precondition',
          ERROR_CODE.LISTING_INCOMPLETE,
          categorySnap.exists
            ? 'That category is no longer available. Choose another before publishing.'
            : 'That category no longer exists. Choose another before publishing.',
        );
      }
      if (typeof listing.priceKobo !== 'number' || listing.priceKobo < 0) {
        fail('failed-precondition', ERROR_CODE.LISTING_INCOMPLETE, 'Listing price is invalid.');
      }

      const limit = activeLimitFor(store);
      const current = store.activeListingCount ?? 0;

      if (current >= limit) {
        const paid = limit === PAID_ACTIVE_LISTING_LIMIT;
        fail(
          'resource-exhausted',
          paid ? ERROR_CODE.FAIR_USE_LIMIT_REACHED : ERROR_CODE.LIMIT_REACHED,
          paid
            ? `Fair-use limit of ${limit} active listings reached.`
            : `Free plan allows ${limit} active listings.`,
          { activeListingCount: current, limit, upgradeUrl: UPGRADE_URL },
        );
      }

      const now = Timestamp.now();

      tx.update(lRef, {
        status: 'active',
        publishedAt: listing.publishedAt ?? now,
        updatedAt: now,
        // Denormalized public predicate — the single indexed boolean every
        // marketplace query filters on. Recomputed here rather than left to the
        // trigger so the listing is queryable the instant this commits.
        publiclyVisible: store.visible === true,
        storeApproved: true,
        storeVisible: store.visible === true,
        storeSlug: store.slug,
        storeBusinessName: store.businessName,
        storeState: store.state,
        storeCity: store.city,
        storePhone: store.phone,
        storeWhatsapp: store.whatsapp,
        searchTokens: generateSearchTokens(listing.name, listing.brand, listing.partNumber),
      });

      tx.update(sRef, {
        activeListingCount: FieldValue.increment(1),
        updatedAt: now,
      });

      return {
        listingId,
        status: 'active' as const,
        activeListingCount: current + 1,
        limit,
      };
    });

    return result;
  },
);
