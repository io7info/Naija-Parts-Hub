/**
 * Platform constants.
 *
 * Values traceable to the Phase 1 MVP Scope of Work are annotated with the
 * SOW section they come from. Values marked PENDING are defaults chosen by
 * the dev team and still need written client confirmation before launch.
 */

// --- Listing limits (SOW §5, §8) -------------------------------------------

/** Free tier: active listings allowed before an upgrade is required. SOW §5. */
export const FREE_ACTIVE_LISTING_LIMIT = 10;

/**
 * Paid tier ceiling. SOW §8 asks for "a reasonable fair-use limit rather than
 * technically unlimited storage" but names no number.
 * PENDING client confirmation.
 */
export const PAID_ACTIVE_LISTING_LIMIT = 200;

/** SOW §4: "Up to three product images". The limit applies to products, not images (§5). */
export const MAX_IMAGES_PER_LISTING = 3;

/** Uploads are compressed client-side before hitting Storage. */
export const MAX_IMAGE_BYTES = 512 * 1024; // 500 KB
export const MAX_IMAGE_DIMENSION = 1200; // px, longest edge

// --- Subscription plans (SOW §8) -------------------------------------------

export const PLANS = {
  monthly: { priceKobo: 5_000_00, durationDays: 30 },
  yearly: { priceKobo: 50_000_00, durationDays: 365 },
} as const;

/**
 * Days a lapsed subscription keeps its listings live before auto-unpublish.
 * The SOW does not define expiry behaviour. PENDING client confirmation.
 */
export const SUBSCRIPTION_GRACE_DAYS = 7;

// --- Store slugs (SOW §6) ---------------------------------------------------

/** Slugs that would collide with application routes on the public web app. */
export const RESERVED_SLUGS = [
  'admin', 'api', 'app', 'auth', 'about', 'blog', 'category', 'contact',
  'dashboard', 'help', 'legal', 'login', 'logout', 'marketplace', 'new',
  'privacy', 'product', 'products', 'register', 'search', 'settings',
  'signup', 'store', 'stores', 'support', 'terms', 'upgrade', 'www',
] as const;

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 40;

// --- Field length caps (SOW §11 "Input validation") ------------------------

export const FIELD_LIMITS = {
  businessName: 100,
  ownerName: 100,
  description: 2000,
  address: 200,
  email: 120,
  landmark: 120,
  listingName: 140,
  listingDescription: 2000,
  brand: 60,
  partNumber: 60,
  compatibleMake: 60,
  compatibleModel: 60,
} as const;

// --- Store classification (client-approved registration design) -------------

/**
 * The automotive verticals a shop can declare at registration.
 *
 * Deliberately a fixed list rather than free text: SOW §7 scopes the platform
 * to automotive parts, and a typed vertical is what makes that filterable
 * later. Distinct from `categories/{id}`, which classifies a *listing*; this
 * classifies the *business*.
 */
export const AUTOMOTIVE_CATEGORIES = [
  'Car Parts',
  'Motorcycle Parts',
  'Truck & Trailer',
  'Tractor & Farm',
  'Heavy Equipment',
  'Electrical Parts',
] as const;

export type AutomotiveCategory = (typeof AUTOMOTIVE_CATEGORIES)[number];

/** Firestore caps `array-contains-any` / `in` at 30 values per query. */
export const MAX_SEARCH_TOKENS = 60;

// --- Deployment ------------------------------------------------------------

/**
 * The region every Cloud Function runs in.
 *
 * Must pair with the Firestore database's location, not with the users. The
 * production database is multi-region `nam5`, and Firebase's documented
 * function region for `nam5` is `us-central1`; a 2nd-gen Firestore trigger
 * deployed elsewhere is rejected, because its Eventarc trigger location is
 * derived from the database.
 *
 * europe-west1 is closer to Nigeria and was the original choice, but a
 * callable there would cross the Atlantic for every Firestore read it makes —
 * several per transaction in registerStore — which costs far more than the
 * one-way latency it saves.
 *
 * Callers must target the same region or every call 404s, so this constant is
 * imported by the backend, the web app and the tests. Flutter cannot import
 * TypeScript and mirrors it in apps/mobile/lib/core/env.dart;
 * scripts/check-rules-sync.mjs fails when the two drift.
 */
export const FUNCTIONS_REGION = 'us-central1';

// --- Canonical public origin ------------------------------------------------

/**
 * The one address this product lives at.
 *
 * Everything user-facing resolves against it: the Paystack return URL, the
 * dealer billing page, public store and listing links, share text, SEO
 * canonicals, and the admin sign-in origin allowlist.
 *
 * It is a constant rather than an environment variable because it is not
 * configuration — it is the product's identity, and a deployment that serves a
 * different domain is a different deployment. Where an override is genuinely
 * needed (a preview build, an emulator pointed at localhost) the reader takes
 * `MARKETPLACE_ORIGIN` from the environment and falls back to this, so the
 * default is always the right answer rather than a guess.
 *
 * The `.ng` variant that appeared through the codebase was never registered.
 * It reached the Paystack callback URL, where the consequence is a dealer
 * finishing checkout on a domain that does not resolve — money taken, no
 * confirmation, and no way for them to tell whether it worked.
 *
 * Flutter cannot import TypeScript and mirrors this in
 * apps/mobile/lib/core/env.dart; scripts/check-rules-sync.mjs fails when the
 * two drift, and rejects any `.ng` literal that creeps back in.
 */
export const SITE_ORIGIN = 'https://naijapartshub.com';

/** Host without the scheme, for display: "naijapartshub.com/store/ladipo". */
export const SITE_DOMAIN = 'naijapartshub.com';

/**
 * Where a dealer buys or renews a plan.
 *
 * `/dealer/subscription`, never `/plans`: the latter is the public price list,
 * with no sign-in and no checkout, so a dealer sent there reaches a dead end.
 */
export const BILLING_PATH = '/dealer/subscription';

/**
 * Domain for the synthetic customer address Paystack requires.
 *
 * Dealers authenticate by phone and may have no email. Paystack needs a
 * syntactically valid one to key its customer record, so a per-store address is
 * generated under a subdomain that is deliberately not a real mailbox — routing
 * these anywhere would create an inbox nobody reads, and reusing a real domain
 * risks colliding with an address that exists.
 */
export const DEALER_EMAIL_DOMAIN = `dealers.${SITE_DOMAIN}`;
