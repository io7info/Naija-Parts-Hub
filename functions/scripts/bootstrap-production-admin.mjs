#!/usr/bin/env node
/**
 * Grants the `super_admin` custom claim to an existing production account.
 *
 * This is the one operation with no in-app path, by design. The admin portal
 * authorises on a custom claim (`ADMIN_CLAIM` / `ADMIN_CLAIM_VALUE`), and
 * firestore.rules reads that claim rather than a Firestore document —
 * specifically so privilege escalation is never one document write away. The
 * consequence is a bootstrap problem: nobody can grant the first admin through
 * the product, because using the product requires already being one.
 *
 * Until this runs, no store can be approved, so nothing reaches the
 * marketplace. It is the last blocker before the production flow works
 * end to end.
 *
 * Deliberately NOT a Cloud Function. A deployed callable that grants
 * super_admin is a permanent escalation surface — one authorisation bug in it
 * and any signed-in dealer owns the platform. A local script guarded by a
 * service-account credential can only be run by someone who already holds the
 * keys to the project, which is the same trust boundary the operation needs.
 *
 * What it will NOT do: create an account. The person must have signed in at
 * least once, which proves the address is real and controlled. Creating a user
 * here would let a typo mint an admin account nobody owns.
 *
 * Usage:
 *   # 1. Dry run. Prints the account and the exact claim change. Writes nothing.
 *   npm run bootstrap:prod-admin -- --email=someone@example.com
 *
 *   # 2. Apply, after reading the plan.
 *   npm run bootstrap:prod-admin -- --email=someone@example.com --confirm-production
 *
 * Credentials, whichever you have:
 *   FIREBASE_SERVICE_ACCOUNT_JSON='<the one-line JSON>'   # same value as Vercel
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 */

import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { ADMIN_CLAIM, ADMIN_CLAIM_VALUE } from '@nph/contracts';

const PROJECT_ID = 'naijapartshub';

const args = process.argv.slice(2);
const confirmed = args.includes('--confirm-production');
const email = args.find((a) => a.startsWith('--email='))?.slice('--email='.length)?.trim();

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

if (!email) {
  console.error('✗ --email=<address> is required.');
  console.error('  There is deliberately no default: an administrator hardcoded here');
  console.error('  would be granted by anyone who ran the script without reading it.');
  process.exit(1);
}

// An emulator host in the shell would grant the claim on a throwaway local
// user and report success, leaving production with no administrator at all.
for (const v of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST']) {
  if (process.env[v]) {
    console.error(`✗ ${v} is set (${process.env[v]}).`);
    console.error('  This script targets production and must not be pointed at an emulator.');
    process.exit(1);
  }
}

const ambient = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
if (ambient && ambient !== PROJECT_ID) {
  console.error(`✗ GCLOUD_PROJECT is "${ambient}" but this script only targets "${PROJECT_ID}".`);
  process.exit(1);
}

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
const auth = getAuth();

// ---------------------------------------------------------------------------

async function main() {
  console.log(`\nProject: ${PROJECT_ID}`);
  console.log(`Mode:    ${confirmed ? 'APPLY' : 'dry run (nothing will be written)'}\n`);

  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      console.error(`✗ No account exists for ${email}.`);
      console.error('  This script never creates one. Have them sign in to the admin portal');
      console.error('  once first, then re-run — a sign-in proves the address is theirs.');
      process.exit(1);
    }
    throw err;
  }

  const existing = user.customClaims ?? {};

  console.log(`  email          ${user.email}`);
  console.log(`  uid            ${user.uid}`);
  console.log(`  disabled       ${user.disabled}`);
  console.log(`  current claims ${JSON.stringify(existing)}`);

  if (user.disabled) {
    console.error('\n✗ That account is disabled. Enable it before granting admin rights.');
    process.exit(1);
  }

  // Merged, never replaced. setCustomUserClaims overwrites the whole object, so
  // passing only the role would silently drop anything else the account holds.
  const next = { ...existing, [ADMIN_CLAIM]: ADMIN_CLAIM_VALUE };

  if (existing[ADMIN_CLAIM] === ADMIN_CLAIM_VALUE) {
    console.log(`\n✓ ${email} already holds ${ADMIN_CLAIM}=${ADMIN_CLAIM_VALUE}. Nothing to do.\n`);
    return;
  }

  console.log(`\n  claims after   ${JSON.stringify(next)}`);
  const preserved = Object.keys(existing).filter((k) => k !== ADMIN_CLAIM);
  if (preserved.length > 0) {
    console.log(`  preserving     ${preserved.join(', ')}`);
  }

  if (!confirmed) {
    console.log('\nDry run. Re-run with --confirm-production to apply.\n');
    return;
  }

  await auth.setCustomUserClaims(user.uid, next);

  console.log(`\n✓ ${email} is now ${ADMIN_CLAIM}=${ADMIN_CLAIM_VALUE}.`);
  console.log('\n  The claim is baked into the ID token, so it does not appear until a new');
  console.log('  one is issued. Have them sign out and sign back in — or wait up to an');
  console.log('  hour for the automatic refresh. Until then the portal still refuses them,');
  console.log('  which reads exactly like the grant having failed.\n');
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
