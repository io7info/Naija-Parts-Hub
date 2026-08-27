#!/usr/bin/env node
/**
 * Seeds approved auto mechanics into the Local Emulator Suite.
 *
 * WHY THIS SCRIPT HAS TO EXIST
 *
 * A mechanic cannot be approved through the product without a passing BVN/NIN
 * check — `adminReviewStore` refuses, deliberately — and no KYC provider is
 * configured yet. So there is no route through the UI to an approved mechanic,
 * which means the public directory at /mechanics and the profile pages have
 * nothing to render and cannot be reviewed at all.
 *
 * WHAT THIS IS NOT
 *
 * It is not a verification bypass. It writes emulator fixtures with the Admin
 * SDK, the same way seed-marketplace.mjs writes fictional dealers, and it
 * refuses to run against anything but a `demo-` project. Nothing here touches
 * the production identity path, weakens a rule, or lets a real mechanic reach
 * a Verified badge without a real check. The `identity` block it writes
 * carries a `seeded` provider precisely so it can never be mistaken for the
 * output of a genuine Dojah response.
 *
 * Usage (emulators must already be running):
 *   node functions/scripts/seed-mechanics.mjs
 */

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-naija-parts-hub';

process.env.FIRESTORE_EMULATOR_HOST ??= 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= 'localhost:9099';
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.METADATA_SERVER_DETECTION = 'none';

if (!PROJECT_ID.startsWith('demo-')) {
  console.error(`✗ Refusing to seed non-demo project "${PROJECT_ID}".`);
  console.error('  These are fictional businesses carrying a Verified badge.');
  process.exit(1);
}

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
const auth = getAuth();

const now = Timestamp.now();

/**
 * A verified identity block, marked as seed data.
 *
 * `provider: 'seeded'` is the tell. Every real block records 'dojah' plus a
 * provider reference, so anything auditing production for genuine
 * verifications can exclude these without ambiguity — and if one of these
 * documents ever appeared in production, it would be obvious at a glance.
 */
const seededIdentity = (bvnLast4, ninLast4, verifiedName) => ({
  status: 'verified',
  provider: 'seeded',
  reference: null,
  verifiedAt: now,
  bvnLast4,
  ninLast4,
  // No fingerprints: those are keyed HMACs of real identifiers, and inventing
  // values would put junk in the collision check that guards one-person-one-
  // account. Absent is honest; a made-up hash is not.
  bvnFingerprint: null,
  ninFingerprint: null,
  fingerprintKeyVersion: null,
  nameMatch: true,
  verifiedName,
  attempts: 1,
  lockedUntil: null,
});

const MECHANICS = [
  {
    storeId: 'seed-mechanic-kunle',
    businessName: 'Kunle Auto Works',
    ownerName: 'Kunle Bakare',
    slug: 'kunle-auto-works',
    phone: '+2348022334455',
    whatsapp: '+2348022334455',
    address: '14 Oshodi Expressway',
    state: 'Lagos',
    city: 'Oshodi',
    description:
      'Engine and brake specialists. Twelve years on the Oshodi expressway, '
      + 'and we handle everything from a squealing pad to a full rebuild.',
    specialties: ['engine', 'brakes', 'diagnostics'],
    identity: seededIdentity('4821', '9930', 'Kunle Bakare'),
  },
  {
    storeId: 'seed-mechanic-amaka',
    businessName: 'Amaka Motors & AC',
    ownerName: 'Amaka Obi',
    slug: 'amaka-motors-ac',
    phone: '+2348033445566',
    whatsapp: '+2348033445566',
    address: '7 Aba Road',
    state: 'Rivers',
    city: 'Port Harcourt',
    description:
      'Auto electrical and air conditioning. If the fan blows warm or the '
      + 'dashboard lights up for no reason, bring it in.',
    specialties: ['electrical', 'ac', 'diagnostics'],
    identity: seededIdentity('1177', '2043', 'Amaka Obi'),
  },
  {
    storeId: 'seed-mechanic-ibrahim',
    businessName: 'Ibrahim Panel & Paint',
    ownerName: 'Ibrahim Sani',
    slug: 'ibrahim-panel-paint',
    phone: '+2348044556677',
    whatsapp: '+2348044556677',
    address: '22 Ahmadu Bello Way',
    state: 'Kaduna',
    city: 'Kaduna',
    description:
      'Panel beating, straightening and respray. We match factory colours and '
      + 'return the car looking like the dent never happened.',
    specialties: ['bodywork', 'suspension', 'general'],
    identity: seededIdentity('6502', '8814', 'Ibrahim Sani'),
  },
  {
    // Deliberately left pending and unverified: the state every real mechanic
    // is in today. It must appear in the admin verification queue and NOWHERE
    // on the public site — which is the more valuable of the two things to be
    // able to see.
    storeId: 'seed-mechanic-pending',
    businessName: 'Chidi Quick Fix',
    ownerName: 'Chidi Nwosu',
    slug: 'chidi-quick-fix',
    phone: '+2348055667788',
    whatsapp: '+2348055667788',
    address: '3 Zik Avenue',
    state: 'Enugu',
    city: 'Enugu',
    description: 'General repairs and roadside recovery.',
    specialties: ['general', 'suspension'],
    pending: true,
  },
];

