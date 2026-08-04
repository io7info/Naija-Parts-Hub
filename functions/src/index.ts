import { setGlobalOptions } from 'firebase-functions/v2/options';

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
  region: 'europe-west1', // closest low-latency region to Nigeria among GCP's
  maxInstances: 10,
});

export { registerStore } from './registerStore';
export { publishListing } from './publishListing';
export { unpublishListing, deleteListing, deleteAccount } from './listingLifecycle';
export { adminReviewStore, adminModerateListing } from './adminReviewStore';
export { onListingWritten, onStoreWritten } from './triggers';
