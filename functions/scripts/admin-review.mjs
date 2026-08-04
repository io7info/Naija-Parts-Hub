#!/usr/bin/env node
/**
 * Dealer verification from the command line (SOW section 3).
 *
 * Exists because the admin portal's Review button is not yet wired to the
 * adminReviewStore callable — the approved design landed before the data layer.
 * This performs the same writes the callable does, including the audit entry,
 * so approvals made here are indistinguishable from portal approvals.
 *
 * It stays useful after the portal works: an ops fallback for when the web app
 * is down, and the only way to act without a browser.
 *
 * Usage (emulators must be running):
 *   npm run admin -- list
 *   npm run admin -- approve <storeId>
 *   npm run admin -- reject <storeId> "CAC number could not be verified"
 *   npm run admin -- suspend <storeId> "Repeated policy violations"
 *   npm run admin -- reactivate <storeId>
 *
 * Safety: refuses any project id not prefixed `demo-` unless
 * --allow-production is passed. Approving a dealer is a trust decision; doing
 * it against the wrong project by accident is exactly the mistake worth
 * engineering out.
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-naija-parts-hub';

process.env.FIRESTORE_EMULATOR_HOST ??= 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= 'localhost:9099';
process.env.GCLOUD_PROJECT = PROJECT_ID;

// google-auth-library probes GCP's metadata server for credentials even when
// the emulator hosts are set, costing a ~5s network timeout and printing a
// MetadataLookupWarning. Nothing here needs real credentials.
process.env.METADATA_SERVER_DETECTION = 'none';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const allowProduction = argv.includes('--allow-production');
const args = argv.filter((a) => a !== '--allow-production');
const [action = 'list', storeId, ...reasonParts] = args;
const reason = reasonParts.join(' ').trim();

if (!PROJECT_ID.startsWith('demo-') && !allowProduction) {
  console.error(`✗ Refusing to act on non-demo project "${PROJECT_ID}".`);
  console.error('  Pass --allow-production if this is deliberate.');
  process.exit(1);
}

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

const ACTIONS = new Set(['list', 'approve', 'reject', 'suspend', 'reactivate']);
if (!ACTIONS.has(action)) {
  console.error(`✗ Unknown action "${action}". One of: ${[...ACTIONS].join(', ')}`);
  process.exit(1);
}

/** Mirrors the switch in functions/src/adminReviewStore.ts. */
function patchFor(act, now) {
  switch (act) {
    case 'approve':
      return { status: 'approved', visible: true, approvedAt: now, rejectionReason: null };
    case 'reactivate':
      return { status: 'approved', visible: true, rejectionReason: null };
    case 'reject':
      return { status: 'rejected', visible: false, rejectionReason: reason || null };
    case 'suspend':
      // Status, not deletion: the dealer's data and slug survive so a
      // reactivation restores everything intact.
      return { status: 'suspended', visible: false, rejectionReason: reason || null };
    default:
      throw new Error(`no patch for ${act}`);
  }
}

async function list() {
  const snap = await db.collection('stores').get();
  if (snap.empty) {
    console.log('No stores registered.');
    return;
  }
  console.log(`${snap.size} store(s):\n`);
  const rows = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.status).localeCompare(String(b.status)));

  for (const s of rows) {
    const mark =
      s.status === 'approved' ? '✓' : s.status === 'pending' ? '•' : s.status === 'rejected' ? '✗' : '⏸';
    console.log(`  ${mark} ${String(s.status).padEnd(10)} ${s.businessName || '(no name)'}`);
    console.log(`      id      ${s.id}`);
    console.log(`      cac     ${s.cacNumber ?? '—'}   phone ${s.phone ?? '—'}`);
    console.log(`      listings ${s.activeListingCount ?? 0} active   visible=${s.visible}`);
    if (s.rejectionReason) console.log(`      reason  ${s.rejectionReason}`);
    console.log('');
  }
  console.log('Approve with:  npm run admin -- approve <id>');
}

async function review() {
  if (!storeId) {
    console.error(`✗ ${action} needs a store id. Run "npm run admin -- list" to find one.`);
    process.exit(1);
  }
  if ((action === 'reject' || action === 'suspend') && !reason) {
    console.error(`✗ ${action} needs a reason, which is shown to the dealer.`);
    console.error(`  npm run admin -- ${action} ${storeId} "your reason here"`);
    process.exit(1);
  }

  const ref = db.collection('stores').doc(storeId);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`✗ No store with id "${storeId}".`);
    process.exit(1);
  }

  const before = snap.data();
  const now = Timestamp.now();

  await ref.update({
    ...patchFor(action, now),
    updatedAt: now,
    // Distinguishes CLI actions from portal actions in the audit trail.
    reviewedBy: 'cli',
  });

  await db.collection('adminActions').add({
    action: `store.${action}`,
    targetId: storeId,
    adminId: 'cli',
    reason: reason || null,
    timestamp: FieldValue.serverTimestamp(),
  });

  const after = (await ref.get()).data();
  console.log(`✓ ${before.businessName || storeId}: ${before.status} → ${after.status}`);
  console.log(`  visible: ${before.visible} → ${after.visible}`);
  if (after.rejectionReason) console.log(`  reason:  ${after.rejectionReason}`);
  console.log('');
  console.log('  onStoreWritten is fanning this out to the store\'s listings.');
  console.log('  The dealer app re-routes on its own — it watches the store document.');
}

await (action === 'list' ? list() : review());
