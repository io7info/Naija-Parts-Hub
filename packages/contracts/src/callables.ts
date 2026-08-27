import type { BusinessType, StoreProfileInput, SubscriptionPlan } from './store';

/**
 * Callable Cloud Function signatures — the API surface shared by the Flutter
 * app and the Next.js web app.
 *
 * Every state transition that the SOW requires to be tamper-proof lives here
 * rather than in a client write: publishing (§5 limit), subscription changes
 * (§8), and approval or moderation (§3, §9).
 */

export const CALLABLE = {
  registerStore: 'registerStore',
  updateStoreProfile: 'updateStoreProfile',
  publishListing: 'publishListing',
  unpublishListing: 'unpublishListing',
  deleteListing: 'deleteListing',
  initializePayment: 'initializePayment',
  verifyPayment: 'verifyPayment',
  deleteAccount: 'deleteAccount',
  verifyMechanicIdentity: 'verifyMechanicIdentity',
  // Admin-only (SOW §3, §9)
  adminReviewStore: 'adminReviewStore',
  adminModerateListing: 'adminModerateListing',
  adminManageCategory: 'adminManageCategory',
} as const;

export type CallableName = (typeof CALLABLE)[keyof typeof CALLABLE];

// --- Error codes ------------------------------------------------------------

/**
 * Returned as the `details.code` of an HttpsError so clients can branch.
 * LIMIT_REACHED in particular drives the upgrade prompt (SOW §5).
 */
export const ERROR_CODE = {
  LIMIT_REACHED: 'LIMIT_REACHED',
  FAIR_USE_LIMIT_REACHED: 'FAIR_USE_LIMIT_REACHED',
  STORE_NOT_APPROVED: 'STORE_NOT_APPROVED',
  STORE_SUSPENDED: 'STORE_SUSPENDED',
  SLUG_TAKEN: 'SLUG_TAKEN',
  ALREADY_REGISTERED: 'ALREADY_REGISTERED',
  LISTING_INCOMPLETE: 'LISTING_INCOMPLETE',
  PAYMENT_ALREADY_APPLIED: 'PAYMENT_ALREADY_APPLIED',
  PAYMENT_NOT_VERIFIED: 'PAYMENT_NOT_VERIFIED',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  CATEGORY_EXISTS: 'CATEGORY_EXISTS',
  CATEGORY_IN_USE: 'CATEGORY_IN_USE',
  DOWNGRADE_NOT_SUPPORTED: 'DOWNGRADE_NOT_SUPPORTED',

  // --- Mechanic identity verification ---------------------------------------
  /** A mechanic cannot be approved until BVN and NIN are verified. */
  IDENTITY_NOT_VERIFIED: 'IDENTITY_NOT_VERIFIED',
  /** The provider rejected the identifier, or the names disagree materially. */
  IDENTITY_CHECK_FAILED: 'IDENTITY_CHECK_FAILED',
  /** Too many attempts. Each one costs a paid provider call. */
  IDENTITY_ATTEMPTS_EXCEEDED: 'IDENTITY_ATTEMPTS_EXCEEDED',
  /** These identifiers already belong to another mechanic account. */
  IDENTITY_ALREADY_USED: 'IDENTITY_ALREADY_USED',
  /**
   * No verification provider is configured yet.
   *
   * A distinct code rather than a generic failure, because it means "the
   * platform is not finished" rather than "your identity was rejected", and a
   * mechanic must never be told the latter when the former is true.
   */
  IDENTITY_PROVIDER_UNAVAILABLE: 'IDENTITY_PROVIDER_UNAVAILABLE',
  /** An action that only applies to one business type was called on the other. */
  WRONG_BUSINESS_TYPE: 'WRONG_BUSINESS_TYPE',
} as const;

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];

// --- Dealer: registration and profile ---------------------------------------

export interface RegisterStoreRequest extends StoreProfileInput {
  /** SOW §2 requires explicit Terms and Privacy Policy acceptance. */
  acceptedTerms: true;
  /** Optional preferred slug; falls back to a slugified business name. */
  preferredSlug?: string;

  /**
   * Omitted means 'parts_dealer'.
   *
   * Deliberately optional so an older build of the app — one that predates
   * mechanics and sends no such field — keeps registering dealers exactly as
   * it does today. Requiring it would break every installed copy the moment
   * this deploys.
   */
  businessType?: BusinessType;

  /** Mechanics only; ignored when registering a parts dealer. */
  mechanic?: {
    specialties: string[];
    photos?: string[];
  };
}

// --- Mechanic: identity verification (BVN + NIN) -----------------------------

/**
 * The only path by which BVN and NIN enter the system.
 *
 * They travel from the app to this callable over HTTPS and no further: the
 * function holds them as local variables, sends them to the provider, and
 * keeps a keyed fingerprint plus the last four digits. They are never written
 * to Firestore, never logged, never attached to analytics or a crash report,
 * and never placed in a URL.
 *
 * Separate from registerStore so the identifiers are not carried along with a
 * payload that gets persisted wholesale, and so verification can be retried
 * without re-submitting a whole profile.
 */
