import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { initializeApp as initAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';

import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithCustomToken, signOut } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  disableNetwork,
  doc,
  enableNetwork,
  getDoc,
  getFirestore,
  onSnapshot,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

/**
 * Offline persistence and pending-write visibility (SOW section 10).
 *
 * ADR-001 #3 replaced the inherited Hive sync layer with Firestore's native
 * offline support. That decision is only sound if the behaviour it promises is
 * real, so these assert it directly rather than trusting the SDK:
 *
 *   - a write made offline is applied locally straight away
 *   - snapshot metadata reports hasPendingWrites while it is unacknowledged
 *   - reads while offline are served from cache
 *   - reconnecting replays the queued write and clears the flag
 *
 * hasPendingWrites is exactly what SyncStatusBanner renders, so this covers the
 * "visible sync status" requirement end to end.
 *
 * Note: these run against the emulator with the plain client SDK. The write
 * promise from setDoc() does NOT resolve while the network is disabled — it
 * settles only once the server acknowledges — so it must never be awaited
 * before enableNetwork(). Awaiting it is the classic way to hang this test,
 * and the same trap exists in app code: ListingService.createDraft deliberately
 * does not await its set().
 */

const PROJECT_ID = 'demo-naija-parts-hub';
const HOST = '127.0.0.1';
const DEALER_UID = 'offline-dealer';

process.env.FIRESTORE_EMULATOR_HOST ??= `${HOST}:8080`;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `${HOST}:9099`;

let adminApp;
let app;
let auth;
let db;

/**
 * A payload satisfying validListingPayload() in firestore.rules.
 *
 * The first version of this test wrote unauthenticated with a partial payload
 * and every assertion failed with PERMISSION_DENIED — the rules doing their
 * job. Offline queuing does not bypass rules: the write is applied to the
 * local cache immediately, then rejected on replay, so an under-specified
 * payload here would look like an offline bug rather than a validation error.
 */
const draft = (overrides = {}) => ({
  storeId: DEALER_UID,
  status: 'draft',
  name: 'Offline brake pad',
  description: '',
  categoryId: 'brake',
  condition: 'new',
  priceKobo: 250000,
  quantity: 1,
  brand: '',
  partNumber: '',
  compatibleMake: '',
  compatibleModel: '',
  images: [],
  updatedAt: new Date(),
  ...overrides,
});

before(async () => {
  adminApp = initAdmin({ projectId: PROJECT_ID }, 'offline-admin');
  await getAdminAuth(adminApp).createUser({ uid: DEALER_UID }).catch(() => {});

  app = initializeApp({ projectId: PROJECT_ID, apiKey: 'demo-key' }, 'offline-tests');
  auth = getAuth(app);
  connectAuthEmulator(auth, `http://${HOST}:9099`, { disableWarnings: true });
  db = getFirestore(app);
  connectFirestoreEmulator(db, HOST, 8080);

  const token = await getAdminAuth(adminApp).createCustomToken(DEALER_UID);
  await signInWithCustomToken(auth, token);
});

after(async () => {
  // Restore the network before teardown, or deleteApp hangs on queued writes.
  await enableNetwork(db).catch(() => {});
  await signOut(auth).catch(() => {});
  await deleteApp(app).catch(() => {});
  await deleteAdmin(adminApp).catch(() => {});
});

/** Resolves on the first snapshot satisfying `predicate`, or rejects on timeout. */
function waitForSnapshot(reference, predicate, { timeoutMs = 8000, label = '' } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`timed out waiting for snapshot: ${label}`));
    }, timeoutMs);

    const unsubscribe = onSnapshot(
      reference,
      { includeMetadataChanges: true },
      (snap) => {
        if (predicate(snap)) {
          clearTimeout(timer);
          unsubscribe();
          resolve(snap);
        }
      },
      (err) => {
        clearTimeout(timer);
        unsubscribe();
        reject(err);
      },
    );
  });
}

