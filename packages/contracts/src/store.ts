import type { Timestamp } from './common';

/**
 * A dealer business. Document ID is always the dealer's Firebase Auth uid,
 * so ownership checks in security rules reduce to `uid == storeId`.
 *
 * Collection: `stores/{storeId}`
 */

/** SOW §3: registration lifecycle, driven by the admin portal. */
export type StoreStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export type SubscriptionPlan = 'free' | 'monthly' | 'yearly';

/**
 * `grace` = paid period lapsed but listings are still live (see
 * SUBSCRIPTION_GRACE_DAYS). `expired` = lapsed and listings auto-unpublished
 * back down to the free limit.
 */
export type SubscriptionStatus = 'none' | 'active' | 'grace' | 'expired';

export interface Subscription {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  startedAt: Timestamp | null;
  expiresAt: Timestamp | null;
  graceEndsAt: Timestamp | null;
  /** Paystack reference of the transaction that activated this period. */
  lastPaymentReference: string | null;
}

/** Fields the dealer submits at registration and may edit thereafter. SOW §2. */
export interface StoreProfileInput {
  businessName: string;
  ownerName: string;
  /** E.164, e.g. +2348031234567. Sourced from the authenticated phone number. */
  phone: string;
  whatsapp: string;
  /** Corporate Affairs Commission number. Verified manually by admin (SOW §3). */
  cacNumber: string;
  address: string;
  state: string;
  city: string;
  description: string;

  /**
   * The three fields below come from the client-approved registration design
   * rather than the SOW §2 field list. They are dealer-owned contact and
   * classification data with no security consequence, so they live alongside
   * the rest of the profile rather than behind a callable.
   *
   * Optional on read: stores registered before this was added will not have
   * them, and a missing field must not break the dealer app.
   */

  /** Business email. Dealers still authenticate by phone — this is contact only. */
  email?: string;
  /** Nearest landmark, e.g. "Opposite Ladipo Main Gate". Aids buyers finding a stall. */
  landmark?: string;
  /** Which automotive vertical the shop trades in. See AUTOMOTIVE_CATEGORIES. */
  automotiveCategory?: string;
}

export interface Store extends StoreProfileInput {
  storeId: string;

  // --- Backend-controlled below this line ---------------------------------
  // Dealers have read-only access. Enforced by security rules; see security.ts.

  /** Public URL segment: naijapartshub.ng/store/{slug}. SOW §6. */
  slug: string;
  status: StoreStatus;
  /** Set by admin when status is 'rejected'. Surfaced to the dealer. */
  rejectionReason: string | null;
  /** SOW §3: "Control whether a store is publicly visible". */
  visible: boolean;
  /** Maintained transactionally by publishListing. Never trust a client value. */
  activeListingCount: number;
  subscription: Subscription;

  termsAcceptedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  approvedAt: Timestamp | null;
  /** Admin uid that last approved or rejected this store. */
  reviewedBy: string | null;
}

/**
 * Slug reservation. Firestore has no unique constraint, so uniqueness is
 * enforced by writing this document inside the same transaction that assigns
 * the slug: the create fails if the ID already exists.
 *
 * Collection: `storeSlugs/{slug}`
 */
export interface StoreSlugReservation {
  storeId: string;
  createdAt: Timestamp;
}
