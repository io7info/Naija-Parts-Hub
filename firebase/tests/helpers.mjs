import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';

const here = dirname(fileURLToPath(import.meta.url));
const firebaseDir = join(here, '..');

export { assertFails, assertSucceeds };

export const PROJECT_ID = 'demo-naija-parts-hub';

export async function makeTestEnv() {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(join(firebaseDir, 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
    storage: {
      rules: readFileSync(join(firebaseDir, 'storage.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 9199,
    },
  });
}

/** A signed-in dealer. */
export const dealer = (env, uid) => env.authenticatedContext(uid).firestore();

/** A signed-in HQ administrator — identity comes from the custom claim. */
export const admin = (env, uid = 'admin-1') =>
  env.authenticatedContext(uid, { role: 'super_admin' }).firestore();

/** An unauthenticated visitor, i.e. a marketplace buyer. */
export const visitor = (env) => env.unauthenticatedContext().firestore();

/**
 * Seeds documents bypassing rules, the way Cloud Functions do with the Admin
 * SDK. Used to set up state that clients are (correctly) forbidden to create.
 */
export async function seed(env, writer) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await writer(ctx.firestore());
  });
}

export function storeDoc(overrides = {}) {
  return {
    storeId: 'dealer-1',
    businessName: 'Musa Auto Parts',
    ownerName: 'Musa Bello',
    phone: '+2348031234567',
    whatsapp: '+2348031234567',
    cacNumber: 'RC123456',
    address: '12 Ladipo Street',
    state: 'Lagos',
    city: 'Lagos',
    description: 'Genuine parts',
    slug: 'musa-auto-parts',
    status: 'approved',
    rejectionReason: null,
    visible: true,
    activeListingCount: 0,
    subscription: {
      plan: 'free',
      status: 'none',
      startedAt: null,
      expiresAt: null,
      graceEndsAt: null,
      lastPaymentReference: null,
    },
    termsAcceptedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    approvedAt: new Date(),
    reviewedBy: null,
    ...overrides,
  };
}

export function listingDoc(overrides = {}) {
  return {
    storeId: 'dealer-1',
    name: 'Bajaj Brake Pad',
    description: 'Front brake pad set',
    categoryId: 'brake',
    condition: 'new',
    priceKobo: 500000,
    quantity: 10,
    brand: 'Bosch',
    partNumber: 'BP-1234',
    compatibleMake: 'Bajaj',
    compatibleModel: 'Pulsar',
    images: [],
    status: 'draft',
    searchTokens: ['bra', 'brake'],
    publiclyVisible: false,
    storeApproved: true,
    storeVisible: true,
    storeSlug: 'musa-auto-parts',
    storeBusinessName: 'Musa Auto Parts',
    storeState: 'Lagos',
    storeCity: 'Lagos',
    storePhone: '+2348031234567',
    storeWhatsapp: '+2348031234567',
    moderation: { removed: false, removedBy: null, removedReason: null, removedAt: null },
    createdAt: new Date(),
    updatedAt: new Date(),
    publishedAt: null,
    ...overrides,
  };
}

/** The dealer-writable subset. Anything outside this must be rejected. */
export function dealerListingCreate(overrides = {}) {
  return {
    storeId: 'dealer-1',
    status: 'draft',
    name: 'Bajaj Brake Pad',
    description: 'Front brake pad set',
    categoryId: 'brake',
    condition: 'new',
    priceKobo: 500000,
    quantity: 10,
    brand: 'Bosch',
    partNumber: 'BP-1234',
    compatibleMake: 'Bajaj',
    compatibleModel: 'Pulsar',
    images: [],
    updatedAt: new Date(),
    ...overrides,
  };
}
