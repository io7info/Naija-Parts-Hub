/**
 * The backend-controlled field contract.
 *
 * Confirmed architecture decision #4: "Approval, visibility, subscription, and
 * moderation fields must be backend-controlled and read-only to dealers."
 *
 * This is what makes SOW §5 true — "the limit cannot be bypassed through the
 * mobile app, web platform, or direct API access". A dealer holding a valid
 * ID token can call the Firestore REST API directly, so the mobile and web
 * clients are not a security boundary. Only rules and Cloud Functions are.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IMPORTANT: firebase/firestore.rules cannot import TypeScript, so these
 * lists are mirrored there by hand. Changing a list here means changing the
 * matching `hasAny([...])` block in the rules file. The rules test suite
 * asserts the two agree — see firebase/tests/.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** Fields on `stores/{storeId}` a dealer may never create or modify. */
export const STORE_BACKEND_FIELDS = [
  'slug',
  'status',
  'rejectionReason',
  'visible',
  'activeListingCount',
  'subscription',
  'createdAt',
  'approvedAt',
  'reviewedBy',
] as const;

/** Fields on `stores/{storeId}` a dealer submits and may edit. SOW §2. */
export const STORE_DEALER_FIELDS = [
  'businessName',
  'ownerName',
  'phone',
  'whatsapp',
  'cacNumber',
  'address',
  'state',
  'city',
  'description',
  // From the client-approved registration design; contact/classification only,
  // no security consequence. See StoreProfileInput.
  'email',
  'landmark',
  'automotiveCategory',
  'updatedAt',
] as const;

/** Fields on `listings/{listingId}` a dealer may never create or modify. */
export const LISTING_BACKEND_FIELDS = [
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
  'publishedAt',
] as const;

/** Fields on `listings/{listingId}` a dealer owns. SOW §4. */
export const LISTING_DEALER_FIELDS = [
  'name',
  'description',
  'categoryId',
  'condition',
  'priceKobo',
  'quantity',
  'brand',
  'partNumber',
  'compatibleMake',
  'compatibleModel',
  'images',
  'updatedAt',
] as const;

/**
 * Immutable once written. `storeId` in particular: without this, a dealer
 * could reassign a listing to another store and write across the tenant
 * boundary (SOW §11, "Prevention of cross-store data access").
 */
export const LISTING_IMMUTABLE_FIELDS = ['storeId'] as const;

/**
 * Custom claim marking a Lytod Motors HQ administrator.
 * Set only via the Admin SDK — never self-assignable, and never derived from
 * a Firestore document a dealer could write.
 */
export const ADMIN_CLAIM = 'role';
export const ADMIN_CLAIM_VALUE = 'super_admin';

/**
 * Collections no client may write to under any circumstance. Cloud Functions
 * use the Admin SDK, which bypasses rules entirely.
 */
export const BACKEND_ONLY_COLLECTIONS = [
  'payments',
  'storeSlugs',
  'adminActions',
  'counters',
] as const;
