import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { initializeApp as initAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminDb, Timestamp } from 'firebase-admin/firestore';

import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, connectAuthEmulator, signOut } from 'firebase/auth';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';

import { emulatorTarget } from './helpers.mjs';

/**
 * adminManageCategory — SOW §9, "basic category management".
 *
 * Driven through the real callable from the client SDK, because the properties
 * worth proving are the ones a direct Firestore write would bypass: that a
 * dealer cannot reach it at all, and that deactivating a category is refused
 * while published listings depend on it.
 *
 * That refusal is the reason this is a callable rather than an admin-only rule.
 * The rules already permit an administrator to write `categories/{id}` freely —
 * so permission was never the problem. Counting the listings first is, and a
 * count performed in the browser is a courtesy, not a guarantee.
 */

const PROJECT_ID = 'demo-naija-parts-hub';
const FIRESTORE = emulatorTarget('FIRESTORE_EMULATOR_HOST', 8080);
const AUTH = emulatorTarget('FIREBASE_AUTH_EMULATOR_HOST', 9099);
const FUNCTIONS_PORT = Number(process.env.FUNCTIONS_EMULATOR_PORT) || 5001;

process.env.FIRESTORE_EMULATOR_HOST ??= `${FIRESTORE.host}:${FIRESTORE.port}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `${AUTH.host}:${AUTH.port}`;

const ADMIN_UID = 'cat-admin';
const DEALER_UID = 'cat-dealer';

let adminApp;
let adminAuth;
let db;
let clientApp;
let clientAuth;
let fns;
let REGION;

async function callAs(uid, payload) {
  const token = await adminAuth.createCustomToken(uid);
  await signInWithCustomToken(clientAuth, token);
  return httpsCallable(fns, 'adminManageCategory')(payload);
}

/** The HttpsError code, e.g. 'permission-denied'. */
function errorCode(err) {
  return err?.code?.replace(/^functions\//, '') ?? String(err);
}

before(async () => {
  ({ FUNCTIONS_REGION: REGION } = await import('@nph/contracts'));

  adminApp = initAdmin({ projectId: PROJECT_ID }, 'cat-admin-app');
  adminAuth = getAdminAuth(adminApp);
  db = getAdminDb(adminApp);

  clientApp = initializeApp({ projectId: PROJECT_ID, apiKey: 'demo-key' }, 'cat-client');
  clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://${AUTH.host}:${AUTH.port}`, { disableWarnings: true });
  fns = getFunctions(clientApp, REGION);
  connectFunctionsEmulator(fns, FIRESTORE.host, FUNCTIONS_PORT);

  for (const uid of [ADMIN_UID, DEALER_UID]) {
    await adminAuth.deleteUser(uid).catch(() => {});
  }
  await adminAuth.createUser({ uid: ADMIN_UID });
  await adminAuth.setCustomUserClaims(ADMIN_UID, { role: 'super_admin' });
  await adminAuth.createUser({ uid: DEALER_UID, phoneNumber: '+2348031234567' });
});

after(async () => {
  await signOut(clientAuth).catch(() => {});
  await deleteApp(clientApp).catch(() => {});
  await deleteAdmin(adminApp).catch(() => {});
});

beforeEach(async () => {
  for (const c of ['categories', 'listings', 'adminActions']) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await db.doc('categories/brake').set({
    categoryId: 'brake',
    name: 'Brake',
    slug: 'brake',
    order: 2,
    active: true,
  });
});

/** A listing in the given category and status, written past the rules. */
async function seedListing(id, categoryId, status) {
  await db.doc(`listings/${id}`).set({
    storeId: 'some-dealer',
    name: 'Brake pad',
    categoryId,
    condition: 'new',
    priceKobo: 100000,
    quantity: 1,
    status,
    publiclyVisible: status === 'active',
    createdAt: Timestamp.now(),
  });
}

describe('authorisation', () => {
  it('a dealer cannot manage the taxonomy', async () => {
    // The single most important assertion here. A dealer who could add or
    // rename categories controls how every buyer browses the marketplace.
    await assert.rejects(
      () => callAs(DEALER_UID, { action: 'create', categoryId: 'x', name: 'X' }),
      (err) => errorCode(err) === 'permission-denied',
    );
  });

  it('an unauthenticated caller cannot either', async () => {
    await signOut(clientAuth);
    await assert.rejects(
      () => httpsCallable(fns, 'adminManageCategory')({ action: 'create', categoryId: 'x', name: 'X' }),
      (err) => ['unauthenticated', 'permission-denied'].includes(errorCode(err)),
    );
  });
});

