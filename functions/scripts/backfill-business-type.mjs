#!/usr/bin/env node
/**
 * Stamps `businessType: 'parts_dealer'` onto store documents that predate
 * auto mechanics.
 *
 * WHY THIS IS NECESSARY
 *
 * Firestore cannot express "field equals X or field is absent" in one query,
 * and `where('businessType', '!=', 'mechanic')` does not rescue it either:
 * an inequality only matches documents where the field exists. So the moment
 * the public dealer queries start filtering on business type, every store
 * registered before this feature would silently disappear from the
 * marketplace — approved, visible, paying, and invisible.
 *
 * The alternative was filtering in application code after fetching every
 * store, which works at ten stores and falls over at ten thousand.
 *
 * WHAT IT TOUCHES
 *
 * One field, on documents that do not already have it. It never edits an
 * existing value, never touches a document that already declares its type,
 * and never writes any other field. A store that is already
 * 'parts_dealer' or 'mechanic' is left exactly as it is.
 *
 * Safe to run repeatedly: the second run finds nothing to do.
 *
 * Usage:
 *   # 1. Dry run. Prints the project, every planned change, writes nothing.
 *   node functions/scripts/backfill-business-type.mjs
 *
 *   # 2. Apply, after reading the plan.
 *   node functions/scripts/backfill-business-type.mjs --confirm-production
 *
 *   # Against the emulator instead (no confirmation needed):
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 \
 *   GCLOUD_PROJECT=demo-naija-parts-hub \
 *   node functions/scripts/backfill-business-type.mjs --emulator
 *
 * Credentials, whichever you have:
 *   FIREBASE_SERVICE_ACCOUNT_JSON='<the one-line JSON>'   # same value as Vercel
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   — or an already-authenticated gcloud Application Default Credential.
 */

import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'naijapartshub';
const COLLECTION = 'stores';
const FIELD = 'businessType';
const VALUE = 'parts_dealer';

const emulatorMode = process.argv.includes('--emulator');
const confirmed = process.argv.includes('--confirm-production');

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

if (!emulatorMode) {
  // An emulator host set in the shell would redirect these writes to a local
  // emulator, print "done", and leave production untouched — the failure that
  // looks exactly like success.
  for (const v of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
    if (process.env[v]) {
      console.error(`✗ ${v} is set (${process.env[v]}).`);
      console.error('  Pass --emulator if that is what you meant.');
      process.exit(1);
    }
  }

  const ambient = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (ambient && ambient !== PROJECT_ID) {
    console.error(`✗ GCLOUD_PROJECT is "${ambient}" but this script targets "${PROJECT_ID}".`);
    process.exit(1);
  }
}

function credential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed.project_id !== PROJECT_ID) {
      console.error(
        `✗ FIREBASE_SERVICE_ACCOUNT_JSON is for "${parsed.project_id}", not "${PROJECT_ID}".`,
      );
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

console.log(`project    ${projectId}`);
console.log(`collection ${COLLECTION}`);
console.log(`setting    ${FIELD} = "${VALUE}" where absent\n`);

// Read every store. There is no query for "field is absent", which is the
// whole reason this script exists, so the filtering happens here.
const snap = await db.collection(COLLECTION).get();

const missing = [];
const already = [];
for (const doc of snap.docs) {
  const current = doc.get(FIELD);
  if (current === undefined || current === null || current === '') missing.push(doc);
  else already.push([doc.id, current]);
}

console.log(`${snap.size} store(s) total`);
console.log(`  ${already.length} already declare a type`);
for (const [id, type] of already) console.log(`      ${String(type).padEnd(13)} ${id}`);
console.log(`  ${missing.length} need backfilling`);
for (const doc of missing) {
  console.log(`      ${(doc.get('businessName') || '(no name)').slice(0, 30).padEnd(32)} ${doc.id}`);
}

if (missing.length === 0) {
  console.log('\nNothing to do.');
  process.exit(0);
}

if (!emulatorMode && !confirmed) {
  console.log('\nDry run — nothing written.');
  console.log('Re-run with --confirm-production to apply.');
  process.exit(0);
}

// `update` rather than `set(..., {merge:true})`: update fails loudly if the
// document vanished between the read and the write, where a merge would
// silently recreate a store that an account deletion had just removed.
const batch = db.batch();
for (const doc of missing) batch.update(doc.ref, { [FIELD]: VALUE });
await batch.commit();

console.log(`\n✓ Backfilled ${missing.length} store(s).`);
