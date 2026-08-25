import type { Timestamp } from './common';

/**
 * A dealer business. Document ID is always the dealer's Firebase Auth uid,
 * so ownership checks in security rules reduce to `uid == storeId`.
 *
 * Collection: `stores/{storeId}`
 */

/**
 * What kind of business this document describes.
 *
 * Parts dealers sell inventory; mechanics advertise services. They share an
 * identity (the document id is the uid either way), an approval lifecycle, a
 * slug and an admin review queue — which is why they share a collection rather
 * than living in `stores` and `mechanics` separately. Splitting them would
 * duplicate all four, and `deleteAccount` would need two paths through the
 * same cleanup.
 *
 * A union rather than a boolean so a third type — a towing service, a parts
 * importer — is a new member here rather than another migration.
 *
 * BACKWARD COMPATIBILITY: stores registered before this existed have no
 * `businessType` field. Firestore cannot express "equals X or is absent" in
 * one query, and `!=` also skips documents where the field is missing, so a
 * legacy dealer would silently vanish from every filtered query. They are
 * backfilled to 'parts_dealer' by scripts/backfill-business-type.mjs; treat a
 * missing value as 'parts_dealer' anywhere a document might predate that run.
 */
export type BusinessType = 'parts_dealer' | 'mechanic';

/** SOW §3: registration lifecycle, driven by the admin portal. */
export type StoreStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

/**
 * Where a mechanic's identity check stands.
 *
 * 'unverified' is the state a mechanic registers into, and it is a hard block
 * on approval — the client requires verified BVN and NIN before a mechanic can
 * be approved. 'manual_review' exists because a name that disagrees with the
 * government record is not automatically fraud: people marry, records carry
 * typos, and a middle name is often dropped. An admin decides those.
 */
export type IdentityStatus = 'unverified' | 'pending' | 'verified' | 'failed' | 'manual_review';

/**
 * The retained result of an identity check. Never the identifiers themselves.
 *
 * A NIN lookup returns full name, date of birth, address, photograph, and —
 * genuinely — religion. None of that is kept. What survives is the minimum
 * needed to answer "was this person verified, when, by whom, and does the name
 * match", plus enough to trace a dispute back to the provider's own record.
 *
 * `bvnFingerprint` and `ninFingerprint` are keyed HMACs, not hashes: a plain
 * hash of an 11-digit number is trivially reversible by brute force, since the
 * whole keyspace is 10^11. The HMAC key lives in Secret Manager, so an
 * attacker with a copy of Firestore still cannot recover an identifier. They
 * exist so one person cannot register several mechanic accounts.
 */
export interface IdentityVerification {
  status: IdentityStatus;
  /** Which provider produced this result, so a future switch stays auditable. */
  provider: string | null;
  /** The provider's own reference, for disputes and support. */
  reference: string | null;
  verifiedAt: Timestamp | null;

  /** Display only — enough for a dealer to recognise which number they used. */
  bvnLast4: string | null;
  ninLast4: string | null;

  /** Keyed HMAC. Duplicate detection without holding the identifier. */
  bvnFingerprint: string | null;
  ninFingerprint: string | null;

  /**
   * Which key version produced those fingerprints.
   *
   * They cannot be recomputed — the identifier they came from is deliberately
   * not stored — so a compromised key is handled by adding a new one to the
   * ring and keeping the old one for lookups. This records which key applies
   * to this record, so a rotation knows what still needs re-issuing the next
   * time this mechanic verifies. See functions/src/lib/identity/fingerprint.ts.
   */
  fingerprintKeyVersion: number | null;

  /** Did the government record's name match what they submitted? */
  nameMatch: boolean | null;
  /** The provider's legal name. Admin-only; never public, never in a list view. */
  verifiedName: string | null;

  /** Attempts so far. Each provider call costs money — see the rate limit. */
  attempts: number;
  /** Set after repeated failures; blocks further attempts until it passes. */
  lockedUntil: Timestamp | null;

