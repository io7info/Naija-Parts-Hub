#!/usr/bin/env node
/**
 * Puts a store's subscription into a chosen state, in the EMULATOR only.
 *
 * Every subscription state is a function of two timestamps, so seeing grace or
 * expiry otherwise means either waiting a month or hand-editing dates in the
 * emulator UI and getting the arithmetic right. This does the arithmetic.
 *
 * Emulator-only by construction: it refuses to run unless
 * FIRESTORE_EMULATOR_HOST is set AND the project id starts with `demo-`. Both,
 * not either — a stray GCLOUD_PROJECT with the host unset would otherwise write
 * subscription state straight into production, which is the one collection
 * where a wrong write means a dealer either loses a plan they paid for or gets
 * one they did not.
 *
 * Usage (emulators running):
 *   node scripts/dev-subscription.mjs                      # list stores
 *   node scripts/dev-subscription.mjs <store> free
 *   node scripts/dev-subscription.mjs <store> active [--plan=yearly]
 *   node scripts/dev-subscription.mjs <store> grace
 *   node scripts/dev-subscription.mjs <store> expired
 *
 * <store> is a document id or a phone number.
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-naija-parts-hub';

if (!process.env.FIRESTORE_EMULATOR_HOST || !PROJECT_ID.startsWith('demo-')) {
  console.error('✗ This is a development tool and only runs against a demo-* emulator project.');
  process.exit(1);
}

process.env.METADATA_SERVER_DETECTION = 'none';
initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

const DAY = 86_400_000;
const [target, state] = process.argv.slice(2);
const plan = (process.argv.find((a) => a.startsWith('--plan=')) ?? '--plan=monthly').split('=')[1];

/** The two timestamps every state is derived from. */
function subscriptionFor(state, plan, now) {
  const days = plan === 'yearly' ? 365 : 30;

  switch (state) {
    case 'free':
      return { plan: 'free', status: 'none', startedAt: null, expiresAt: null, graceEndsAt: null, lastPaymentReference: null };

    case 'active': {
      const expiresAt = now + days * DAY;
      return {
        plan,
        status: 'active',
        startedAt: Timestamp.fromMillis(now),
        expiresAt: Timestamp.fromMillis(expiresAt),
        graceEndsAt: Timestamp.fromMillis(expiresAt + 7 * DAY),
        lastPaymentReference: 'dev-active',
      };
    }

    case 'grace': {
      // Expired two days ago, so five of the seven grace days remain — enough
      // for the countdown to read as a real number rather than 1 or 7.
      const expiresAt = now - 2 * DAY;
      return {
        plan,
        status: 'active', // deliberately stale: the app must derive, not trust
        startedAt: Timestamp.fromMillis(expiresAt - days * DAY),
        expiresAt: Timestamp.fromMillis(expiresAt),
        graceEndsAt: Timestamp.fromMillis(expiresAt + 7 * DAY),
        lastPaymentReference: 'dev-grace',
      };
    }

    case 'expired': {
      const expiresAt = now - 14 * DAY;
      return {
        plan,
        status: 'grace', // also stale, for the same reason
        startedAt: Timestamp.fromMillis(expiresAt - days * DAY),
        expiresAt: Timestamp.fromMillis(expiresAt),
        graceEndsAt: Timestamp.fromMillis(expiresAt + 7 * DAY),
        lastPaymentReference: 'dev-expired',
      };
    }

    default:
      return null;
  }
}

async function findStore(needle) {
  const byId = await db.collection('stores').doc(needle).get();
  if (byId.exists) return byId;

  const byPhone = await db.collection('stores').where('phone', '==', needle).limit(1).get();
  return byPhone.empty ? null : byPhone.docs[0];
}

async function list() {
  const snap = await db.collection('stores').get();
  if (snap.empty) {
    console.log('\nNo stores. Run `npm run seed:marketplace`, or register one in the app.\n');
    return;
  }
  console.log('\nStores in the emulator:\n');
  for (const d of snap.docs) {
    const s = d.data();
    const sub = s.subscription ?? {};
    const expires = sub.expiresAt?.toDate?.();
    console.log(
      `  ${d.id.padEnd(30)} ${(s.businessName ?? '-').padEnd(28)} ${(s.phone ?? '-').padEnd(16)} ` +
        `${(sub.plan ?? 'free').padEnd(8)} ${expires ? expires.toISOString().slice(0, 10) : ''}`,
    );
  }
  console.log('\nThen: node scripts/dev-subscription.mjs <id or phone> active|grace|expired|free\n');
}

async function main() {
  if (!target) return list();

  const subscription = subscriptionFor(state, plan, Date.now());
  if (!subscription) {
    console.error(`✗ Unknown state "${state}". Use free, active, grace or expired.`);
    process.exit(1);
  }

  const doc = await findStore(target);
  if (!doc) {
    console.error(`✗ No store matching "${target}".`);
    await list();
    process.exit(1);
  }

  await doc.ref.update({ subscription, updatedAt: Timestamp.now() });

  const expires = subscription.expiresAt?.toDate?.();
  console.log(
    `\n✓ ${doc.get('businessName') ?? doc.id} -> ${state}` +
      (expires ? ` (expires ${expires.toISOString().slice(0, 10)})` : '') +
      '\n  The subscription page and the app update live — no reload needed.\n',
  );
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
