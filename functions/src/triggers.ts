import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { computePubliclyVisible, generateSearchTokens, type Listing, type Store } from '@nph/contracts';
import { Timestamp, db } from './lib/admin';

/**
 * Firestore triggers maintaining the backend-controlled fields.
 *
 * Dealers write only their own content fields (rules enforce this). Everything
 * that drives public visibility or search is derived here, so a dealer cannot
 * stuff search tokens or flip themselves visible.
 */

/**
 * Backfills a newly created draft and keeps derived fields correct on edit.
 *
 * Clients create listings with dealer fields + storeId + status:'draft' only —
 * that is all the security rules permit — so searchTokens, moderation defaults,
 * the denormalized store fields and publiclyVisible are all filled in here.
 *
 * Recursion guard: this trigger writes back to the same document, so it must
 * compare before writing and return early when nothing changed. Without that,
 * every write re-triggers itself indefinitely.
 */
export const onListingWritten = onDocumentWritten('listings/{listingId}', async (event) => {
  const after = event.data?.after;
  if (!after?.exists) return; // deleted

  const listing = after.data() as Listing;
  const listingId = after.id;

  // A listing whose store we cannot resolve stays invisible.
  const storeSnap = await db.collection('stores').doc(listing.storeId).get();
  const store = storeSnap.exists ? (storeSnap.data() as Store) : null;

  const moderation = listing.moderation ?? {
    removed: false,
    removedBy: null,
    removedReason: null,
    removedAt: null,
  };

  const desired = {
    searchTokens: generateSearchTokens(listing.name, listing.brand, listing.partNumber),
    storeApproved: store?.status === 'approved',
    storeVisible: store?.visible === true,
    storeSlug: store?.slug ?? '',
    storeBusinessName: store?.businessName ?? '',
    storeState: store?.state ?? '',
    storeCity: store?.city ?? '',
    storePhone: store?.phone ?? '',
    storeWhatsapp: store?.whatsapp ?? '',
    moderation,
  };

  const publiclyVisible = computePubliclyVisible({
    status: listing.status,
    storeApproved: desired.storeApproved,
    storeVisible: desired.storeVisible,
    moderation,
  });

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(desired)) {
    const existing = (listing as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(existing) !== JSON.stringify(value)) {
      patch[key] = value;
    }
  }
  if (listing.publiclyVisible !== publiclyVisible) {
    patch.publiclyVisible = publiclyVisible;
  }
  if (!listing.createdAt) {
    patch.createdAt = Timestamp.now();
  }

  if (Object.keys(patch).length === 0) return; // nothing to do — stops recursion

  await db.collection('listings').doc(listingId).update(patch);
});

/**
 * Fans store status changes out to that store's listings.
 *
 * This is the write cost of denormalizing store state onto each listing, and
 * it is the right trade: it removes a rule-time get() on the parent store,
 * which would otherwise bill an extra document read for every document
 * evaluated by every public query. Approval and suspension are rare; public
 * queries are constant. Bounded by the fair-use listing ceiling.
 */
export const onStoreWritten = onDocumentWritten('stores/{storeId}', async (event) => {
  const before = event.data?.before?.data() as Store | undefined;
  const after = event.data?.after?.data() as Store | undefined;
  if (!after) return;

  const relevantChange =
    before?.status !== after.status ||
    before?.visible !== after.visible ||
    before?.slug !== after.slug ||
    before?.businessName !== after.businessName ||
    before?.state !== after.state ||
    before?.city !== after.city ||
    before?.phone !== after.phone ||
    before?.whatsapp !== after.whatsapp;

  if (!relevantChange) return;

  const storeId = event.params.storeId;
  const listings = await db.collection('listings').where('storeId', '==', storeId).get();
  if (listings.empty) return;

  const storeApproved = after.status === 'approved';
  const storeVisible = after.visible === true;

  const patchFor = (listing: Listing) => ({
    storeApproved,
    storeVisible,
    storeSlug: after.slug,
    storeBusinessName: after.businessName,
    storeState: after.state,
    storeCity: after.city,
    storePhone: after.phone,
    storeWhatsapp: after.whatsapp,
    publiclyVisible: computePubliclyVisible({
      status: listing.status,
      storeApproved,
      storeVisible,
      moderation: listing.moderation ?? {
        removed: false,
        removedBy: null,
        removedReason: null,
        removedAt: null,
      },
    }),
  });

  // Deliberately NOT a WriteBatch.
  //
  // A batch is atomic, so a single document deleted between the query above and
  // the commit fails the whole batch with NOT_FOUND — and none of the store's
  // other listings get updated. The consequence is not cosmetic: suspending a
  // store while one of its listings happens to be deleted would leave every
  // remaining listing publicly visible, so a suspended dealer's stock stays
  // live on the marketplace.
  //
  // These updates are independent of one another and need no atomicity, so they
  // run individually and a vanished document is simply skipped. Concurrency is
  // capped so a dealer at the fair-use ceiling cannot exhaust the connection
  // pool.
  const CONCURRENCY = 50;
  let skipped = 0;

  for (let i = 0; i < listings.docs.length; i += CONCURRENCY) {
    const slice = listings.docs.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      slice.map((doc) => doc.ref.update(patchFor(doc.data() as Listing))),
    );
    skipped += results.filter((r) => r.status === 'rejected').length;
  }

  if (skipped > 0) {
    console.warn(
      `onStoreWritten(${storeId}): ${skipped} of ${listings.size} listings could not be ` +
        'updated — most likely deleted concurrently.',
    );
  }
});
