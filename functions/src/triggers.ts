import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import {
  LISTING_BACKEND_FIELDS,
  computePubliclyVisible,
  generateSearchTokens,
  type Listing,
  type Store,
} from '@nph/contracts';
import { FieldValue, Timestamp, db } from './lib/admin';

/**
 * Firestore triggers maintaining the backend-controlled fields.
 *
 * Dealers write only their own content fields (rules enforce this). Everything
 * that drives public visibility or search is derived here, so a dealer cannot
 * stuff search tokens or flip themselves visible.
 */

/** The state every listing starts in. Only adminModerateListing changes it. */
const defaultModeration = (): Listing['moderation'] => ({
  removed: false,
  removedBy: null,
  removedReason: null,
  removedAt: null,
});

/**
 * Backend fields this trigger derives on every write, so a forged value is
 * overwritten rather than deleted. `status` is excluded because the create rule
 * already pins it to 'draft' and publishListing owns it thereafter.
 */
const DERIVED_ON_WRITE = new Set<string>([
  'status',
  'searchTokens',
  'publiclyVisible',
  'storeApproved',
  'storeVisible',
  'storeSlug',
  'storeBusinessName',
  'storeState',
  'storeCity',
  'storePhone',
  'storeWhatsapp',
  'moderation',
  'createdAt',
]);

/**
 * Backend fields that must not survive a create — anything backend-owned that
 * the trigger does not itself assign. Derived from the contract rather than
 * listed by hand, so a new backend field is covered the day it is added.
 *
 * Today this is exactly `publishedAt`.
 */
const STRIPPED_ON_CREATE = LISTING_BACKEND_FIELDS.filter((f) => !DERIVED_ON_WRITE.has(f));

/**
 * Backfills a newly created draft and keeps derived fields correct on edit.
 *
 * Clients create listings with dealer fields + storeId + status:'draft' only —
 * that is all the security rules permit — so searchTokens, moderation defaults,
 * the denormalized store fields and publiclyVisible are all filled in here.
 *
 * Create and update are treated differently, and the distinction is the whole
 * security property. On create every field arrived from the client, so no
 * backend-owned value may be trusted: `createdAt` and `moderation` are forced,
 * and anything else backend-owned is deleted. On update the stored values are
 * already backend-owned — the rules forbid a dealer touching them — so they are
 * preserved. Forcing them on every write instead would reset `createdAt` on
 * each edit (destroying marketplace ordering) and reset `moderation` to its
 * default immediately after an admin removed a listing, quietly putting it
 * back on the marketplace.
 *
 * Recursion guard: this trigger writes back to the same document, so it must
 * compare before writing and return early when nothing changed. Without that,
 * every write re-triggers itself indefinitely. The create branch always writes
 * (it sets createdAt), but its own write arrives as an update, where the
 * comparison finds nothing left to do.
 */
export const onListingWritten = onDocumentWritten('listings/{listingId}', async (event) => {
  const after = event.data?.after;
  if (!after?.exists) return; // deleted

  const isCreate = !event.data?.before?.exists;
  const listing = after.data() as Listing;
  const listingId = after.id;
  const raw = listing as unknown as Record<string, unknown>;

  // A listing whose store we cannot resolve stays invisible.
  const storeSnap = await db.collection('stores').doc(listing.storeId).get();
  const store = storeSnap.exists ? (storeSnap.data() as Store) : null;

  const moderation = isCreate ? defaultModeration() : (listing.moderation ?? defaultModeration());

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
    if (JSON.stringify(raw[key]) !== JSON.stringify(value)) {
      patch[key] = value;
    }
  }
  if (listing.publiclyVisible !== publiclyVisible) {
    patch.publiclyVisible = publiclyVisible;
  }

  if (isCreate) {
    // Unconditional, overwriting whatever the client sent. A forged future
    // timestamp would otherwise survive for the life of the listing and pin it
    // above every legitimate result in each `createdAt desc` query.
    patch.createdAt = Timestamp.now();

    for (const field of STRIPPED_ON_CREATE) {
      if (raw[field] !== undefined) patch[field] = FieldValue.delete();
    }
  } else if (!listing.createdAt) {
    // Backfill only. Listings created before this trigger existed have no
    // createdAt, and re-stamping on every edit would reorder the marketplace.
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
