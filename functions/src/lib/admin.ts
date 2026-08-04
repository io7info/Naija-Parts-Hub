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

/**
 * Auth and Storage are resolved on first use, not at import.
 *
 * The emulator spawns a separate runtime worker per function, and every worker
 * evaluates this module — so an eager `getStorage()` made *adminReviewStore*
 * pay to load `@google-cloud/storage`, which it never touches. That is the
 * single largest contributor to firebase-admin cold start, and on a slow host
 * it pushed worker startup past the emulator's own timeout:
 *
 *   !! functions: Failed to start functions ...: FirebaseError: Failed to load
 *      function.
 *
 * — with the runtime then reporting "initialized" a second and a half later.
 * The function was fine; it simply had not finished loading in time.
 *
 * Accessors rather than getters so the cost is obvious at the call site.
 */
let _auth: ReturnType<typeof getAuth> | undefined;
let _storage: ReturnType<typeof getStorage> | undefined;

export const auth = (): ReturnType<typeof getAuth> => (_auth ??= getAuth());
export const storage = (): ReturnType<typeof getStorage> => (_storage ??= getStorage());

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
