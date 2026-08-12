import { setGlobalOptions } from 'firebase-functions/v2/options';
import { FUNCTIONS_REGION } from '@nph/contracts';

/**
 * Naija Parts Hub — Cloud Functions.
 *
 * Every tamper-sensitive state transition lives here rather than in a client
 * write: publishing (SOW §5 limit), approval and moderation (§3, §9), and
 * later subscription activation (§8). See ADR-001 #4.
 *
 * Paystack is deliberately not present yet — the dealer onboarding and listing
 * vertical slice lands first.
 */

setGlobalOptions({
  // Paired with the Firestore database's location, not with the users; see the
  // constant's own note. Every client must target the same region.
  region: FUNCTIONS_REGION,
  maxInstances: 10,
});

export { registerStore } from './registerStore';
export { publishListing } from './publishListing';
export { unpublishListing, deleteListing, deleteAccount } from './listingLifecycle';
export { adminReviewStore, adminModerateListing } from './adminReviewStore';
export { adminManageCategory } from './adminManageCategory';
export { onListingWritten, onStoreWritten } from './triggers';
export { sweepExpiredSubscriptions } from './expirySweep';
export { initializePayment, verifyPayment, paystackWebhook } from './payments';