  /**
   * When the platform forced this record back into re-verification.
   *
   * Written by scripts/flag-compromised-identities.mjs after a fingerprint key
   * is withdrawn. Distinguishes "we invalidated this" from "they failed a
   * check", which matters to the administrator reading the queue and to the
   * mechanic being asked to verify again through no fault of their own.
   */
  reverificationRequiredAt?: Timestamp | null;

  /**
   * Set while a verification is running, cleared when it finishes.
   *
   * Single-flight protection: two concurrent submissions contend on this
   * document, so the second is refused before it can reach a billable
   * endpoint. Expires on its own so a crashed invocation cannot strand the
   * mechanic permanently.
   */
  inFlightUntil?: Timestamp | null;
}

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

/**
 * The mechanic-only half of the profile.
 *
 * Optional on `Store` and absent entirely for dealers, rather than a set of
 * nullable columns spread across the parent. That keeps a dealer document
 * exactly the shape it is today — no new fields, no rewrite, no behaviour
 * change — which is the constraint the client set.
 *
 * Photos are Storage download URLs under `stores/{uid}/workshop/`. They are
 * NOT listings: a listing carries a price, a category, a quantity, search
 * tokens and a `publiclyVisible` flag, feeds the parts marketplace, and counts
 * against a subscription quota. A photograph of a workshop has none of those
 * properties and modelling it as inventory would put mechanics into parts
 * search results.
 */
export interface MechanicProfile {
  /** From MECHANIC_SPECIALTIES. At least one, capped at the list length. */
  specialties: string[];
  /** Storage URLs, at most MAX_WORKSHOP_PHOTOS. */
  photos: string[];
}

export interface Store extends StoreProfileInput {
  storeId: string;

  /**
   * Absent on documents written before mechanics existed. Read it through
   * `businessTypeOf()` rather than directly, which resolves the legacy case.
   */
  businessType?: BusinessType;

  /** Present only when businessType is 'mechanic'. */
  mechanic?: MechanicProfile;

  // --- Backend-controlled below this line ---------------------------------
  // Dealers have read-only access. Enforced by security rules; see security.ts.

  /**
   * Mechanic identity check. Backend-only in every direction: the client may
   * never write it, and only the owner and admins may read it.
   *
   * Absent for dealers — the client was explicit that BVN and NIN are not to
   * be added to the parts dealer flow.
   */
  identity?: IdentityVerification;

  /** Public URL segment: naijapartshub.com/store/{slug}. SOW §6. */
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

/**
 * The business type of a store, resolving the legacy case.
 *
 * Every document written before mechanics existed is a parts dealer, and none
 * of them carry the field. Reading `store.businessType` directly gives
 * `undefined` for those, which compares unequal to both members of the union
 * and silently drops them out of any branch. This is the single place that
 * decision is made, so it cannot be made differently in two files.
 *
 * Note this does NOT rescue Firestore *queries* — a `where` clause still can
 * not match a missing field, which is why the backfill exists. Use this for
 * documents already in hand.
 */
export function businessTypeOf(store: Pick<Store, 'businessType'> | null | undefined): BusinessType {
  return store?.businessType === 'mechanic' ? 'mechanic' : 'parts_dealer';
}

/** Whether this business sells parts, and therefore has listings and a quota. */
export function isPartsDealer(store: Pick<Store, 'businessType'> | null | undefined): boolean {
  return businessTypeOf(store) === 'parts_dealer';
}

/** Whether this business advertises services, and therefore has no listings. */
export function isMechanic(store: Pick<Store, 'businessType'> | null | undefined): boolean {
  return businessTypeOf(store) === 'mechanic';
}

/**
 * Whether a mechanic has cleared identity checks.
 *
 * The client requires verified BVN and NIN before a mechanic may be approved,
 * so this gates the admin action rather than merely decorating it. Dealers are
 * unaffected: they have no `identity` block and this is never consulted for
 * them.
 */
export function identityVerified(store: Pick<Store, 'identity'> | null | undefined): boolean {
  return store?.identity?.status === 'verified';
}