const storeDoc = (m) => ({
  storeId: m.storeId,
  businessName: m.businessName,
  ownerName: m.ownerName,
  phone: m.phone,
  whatsapp: m.whatsapp,
  email: '',
  // Most independent workshops are not incorporated; identity is proven by
  // BVN and NIN instead.
  cacNumber: '',
  address: m.address,
  landmark: '',
  state: m.state,
  city: m.city,
  description: m.description,
  automotiveCategory: '',
  slug: m.slug,

  businessType: 'mechanic',
  mechanic: { specialties: m.specialties, photos: [] },
  ...(m.pending
    ? {
        identity: {
          status: 'unverified',
          provider: null,
          reference: null,
          verifiedAt: null,
          bvnLast4: null,
          ninLast4: null,
          bvnFingerprint: null,
          ninFingerprint: null,
          fingerprintKeyVersion: null,
          nameMatch: null,
          verifiedName: null,
          attempts: 0,
          lockedUntil: null,
        },
      }
    : { identity: m.identity }),

  status: m.pending ? 'pending' : 'approved',
  rejectionReason: null,
  visible: !m.pending,
  activeListingCount: 0,
  subscription: {
    plan: 'free',
    status: 'none',
    startedAt: null,
    expiresAt: null,
    graceEndsAt: null,
    lastPaymentReference: null,
  },
  termsAcceptedAt: now,
  createdAt: now,
  updatedAt: now,
  approvedAt: m.pending ? null : now,
  reviewedBy: m.pending ? null : 'seed',
});

const batch = db.batch();
for (const m of MECHANICS) {
  batch.set(db.doc(`stores/${m.storeId}`), storeDoc(m));
  // The slug reservation, because uniqueness is enforced by these documents
  // rather than by a query — a store seeded without one would let a real
  // registration steal its URL.
  batch.set(db.doc(`storeSlugs/${m.slug}`), { storeId: m.storeId, createdAt: now });
}
await batch.commit();

/**
 * An Auth account per mechanic, keyed by the store id.
 *
 * Store documents are keyed by the owner's uid, so without a matching account
 * these fixtures can be looked at on the web but never signed into — and
 * MechanicShell, the entire approved-mechanic app, has no route that reaches
 * it. There is no way to reach it through the product either: approval
 * requires verification, and verification requires a provider that is not
 * configured.
 *
 * Emulator only. The `demo-` guard above already refused anything else, and
 * these phone numbers are fictional.
 */
for (const m of MECHANICS) {
  // Cleared by uid AND by phone number.
  //
  // Deleting only the uid was not enough: the Auth emulator's export can
  // outlive the Firestore one, and a phone number left behind under a
  // different uid — a real sign-in, or an earlier seed — makes createUser
  // fail with auth/phone-number-already-exists. The number is the thing
  // being claimed here, so it is the thing that has to be free.
  await auth.deleteUser(m.storeId).catch(() => {});

  const existing = await auth.getUserByPhoneNumber(m.phone).catch(() => null);
  if (existing && existing.uid !== m.storeId) {
    await auth.deleteUser(existing.uid).catch(() => {});
  }

  await auth.createUser({ uid: m.storeId, phoneNumber: m.phone });
}

const live = MECHANICS.filter((m) => !m.pending);
console.log(`✓ Seeded ${MECHANICS.length} mechanics into ${PROJECT_ID}`);
for (const m of live) {
  console.log(`  approved  ${m.businessName.padEnd(24)} /mechanic/${m.slug}`);
}
for (const m of MECHANICS.filter((m) => m.pending)) {
  console.log(`  pending   ${m.businessName.padEnd(24)} (admin queue only, not public)`);
}

console.log('\nSign in on the mobile app with any of these to see MechanicShell:');
for (const m of live) {
  console.log(`  ${m.phone.padEnd(16)} ${m.businessName}`);
}
console.log(`  ${MECHANICS.find((m) => m.pending).phone.padEnd(16)} `
  + `${MECHANICS.find((m) => m.pending).businessName} (pending — shows the verify prompt)`);
console.log('\nThese are emulator fixtures. provider: "seeded" marks the identity');
console.log('blocks as fabricated — no real BVN or NIN check was performed.');

process.exit(0);
