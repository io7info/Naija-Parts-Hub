#!/usr/bin/env node
/**
 * Seeds the listing category taxonomy into PRODUCTION.
 *
 * Categories are the one collection the app cannot start without. The Add
 * Listing form reads `categories` where `active == true`; with the collection
 * empty the picker has no options, the form's "Choose a category" validation
 * can never be satisfied, and no dealer can create a listing at all.
 *
 * This is deliberately a separate script from seed-emulator.mjs rather than a
 * flag on it. That script also creates an administrator with a known password,
 * and the safest way to guarantee it never reaches production is that it
 * refuses any project id not starting with `demo-`. Loosening that check would
 * put a test admin one typo away from the live project.
 *
 * What this script will NOT do, at all: create users, admins, dealers, stores,
 * listings, payments, images, plans or settings. Categories only.
 *
 * Usage:
 *   # 1. Dry run. Prints the project, every planned change, and writes nothing.
 *   node functions/scripts/seed-production-categories.mjs
 *
 *   # 2. Apply, after reading the plan.
 *   node functions/scripts/seed-production-categories.mjs --confirm-production
 *
 * Credentials, whichever you have:
 *   FIREBASE_SERVICE_ACCOUNT_JSON='<the one-line JSON>'   # same value as Vercel
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   — or an already-authenticated gcloud Application Default Credential.
 */

import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { LISTING_CATEGORIES } from '@nph/contracts';

const PROJECT_ID = 'naijapartshub';
const COLLECTION = 'categories';

/**
 * The taxonomy comes from the contract, not from a copy kept here.
 *
 * The web marketplace nav derives its tiles from the same constant, so a
 * category offered to a buyer is always one this script will have created —
 * the failure it replaces was a homepage linking to ids no listing could
 * carry.
 */
const CATEGORIES = LISTING_CATEGORIES.map((c) => [c.id, c.name, c.order]);

const confirmed = process.argv.includes('--confirm-production');

// ---------------------------------------------------------------------------
// Guards. Each one exists because the opposite mistake is unrecoverable or
// embarrassing, and none of them can be satisfied by accident.
// ---------------------------------------------------------------------------

// An emulator host set in the shell would silently redirect these writes to a
// local emulator, print "done", and leave production untouched — the failure
// that looks exactly like success.
for (const v of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'STORAGE_EMULATOR_HOST']) {
  if (process.env[v]) {
    console.error(`✗ ${v} is set (${process.env[v]}).`);
    console.error('  This script writes to production and must not be pointed at an emulator.');
    process.exit(1);
  }
}

// The project is pinned in source, not taken from an argument or the ambient
// environment, so there is no input that can redirect it somewhere else.
const ambient = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
if (ambient && ambient !== PROJECT_ID) {
  console.error(`✗ GCLOUD_PROJECT is "${ambient}" but this script only targets "${PROJECT_ID}".`);
  console.error('  Unset it, or run against the intended project.');
  process.exit(1);
}

/**
 * Credentials, in the order they are most likely to be available.
 *
 * FIREBASE_SERVICE_ACCOUNT_JSON first because that is the variable already in
 * use for the Vercel deployment, so there is one key to manage rather than two
 * mechanisms that can disagree about which project they point at.
 */
function credential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed.project_id !== PROJECT_ID) {
      console.error(`✗ FIREBASE_SERVICE_ACCOUNT_JSON is for "${parsed.project_id}", not "${PROJECT_ID}".`);
      process.exit(1);
    }
    return cert(parsed);
  }
  return applicationDefault();
}

initializeApp({ credential: credential(), projectId: PROJECT_ID });
const db = getFirestore();

// ---------------------------------------------------------------------------

/** What each document should contain. Mirrors the Category contract. */
const desired = (id, name, order) => ({
  categoryId: id,
  name,
  slug: id,
  order,
  active: true,
});

function differences(existing, target) {
  return Object.entries(target)
    .filter(([k, v]) => JSON.stringify(existing[k]) !== JSON.stringify(v))
    .map(([k, v]) => `${k}: ${JSON.stringify(existing[k])} -> ${JSON.stringify(v)}`);
}

async function main() {
  console.log(`\nProject:    ${PROJECT_ID}`);
  console.log(`Collection: ${COLLECTION}`);
  console.log(`Mode:       ${confirmed ? 'APPLY' : 'dry run (nothing will be written)'}\n`);

  const plan = [];

  for (const [id, name, order] of CATEGORIES) {
    const target = desired(id, name, order);
    const snap = await db.collection(COLLECTION).doc(id).get();

    if (!snap.exists) {
      plan.push({ id, action: 'create', target, detail: JSON.stringify(target) });
      continue;
    }

    const diff = differences(snap.data(), target);
    // Idempotence is the point: a second run must be a no-op, not eight
    // rewrites that churn the collection and its listeners.
    plan.push(
      diff.length === 0
        ? { id, action: 'skip', target, detail: 'already correct' }
        : { id, action: 'update', target, detail: diff.join(', ') },
    );
  }

  for (const p of plan) {
    console.log(`  ${p.action.padEnd(6)} ${p.id.padEnd(14)} ${p.detail}`);
  }

  const writes = plan.filter((p) => p.action !== 'skip');
  const counts = {
    create: plan.filter((p) => p.action === 'create').length,
    update: plan.filter((p) => p.action === 'update').length,
    skip: plan.filter((p) => p.action === 'skip').length,
  };
  console.log(
    `\n${counts.create} to create, ${counts.update} to update, ${counts.skip} already correct.`,
  );

  // Reported but never deleted. An extra category may be one an administrator
  // added on purpose, and removing it would orphan every listing pointing at
  // it. Deletion is a decision for a human with the listing counts in hand.
  const all = await db.collection(COLLECTION).get();
  const known = new Set(CATEGORIES.map(([id]) => id));
  const extra = all.docs.map((d) => d.id).filter((id) => !known.has(id));
  if (extra.length > 0) {
    console.log(`\nNote: ${extra.length} category document(s) not in this list: ${extra.join(', ')}`);
    console.log('      Left untouched — deleting one would orphan any listing using it.');
  }

  if (!confirmed) {
    console.log('\nDry run. Re-run with --confirm-production to apply.\n');
    return;
  }

  if (writes.length === 0) {
    console.log('\nNothing to do.\n');
    return;
  }

  const batch = db.batch();
  for (const p of writes) {
    // merge: true so an administrator's later edit to a field this script does
    // not own survives a re-run.
    batch.set(db.collection(COLLECTION).doc(p.id), p.target, { merge: true });
  }
  await batch.commit();

  console.log(`\n✓ wrote ${writes.length} category document(s) to ${PROJECT_ID}.\n`);
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