export interface VerifyMechanicIdentityRequest {
  /** 11 digits. Validated server-side before any paid provider call. */
  bvn: string;
  /** 11 digits. */
  nin: string;
  /** The legal name to match against the government record. */
  fullName: string;
}

export interface VerifyMechanicIdentityResponse {
  status: 'verified' | 'failed' | 'manual_review';
  /** Present when the check completed; the provider's own reference. */
  reference: string | null;
  nameMatch: boolean | null;
  /** Attempts remaining before the cooldown applies. */
  attemptsRemaining: number;
}

export interface RegisterStoreResponse {
  storeId: string;
  slug: string;
  /** Always 'pending' — approval is a separate admin action (SOW §3). */
  status: 'pending';
}

export type UpdateStoreProfileRequest = Partial<StoreProfileInput>;

// --- Dealer: listings -------------------------------------------------------

export interface PublishListingRequest {
  listingId: string;
}

export interface PublishListingResponse {
  listingId: string;
  status: 'active';
  /** Active listings after this publish. */
  activeListingCount: number;
  /** Ceiling for the store's current plan — 10 free, fair-use if paid. */
  limit: number;
}

/**
 * Thrown as HttpsError('resource-exhausted') with these details when a free
 * store attempts an 11th active listing. The client shows the upgrade path.
 */
export interface LimitReachedDetails {
  code: typeof ERROR_CODE.LIMIT_REACHED;
  activeListingCount: number;
  limit: number;
  upgradeUrl: string;
}

export interface UnpublishListingRequest {
  listingId: string;
}

export interface DeleteListingRequest {
  listingId: string;
}

// --- Dealer: subscription (SOW §8) ------------------------------------------

export interface InitializePaymentRequest {
  plan: Exclude<SubscriptionPlan, 'free'>;
  /** Where Paystack returns the dealer after checkout. Must be an allowlisted origin. */
  callbackUrl: string;

  /**
   * GA4 identifiers read from the dealer's browser at checkout.
   *
   * Captured here because this is the only moment they exist: a purchase
   * reported later from the server without them does not become an
   * unattributed conversion, it fabricates a new user and a new session in
   * GA4. See docs/ANALYTICS.md.
   *
   * Optional and untrusted — absent whenever analytics is blocked, which is
   * normal. Validated and stored for reporting only; never used in any
   * security or billing decision.
   */
  analytics?: {
    clientId?: string;
    sessionId?: string;
  };
}

export interface InitializePaymentResponse {
  reference: string;
  /** Paystack-hosted checkout page. The client never handles card data. */
  authorizationUrl: string;
  amountKobo: number;
}

export interface VerifyPaymentRequest {
  reference: string;
}

export interface VerifyPaymentResponse {
  reference: string;
  status: 'success' | 'pending' | 'failed';
  /** Present once the subscription has been activated. */
  expiresAt: string | null;
}

// --- Dealer: account deletion ----------------------------------------------

/**
 * Required by Apple (Guideline 5.1.1(v)) and Google Play for any app with
 * account registration. Not named in the SOW; flagged as a store-approval
 * blocker and added to Phase 1 scope.
 */
export interface DeleteAccountRequest {
  /** Typed confirmation to guard against accidental taps. */
  confirmation: 'DELETE';
}

// --- Admin (SOW §3, §9) -----------------------------------------------------

export interface AdminReviewStoreRequest {
  storeId: string;
  action: 'approve' | 'reject' | 'suspend' | 'reactivate';
  /** Required when action is 'reject' or 'suspend'. */
  reason?: string;
}

export interface AdminModerateListingRequest {
  listingId: string;
  action: 'remove' | 'restore';
  reason?: string;
}

/**
 * Category taxonomy management (SOW §9, "basic category management").
 *
 * A callable rather than a direct admin write, for two reasons. The audit trail
 * in `adminActions` is written by the same function that makes the change, so
 * there is no path that alters the taxonomy without recording who did it. And
 * deactivating a category has to be checked against the listings that use it,
 * which is a read the client should not be trusted to have done.
 *
 * Deliberately no `delete`. A category id is written into every listing that
 * chose it, and deleting the document leaves those listings pointing at nothing
 * — the filter drops them, the dealer cannot see why, and the id cannot be
 * recovered from the listings themselves. Deactivating hides it from the picker
 * and the marketplace nav while leaving existing listings intact and reversible.
 */
export interface AdminManageCategoryRequest {
  action: 'create' | 'update' | 'setActive';
  /**
   * Slug-shaped and immutable once created: it is stored on every listing that
   * uses it, so renaming the id would orphan all of them. `name` is the
   * display text and may be edited freely.
   */
  categoryId: string;
  name?: string;
  order?: number;
  active?: boolean;
}

export interface AdminManageCategoryResponse {
  categoryId: string;
  /** Listings referencing this category, so the portal can explain a refusal. */
  listingCount?: number;
}