describe('create', () => {
  it('adds a category dealers can immediately file parts under', async () => {
    await callAs(ADMIN_UID, { action: 'create', categoryId: 'cooling', name: 'Cooling', order: 9 });

    const doc = await db.doc('categories/cooling').get();
    assert.equal(doc.data().name, 'Cooling');
    assert.equal(doc.data().slug, 'cooling');
    assert.equal(doc.data().order, 9);
    // Active on creation: an administrator adding a category means to offer it.
    assert.equal(doc.data().active, true);
  });

  it('refuses an id that already exists', async () => {
    // Silently overwriting would let a mistyped id rename a live category.
    await assert.rejects(
      () => callAs(ADMIN_UID, { action: 'create', categoryId: 'brake', name: 'Brakes' }),
      (err) => errorCode(err) === 'already-exists',
    );

    const doc = await db.doc('categories/brake').get();
    assert.equal(doc.data().name, 'Brake', 'the existing category is untouched');
  });

  for (const bad of ['Brake', 'brake pads', 'brake_pads', 'brake--pads', '-brake', '']) {
    it(`rejects the id ${JSON.stringify(bad)}`, async () => {
      // Ids end up in URLs (/parts?category=…) and on every listing, so they
      // are slugs. Validated server-side because the browser check is only a
      // courtesy.
      await assert.rejects(
        () => callAs(ADMIN_UID, { action: 'create', categoryId: bad, name: 'X' }),
        (err) => errorCode(err) === 'invalid-argument',
      );
    });
  }
});

describe('update', () => {
  it('renames without touching the id', async () => {
    await seedListing('l1', 'brake', 'active');
    await callAs(ADMIN_UID, { action: 'update', categoryId: 'brake', name: 'Brakes & Pads' });

    const doc = await db.doc('categories/brake').get();
    assert.equal(doc.data().name, 'Brakes & Pads');
    assert.equal(doc.id, 'brake');

    // The listing still resolves: the id it carries is unchanged, which is the
    // whole reason renaming is allowed and re-iding is not.
    const listing = await db.doc('listings/l1').get();
    assert.equal(listing.data().categoryId, 'brake');
  });

  it('reorders', async () => {
    await callAs(ADMIN_UID, { action: 'update', categoryId: 'brake', order: 1 });
    assert.equal((await db.doc('categories/brake').get()).data().order, 1);
  });

  it('refuses a category that does not exist', async () => {
    await assert.rejects(
      () => callAs(ADMIN_UID, { action: 'update', categoryId: 'nope', name: 'No' }),
      (err) => errorCode(err) === 'not-found',
    );
  });
});

describe('deactivation is guarded by usage', () => {
  it('refuses while published listings depend on it', async () => {
    await seedListing('l1', 'brake', 'active');

    // Deactivating here would leave that listing carrying a category absent
    // from every nav — reachable only by typing the URL, and invisible to the
    // dealer who published it.
    await assert.rejects(
      () => callAs(ADMIN_UID, { action: 'setActive', categoryId: 'brake', active: false }),
      (err) => errorCode(err) === 'failed-precondition',
    );

    assert.equal((await db.doc('categories/brake').get()).data().active, true);
  });

  it('allows it when only drafts remain', async () => {
    // A draft is not on the marketplace, and its dealer still has to choose a
    // category before publishing — so nothing public breaks.
    await seedListing('l1', 'brake', 'draft');
    await callAs(ADMIN_UID, { action: 'setActive', categoryId: 'brake', active: false });

    assert.equal((await db.doc('categories/brake').get()).data().active, false);
  });

  it('allows it when nothing uses it', async () => {
    await callAs(ADMIN_UID, { action: 'setActive', categoryId: 'brake', active: false });
    assert.equal((await db.doc('categories/brake').get()).data().active, false);
  });

  it('reactivating is never blocked', async () => {
    await seedListing('l1', 'brake', 'draft');
    await callAs(ADMIN_UID, { action: 'setActive', categoryId: 'brake', active: false });
    await seedListing('l2', 'brake', 'active');

    // The usage check applies to hiding, not showing: a category with live
    // listings is exactly the one that most needs to come back.
    await callAs(ADMIN_UID, { action: 'setActive', categoryId: 'brake', active: true });
    assert.equal((await db.doc('categories/brake').get()).data().active, true);
  });

  it('never deletes the document', async () => {
    await callAs(ADMIN_UID, { action: 'setActive', categoryId: 'brake', active: false });

    // Deactivation has to be reversible, which means the document survives.
    // Deleting it would strip the display name that listings depend on.
    const doc = await db.doc('categories/brake').get();
    assert.ok(doc.exists);
    assert.equal(doc.data().name, 'Brake');
  });
});

describe('audit trail', () => {
  it('records who changed the taxonomy', async () => {
    await callAs(ADMIN_UID, { action: 'create', categoryId: 'cooling', name: 'Cooling' });

    const actions = await db.collection('adminActions').get();
    const entry = actions.docs.map((d) => d.data()).find((a) => a.targetId === 'cooling');

    assert.ok(entry, 'a category change must leave a record');
    assert.equal(entry.action, 'category.create');
    assert.equal(entry.adminId, ADMIN_UID);
  });

  it('records a refused change as no change at all', async () => {
    await seedListing('l1', 'brake', 'active');
    await assert.rejects(() =>
      callAs(ADMIN_UID, { action: 'setActive', categoryId: 'brake', active: false }),
    );

    const actions = await db.collection('adminActions').get();
    assert.equal(actions.size, 0, 'a rejected action must not be logged as one');
  });
});