describe('offline writes', () => {
  it('applies a write locally and flags it as pending while offline', async () => {
    const reference = doc(db, 'listings/offline-1');

    await disableNetwork(db);

    // NOT awaited — see the file header.
    const queued = setDoc(reference, draft());

    const pending = await waitForSnapshot(
      reference,
      (s) => s.exists() && s.metadata.hasPendingWrites,
      { label: 'hasPendingWrites === true' },
    );

    assert.equal(pending.metadata.hasPendingWrites, true);
    assert.equal(pending.data().name, 'Offline brake pad', 'local write must be readable immediately');
    assert.equal(pending.metadata.fromCache, true, 'served from cache while offline');

    await enableNetwork(db);
    await queued; // now resolves — the server has acknowledged

    const settled = await waitForSnapshot(
      reference,
      (s) => s.exists() && !s.metadata.hasPendingWrites,
      { label: 'hasPendingWrites === false' },
    );

    assert.equal(settled.metadata.hasPendingWrites, false, 'flag must clear once acknowledged');
    assert.equal(settled.data().name, 'Offline brake pad');
  });

  it('serves reads from cache while offline', async () => {
    const reference = doc(db, 'listings/offline-2');
    await setDoc(reference, draft({ name: 'Cached part' }));

    // Prime the cache, then cut the network.
    await getDoc(reference);
    await disableNetwork(db);

    const cached = await getDoc(reference);
    assert.equal(cached.exists(), true, 'cached document must still be readable');
    assert.equal(cached.metadata.fromCache, true);
    assert.equal(cached.data().name, 'Cached part');

    await enableNetwork(db);
  });

  it('replays several queued writes in order on reconnect', async () => {
    const reference = doc(db, 'listings/offline-3');
    await setDoc(reference, draft({ name: 'v0' }));

    await disableNetwork(db);

    const a = updateDoc(reference, { name: 'v1' });
    const b = updateDoc(reference, { name: 'v2' });
    const c = updateDoc(reference, { name: 'v3' });

    const pending = await waitForSnapshot(
      reference,
      (s) => s.metadata.hasPendingWrites && s.data()?.name === 'v3',
      { label: 'last local write visible' },
    );
    assert.equal(pending.data().name, 'v3', 'latest local write wins locally');

    await enableNetwork(db);
    await Promise.all([a, b, c]);

    const settled = await waitForSnapshot(
      reference,
      (s) => !s.metadata.hasPendingWrites,
      { label: 'queue drained' },
    );
    assert.equal(settled.data().name, 'v3', 'server state matches the final local write');
  });

  it('reverts a rules-violating write when it is rejected on reconnect', async () => {
    // The counterpart to the happy path, and the more surprising one.
    //
    // Offline queuing does NOT bypass security rules. Firestore applies the
    // write to the local cache immediately — so the dealer sees it succeed —
    // and only submits it to the server on reconnect, where the rules reject
    // it. The local write is then rolled back and the document disappears.
    //
    // To a dealer that looks like "my listing vanished after I got signal",
    // not like a permission error. Any client-side validation gap therefore
    // surfaces as an apparent sync bug, which is why the app validates before
    // writing rather than relying on the rules to catch mistakes.
    const reference = doc(db, 'listings/offline-rejected');

    await disableNetwork(db);

    // status:'active' on create is refused — only publishListing may set it.
    const doomed = setDoc(reference, draft({ status: 'active' }));

    const localApplied = await waitForSnapshot(
      reference,
      (s) => s.exists() && s.metadata.hasPendingWrites,
      { label: 'rejected write still applied locally' },
    );
    assert.equal(localApplied.exists(), true, 'local cache accepts it optimistically');
    assert.equal(localApplied.data().status, 'active');

    await enableNetwork(db);

    await assert.rejects(
      () => doomed,
      (err) => {
        assert.equal(err.code, 'permission-denied');
        return true;
      },
      'the server must reject it on replay',
    );

    // And the optimistic local write must be rolled back.
    const afterRollback = await waitForSnapshot(
      reference,
      (s) => !s.metadata.hasPendingWrites,
      { label: 'rollback settled' },
    );
    assert.equal(afterRollback.exists(), false, 'local write is reverted, not left orphaned');

    const server = await getDoc(reference);
    assert.equal(server.exists(), false, 'nothing was persisted server-side');
  });

  it('keeps a valid queued write when an invalid one alongside it is rejected', async () => {
    // Independent documents must not poison each other: one bad write should
    // not take a legitimate one down with it.
    const good = doc(db, 'listings/offline-good');
    const bad = doc(db, 'listings/offline-bad');

    await disableNetwork(db);

    const goodWrite = setDoc(good, draft({ name: 'Legitimate part' }));
    const badWrite = setDoc(bad, draft({ storeId: 'someone-else' })); // cross-tenant

    await waitForSnapshot(good, (s) => s.exists() && s.metadata.hasPendingWrites, {
      label: 'good queued',
    });

    await enableNetwork(db);

    await assert.rejects(() => badWrite, 'cross-tenant write must be refused');
    await goodWrite; // must still succeed

    const settled = await waitForSnapshot(good, (s) => s.exists() && !s.metadata.hasPendingWrites, {
      label: 'good write acknowledged',
    });
    assert.equal(settled.data().name, 'Legitimate part');

    const rejected = await getDoc(bad);
    assert.equal(rejected.exists(), false);
  });

  it('counts multiple pending documents — what the sync banner shows', async () => {
    await disableNetwork(db);

    const refs = ['offline-a', 'offline-b', 'offline-c'].map((id) => doc(db, `listings/${id}`));
    const queued = refs.map((r, i) =>
      setDoc(r, draft({ name: `Pending ${i}` })),
    );

    const states = await Promise.all(
      refs.map((r) =>
        waitForSnapshot(r, (s) => s.exists() && s.metadata.hasPendingWrites, {
          label: `pending ${r.id}`,
        }),
      ),
    );

    const pendingCount = states.filter((s) => s.metadata.hasPendingWrites).length;
    assert.equal(pendingCount, 3, 'SyncStatusBanner would report 3 changes waiting');

    await enableNetwork(db);
    await Promise.all(queued);

    const cleared = await Promise.all(
      refs.map((r) =>
        waitForSnapshot(r, (s) => !s.metadata.hasPendingWrites, { label: `cleared ${r.id}` }),
      ),
    );
    assert.equal(cleared.every((s) => !s.metadata.hasPendingWrites), true);
  });
});
