import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

/**
 * Admin SDK singletons.
 *
 * The Admin SDK bypasses security rules entirely, which is precisely why every
 * backend-controlled field (approval, visibility, subscription, moderation) is
 * denied to clients in firestore.rules — these functions are the only writer.
 */

if (getApps().length === 0) {
  initializeApp();
}

export const db = getFirestore();
export const auth = getAuth();
export const storage = getStorage();
export { FieldValue, Timestamp };

// Collection paths, centralised so a rename is one edit.
export const COL = {
  stores: 'stores',
  storeSlugs: 'storeSlugs',
  listings: 'listings',
  payments: 'payments',
  categories: 'categories',
  adminActions: 'adminActions',
} as const;

export const storeRef = (storeId: string) => db.collection(COL.stores).doc(storeId);
export const listingRef = (listingId: string) => db.collection(COL.listings).doc(listingId);
export const slugRef = (slug: string) => db.collection(COL.storeSlugs).doc(slug);

/** True when running against the Local Emulator Suite. */
export const isEmulator = (): boolean =>
  process.env.FUNCTIONS_EMULATOR === 'true' || !!process.env.FIRESTORE_EMULATOR_HOST;
