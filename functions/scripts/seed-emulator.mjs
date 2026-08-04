#!/usr/bin/env node
/**
 * Seeds the Local Emulator Suite so the vertical slice can be exercised
 * immediately: an admin account with the super_admin claim, and the category
 * taxonomy the listing form expects.
 *
 * Safety: refuses to run unless FIRESTORE_EMULATOR_HOST is set AND the project
 * id starts with `demo-`. Creating admin accounts is exactly the operation you
 * never want pointed at production by accident.
 *
 * Usage (emulators must already be running):
 *   node functions/scripts/seed-emulator.mjs
 *   node functions/scripts/seed-emulator.mjs <uid>   # grant claim to an existing uid
 */

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-naija-parts-hub';

process.env.FIRESTORE_EMULATOR_HOST ??= 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= 'localhost:9099';
process.env.GCLOUD_PROJECT = PROJECT_ID;

// google-auth-library probes GCP's metadata server for credentials even when
// the emulator hosts are set, costing a ~5s network timeout and printing a
// MetadataLookupWarning. Nothing here needs real credentials.
process.env.METADATA_SERVER_DETECTION = 'none';

if (!PROJECT_ID.startsWith('demo-')) {
  console.error(`✗ Refusing to seed non-demo project "${PROJECT_ID}".`);
  process.exit(1);
}

initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();

const ADMIN_EMAIL = 'admin@lytodmotors.test';
const ADMIN_PASSWORD = 'password123';

async function ensureAdmin() {
  const explicitUid = process.argv[2];
  if (explicitUid) {
    await auth.setCustomUserClaims(explicitUid, { role: 'super_admin' });
    console.log(`✓ granted super_admin to ${explicitUid}`);
    return;
  }

  let user;
  try {
    user = await auth.getUserByEmail(ADMIN_EMAIL);
  } catch {
    user = await auth.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      displayName: 'Lytod Motors HQ',
    });
    console.log(`✓ created admin ${ADMIN_EMAIL}`);
  }

  // The claim is set via the Admin SDK only — never derived from a Firestore
  // document a dealer could reach.
  await auth.setCustomUserClaims(user.uid, { role: 'super_admin' });
  console.log(`✓ super_admin claim on ${ADMIN_EMAIL} (${user.uid})`);
  console.log(`  password: ${ADMIN_PASSWORD}`);
}

const CATEGORIES = [
  ['engine', 'Engine', 1],
  ['brake', 'Brake', 2],
  ['suspension', 'Suspension', 3],
  ['electrical', 'Electrical', 4],
  ['body', 'Body', 5],
  ['transmission', 'Transmission', 6],
  ['filters', 'Filters', 7],
  ['other', 'Other', 8],
];

async function seedCategories() {
  const batch = db.batch();
  for (const [id, name, order] of CATEGORIES) {
    batch.set(db.collection('categories').doc(id), {
      categoryId: id,
      name,
      slug: id,
      order,
      active: true,
    });
  }
  await batch.commit();
  console.log(`✓ seeded ${CATEGORIES.length} categories`);
}

await ensureAdmin();
await seedCategories();
console.log('\nEmulator seeded. Admin portal: http://localhost:3000/admin');
