#!/usr/bin/env node
/**
 * Pushes mechanics verified under a withdrawn fingerprint key back into
 * re-verification.
 *
 * WHY THIS EXISTS
 *
 * `adminReviewStore` refuses to approve a mechanic whose verification came
 * from a compromised key. That covers everything arriving from now on, and
 * nothing already approved — those records sit in production still marked
 * verified, which is exactly the "silently trusted forever" outcome the gate
 * was meant to prevent. A callable cannot fix them; it only ever sees the one
 * store it was called about. This does the sweep.
 *
 * WHAT A COMPROMISED KEY ACTUALLY MEANS
 *
 * BVN and NIN are eleven digits, so the whole space is 10^11. With the HMAC
 * key, that is enumerable: an attacker can recover the identifiers behind
 * stored fingerprints, and can mint a fingerprint colliding with a real one —
 * which is precisely what the duplicate-account check assumes is impossible.
 * The verification those records carry is no longer evidence.
 *
 * It does NOT mean the mechanic did anything wrong. So the default is to
 * require re-verification, not to take a working business offline: their
 * profile stays public while they are asked to verify again. `--hide` is there
 * for a severe compromise where that trade is wrong, and it is deliberately
 * not the default — hiding every mechanic because we leaked a key punishes
 * them for our failure.
 *
 * IDEMPOTENT
 *
 * Only records still claiming `identity.status == 'verified'` are selected, so
 * a second run finds nothing. Safe to re-run after a partial failure.
 *
 * Usage:
 *   # 1. Dry run. Prints the affected mechanics and writes nothing.
 *   node functions/scripts/flag-compromised-identities.mjs
 *
 *   # 2. Apply.
 *   node functions/scripts/flag-compromised-identities.mjs --confirm-production
 *
 *   # 3. Severe compromise: also remove them from public view until verified.
 *   node functions/scripts/flag-compromised-identities.mjs --confirm-production --hide
 *
 *   # Against the emulator:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=demo-naija-parts-hub \
 *   node functions/scripts/flag-compromised-identities.mjs --emulator
 *
 * The keyring is read from IDENTITY_FINGERPRINT_KEY in the environment, since
 * this runs outside a Cloud Function and cannot resolve Secret Manager params:
 *   IDENTITY_FINGERPRINT_KEY='{"current":2,"keys":{...},"compromised":[1]}'
 */

import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

import { parseKeyring, shouldFlagForReverification } from '../lib/lib/identity/fingerprint.js';

const PROJECT_ID = 'naijapartshub';
const COLLECTION = 'stores';

const emulatorMode = process.argv.includes('--emulator');
const confirmed = process.argv.includes('--confirm-production');
const alsoHide = process.argv.includes('--hide');

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

if (!emulatorMode) {
  for (const v of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
    if (process.env[v]) {
      console.error(`✗ ${v} is set (${process.env[v]}). Pass --emulator if that is what you meant.`);
      process.exit(1);
    }
  }
  const ambient = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (ambient && ambient !== PROJECT_ID) {
    console.error(`✗ GCLOUD_PROJECT is "${ambient}" but this script targets "${PROJECT_ID}".`);
    process.exit(1);
  }
}

// The keyring decides who is affected. Running without it would sweep nothing
// and report success, which is the failure that looks exactly like a clean
// result — so it is required rather than defaulted.
let ring;
try {
  ring = parseKeyring(process.env.IDENTITY_FINGERPRINT_KEY ?? '');
} catch (error) {
  console.error(`✗ IDENTITY_FINGERPRINT_KEY is missing or unusable: ${error.message}`);
  console.error('  Export the same value the Cloud Functions use.');
  process.exit(1);
}

if (ring.compromised.length === 0) {
  console.log('No key versions are marked compromised. Nothing to do.');
  console.log('Mark one by adding its version to "compromised" in the keyring secret.');
  process.exit(0);
}

function credential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed.project_id !== PROJECT_ID) {
      console.error(`✗ FIREBASE_SERVICE_ACCOUNT_JSON is for "${parsed.project_id}".`);
      process.exit(1);
    }
    return cert(parsed);
  }
  return applicationDefault();
}

const projectId = emulatorMode ? (process.env.GCLOUD_PROJECT ?? 'demo-naija-parts-hub') : PROJECT_ID;
initializeApp(emulatorMode ? { projectId } : { credential: credential(), projectId });
const db = getFirestore();

// ---------------------------------------------------------------------------

console.log(`project          ${projectId}`);
console.log(`current key      v${ring.current}`);
console.log(`compromised      ${ring.compromised.map((v) => `v${v}`).join(', ')}`);
console.log(`on apply         identity.status -> 'unverified'${alsoHide ? ' + visible -> false' : ''}\n`);

// Mechanics only. The query cannot express "fingerprint version is in this
// list", so the version test happens in code — but businessType narrows it so
// a project with many dealers does not read them all.
const snap = await db.collection(COLLECTION).where('businessType', '==', 'mechanic').get();

const affected = snap.docs.filter((doc) => shouldFlagForReverification(doc.data(), ring));

console.log(`${snap.size} mechanic(s) examined`);
console.log(`${affected.length} affected by a withdrawn key\n`);

for (const doc of affected) {
  const d = doc.data();
  console.log(
    `  ${(d.businessName || '(no name)').slice(0, 28).padEnd(30)} ` +
      `status=${String(d.status).padEnd(10)} keyVersion=v${d.identity?.fingerprintKeyVersion}  ${doc.id}`,
  );
}

if (affected.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

if (!emulatorMode && !confirmed) {
  console.log('\nDry run — nothing written.');
  console.log('Re-run with --confirm-production to apply.');
  process.exit(0);
}

// Chunked: Firestore caps a batch at 500 writes, and a key compromise could
// plausibly affect more mechanics than that.
const CHUNK = 400;
let written = 0;
for (let i = 0; i < affected.length; i += CHUNK) {
  const batch = db.batch();
  for (const doc of affected.slice(i, i + CHUNK)) {
    const patch = {
      'identity.status': 'unverified',
      // Records why, so an administrator seeing an unverified mechanic knows
      // this was a platform action rather than a failed check on their part.
      'identity.reverificationRequiredAt': Timestamp.now(),
      'identity.verifiedAt': null,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (alsoHide) patch.visible = false;
    batch.update(doc.ref, patch);
  }
  await batch.commit();
  written += Math.min(CHUNK, affected.length - i);
}

console.log(`\n✓ Flagged ${written} mechanic(s) for re-verification.`);
console.log('  They must complete BVN and NIN verification again.');
console.log('  adminReviewStore will refuse to approve them until they do.');
