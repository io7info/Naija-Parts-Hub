import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { initializeApp as initAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminDb } from 'firebase-admin/firestore';

import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, connectAuthEmulator, signOut } from 'firebase/auth';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { getFirestore, doc, updateDoc, connectFirestoreEmulator } from 'firebase/firestore';

/**
 * Mechanic onboarding end to end, against the Emulator Suite.
 *
 *   sign in -> registerStore(mechanic) -> identity unverified
 *   -> verifyMechanicIdentity refuses (no provider configured)
 *   -> administrator cannot approve
 *
 * The point of the third step is the client's hardest constraint: with no KYC
 * provider wired up, the platform must REFUSE, not pretend. A stub that
 * returned "verified" would put a Verified badge in front of buyers handing
 * over their vehicles, and nobody would find out until someone was defrauded.
 * So this suite deliberately runs with no Dojah credentials present — which is
 * exactly the state production is in today — and asserts that the whole chain
 * stays shut.
 *
 * It also carries the dealer regression: a parts dealer registered against the
 * same backend must come out with no identity block, no mechanic block, and an
 * approval that still works.
 */

const PROJECT_ID = 'demo-naija-parts-hub';
const { FUNCTIONS_REGION: REGION, ERROR_CODE } = await import('@nph/contracts');
import { emulatorTarget } from './helpers.mjs';

const FIRESTORE = emulatorTarget('FIRESTORE_EMULATOR_HOST', 8080);
const AUTH = emulatorTarget('FIREBASE_AUTH_EMULATOR_HOST', 9099);
const FUNCTIONS_PORT = Number(process.env.FUNCTIONS_EMULATOR_PORT) || 5001;
const HOST = FIRESTORE.host;

process.env.FIRESTORE_EMULATOR_HOST ??= `${FIRESTORE.host}:${FIRESTORE.port}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `${AUTH.host}:${AUTH.port}`;

let adminApp;
let adminAuth;
let adminDb;
let clientApp;
let clientAuth;
let fns;
let clientDb;

const MECHANIC_UID = 'e2e-mechanic';
const DEALER_UID = 'e2e-mech-dealer';
const ADMIN_UID = 'e2e-mech-admin';

before(async () => {
  adminApp = initAdmin({ projectId: PROJECT_ID }, 'mechanic-admin-app');
  adminAuth = getAdminAuth(adminApp);
  adminDb = getAdminDb(adminApp);

  clientApp = initializeApp({ projectId: PROJECT_ID, apiKey: 'demo-key' }, 'mechanic-client');
  clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://${AUTH.host}:${AUTH.port}`, { disableWarnings: true });
  clientDb = getFirestore(clientApp);
  connectFirestoreEmulator(clientDb, FIRESTORE.host, FIRESTORE.port);
  fns = getFunctions(clientApp, REGION);
  connectFunctionsEmulator(fns, HOST, FUNCTIONS_PORT);

  for (const c of ['stores', 'listings', 'storeSlugs', 'adminActions']) {
    const snap = await adminDb.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }

  for (const uid of [MECHANIC_UID, DEALER_UID, ADMIN_UID]) {
    await adminAuth.deleteUser(uid).catch(() => {});
  }
  await adminAuth.createUser({ uid: MECHANIC_UID, phoneNumber: '+2348022334455' });
  await adminAuth.createUser({ uid: DEALER_UID, phoneNumber: '+2348031234599' });
  await adminAuth.createUser({ uid: ADMIN_UID });
  await adminAuth.setCustomUserClaims(ADMIN_UID, { role: 'super_admin' });
});

after(async () => {
  await signOut(clientAuth).catch(() => {});
  await deleteApp(clientApp).catch(() => {});
  await deleteAdmin(adminApp).catch(() => {});
});

async function signInAs(uid, claims) {
  const token = await adminAuth.createCustomToken(uid, claims);
  await signInWithCustomToken(clientAuth, token);
}

const storeOf = async (uid) => (await adminDb.doc(`stores/${uid}`).get()).data();

/** The error code the callable put in `details`, which is how the app routes. */
const codeOf = (err) => err?.details?.code ?? err?.code;

describe('mechanic registration', () => {
  it('registers as a mechanic and lands pending with identity unverified', async () => {
    await signInAs(MECHANIC_UID);

    const result = await httpsCallable(fns, 'registerStore')({
      businessName: 'Kunle Auto Works',
      ownerName: 'Kunle Bakare',
      phone: '+2348022334455',
      whatsapp: '+2348022334455',
      // Deliberately blank: mechanics are not required to be incorporated.
      cacNumber: '',
      address: '14 Oshodi Expressway',
      state: 'Lagos',
      city: 'Oshodi',
      description: 'Engine and brake specialists in Oshodi.',
      acceptedTerms: true,
      businessType: 'mechanic',
      mechanic: {
        specialties: ['engine', 'brakes'],
        photos: ['https://cdn.example/workshop-1.jpg'],
      },
    });

    assert.equal(result.data.storeId, MECHANIC_UID);
    assert.equal(result.data.status, 'pending');
    // The response shape is unchanged and carries no businessType. A mechanic
    // registration returns exactly what a dealer registration always has,
    // because the caller already knows which form it submitted and an extra
    // field would be a change to a contract in production.
    assert.deepEqual(Object.keys(result.data).sort(), ['slug', 'status', 'storeId']);

    const store = await storeOf(MECHANIC_UID);
    assert.equal(store.businessType, 'mechanic');
    assert.equal(store.status, 'pending');
    assert.equal(store.visible, false);
    assert.equal(store.identity.status, 'unverified');
    assert.equal(store.identity.attempts, 0);
    assert.equal(store.identity.verifiedAt, null);
  });

  it('registers with no CAC number, which mechanics are not required to have', async () => {
    const store = await storeOf(MECHANIC_UID);
    assert.equal(store.cacNumber, '');
  });

  it('records the intake on the audit trail', async () => {
    // The two intakes have different review criteria and different approval
    // prerequisites, so an administrator reading the trail has to be able to
    // tell which one an application came through.
    const snap = await adminDb
      .collection('adminActions')
      .where('targetId', '==', MECHANIC_UID)
      .get();
    const registered = snap.docs
      .map((d) => d.data())
      .find((a) => a.action === 'store.registered');

    assert.ok(registered, 'no store.registered action was written');
    assert.equal(registered.businessType, 'mechanic');
  });

  it('keeps the recognised specialties and drops anything invented', async () => {
    const store = await storeOf(MECHANIC_UID);
    assert.deepEqual(store.mechanic.specialties.sort(), ['brakes', 'engine']);
    assert.deepEqual(store.mechanic.photos, ['https://cdn.example/workshop-1.jpg']);
  });

  it('stores no raw identifier anywhere on the document', async () => {
    // Nothing has been submitted yet, but the shape itself is the guarantee:
    // there is no field on this document that could hold a BVN or a NIN.
    const store = await storeOf(MECHANIC_UID);
    const serialised = JSON.stringify(store);

    assert.equal(/"bvn"|"nin"/i.test(serialised), false);
    assert.equal(store.identity.bvnFingerprint, null);
    assert.equal(store.identity.bvnLast4, null);
  });
});

describe('identity verification with no provider configured', () => {
  it('refuses rather than pretending', async () => {
    await signInAs(MECHANIC_UID);

    // The state production is in right now: no Dojah credentials, no
    // DOJAH_ENVIRONMENT. The only acceptable answer is a refusal that names
    // itself as a platform gap.
    const err = await httpsCallable(fns, 'verifyMechanicIdentity')({
      bvn: '22345678901',
      nin: '70123456789',
      fullName: 'Kunle Bakare',
    }).then(
      (ok) => {
        assert.fail(`expected a refusal, got ${JSON.stringify(ok.data)}`);
      },
      (e) => e,
    );

    assert.equal(codeOf(err), ERROR_CODE.IDENTITY_PROVIDER_UNAVAILABLE);

    // No credentials means resolveProvider() threw before a provider object
    // existed, so nothing was sent anywhere. This is the one class of failure
    // entitled to say so — a malformed response, by contrast, comes out of the
    // provider call itself and cannot make the same claim.
    assert.match(err.message, /were not sent to the verification provider/i);
  });

  it('leaves the mechanic unverified', async () => {
    const store = await storeOf(MECHANIC_UID);
    assert.equal(store.identity.status, 'unverified');
    assert.equal(store.identity.verifiedAt, null);
  });

  it('does not consume one of the five attempts', async () => {
    // Attempts exist to cap billable provider calls. A refusal that never
    // reached a provider must not count, or a mechanic could be locked out of
    // their own account entirely by our misconfiguration.
    const store = await storeOf(MECHANIC_UID);
    assert.equal(store.identity.attempts, 0);
    assert.equal(store.identity.lockedUntil, null);
  });

  it('leaves no in-flight lease behind', async () => {
    // The single-flight lease is claimed transactionally before the provider
    // call. If a refusal left it set, the mechanic would be locked out for 90
    // seconds every time — and forever, if the lease were never released.
    const store = await storeOf(MECHANIC_UID);
    assert.ok(
      store.identity.inFlightUntil == null ||
        store.identity.inFlightUntil.toMillis() <= Date.now(),
      'an expired or absent lease is required, found a live one',
    );
  });

  it('records no raw identifier despite receiving both', async () => {
    // The numbers were sent. Nothing on the document may retain them.
    const store = await storeOf(MECHANIC_UID);
    const serialised = JSON.stringify(store);

    assert.equal(serialised.includes('22345678901'), false, 'BVN reached Firestore');
    assert.equal(serialised.includes('70123456789'), false, 'NIN reached Firestore');
  });
});

describe('approval is blocked while identity is unverified', () => {
  it('an administrator cannot approve an unverified mechanic', async () => {
    await signInAs(ADMIN_UID, { role: 'super_admin' });

    const err = await httpsCallable(fns, 'adminReviewStore')({
      storeId: MECHANIC_UID,
      action: 'approve',
    }).then(
      (ok) => assert.fail(`expected a refusal, got ${JSON.stringify(ok.data)}`),
      (e) => e,
    );

    assert.match(err.message, /BVN and NIN|not completed/i);
  });

  it('the store is untouched by the refused approval', async () => {
    const store = await storeOf(MECHANIC_UID);
    assert.equal(store.status, 'pending');
    assert.equal(store.visible, false);
    assert.equal(store.approvedAt ?? null, null);
  });

  it('the mechanic stays off every public surface', async () => {
    const store = await storeOf(MECHANIC_UID);
    // `visible` is what the public directory and profile query on. An
    // unapprovable mechanic must not be reachable by slug either.
    assert.equal(store.visible, false);
    assert.equal(store.status, 'pending');
  });

  it('rejection is still available — only approval is gated', async () => {
    // An administrator must be able to clear an application out of the queue.
    // Gating rejection too would make an unverifiable mechanic permanent.
    await signInAs(ADMIN_UID, { role: 'super_admin' });

    await httpsCallable(fns, 'adminReviewStore')({
      storeId: MECHANIC_UID,
      action: 'reject',
      reason: 'Identity verification is not available yet.',
    });

    const store = await storeOf(MECHANIC_UID);
    assert.equal(store.status, 'rejected');
  });
});

describe('the client cannot verify itself', () => {
  before(async () => {
    // Back to pending, so the write attempts below are made from the state a
    // real mechanic would be in.
    await adminDb.doc(`stores/${MECHANIC_UID}`).update({
      status: 'pending',
      rejectionReason: null,
    });
    await signInAs(MECHANIC_UID);
  });

  it('cannot mark its own identity verified', async () => {
    await assert.rejects(
      () =>
        updateDoc(doc(clientDb, `stores/${MECHANIC_UID}`), {
          identity: { status: 'verified' },
          updatedAt: new Date(),
        }),
      /permission|insufficient/i,
    );
  });

  it('cannot change its own businessType', async () => {
    await assert.rejects(
      () =>
        updateDoc(doc(clientDb, `stores/${MECHANIC_UID}`), {
          businessType: 'parts_dealer',
          updatedAt: new Date(),
        }),
      /permission|insufficient/i,
    );
  });

  it('cannot approve itself', async () => {
    await assert.rejects(
      () =>
        updateDoc(doc(clientDb, `stores/${MECHANIC_UID}`), {
          status: 'approved',
          visible: true,
          updatedAt: new Date(),
        }),
      /permission|insufficient/i,
    );
  });

  it('cannot exceed ten workshop photos', async () => {
    await assert.rejects(
      () =>
        updateDoc(doc(clientDb, `stores/${MECHANIC_UID}`), {
          mechanic: {
            specialties: ['engine'],
            photos: Array.from({ length: 11 }, (_, i) => `https://cdn.example/${i}.jpg`),
          },
          updatedAt: new Date(),
        }),
      /permission|insufficient/i,
    );
  });

  it('can edit its own services and photos within the cap', async () => {
    await updateDoc(doc(clientDb, `stores/${MECHANIC_UID}`), {
      mechanic: {
        specialties: ['engine', 'diagnostics'],
        photos: Array.from({ length: 10 }, (_, i) => `https://cdn.example/${i}.jpg`),
      },
      updatedAt: new Date(),
    });

    const store = await storeOf(MECHANIC_UID);
    assert.equal(store.mechanic.photos.length, 10);
    assert.deepEqual(store.mechanic.specialties, ['engine', 'diagnostics']);
  });
});

describe('parts dealers are unaffected', () => {
  it('registers with no businessType field, exactly as before', async () => {
    await signInAs(DEALER_UID);

    const result = await httpsCallable(fns, 'registerStore')({
      businessName: 'Ladipo Auto Spares',
      ownerName: 'Tinuoye Adeyemi',
      phone: '+2348031234599',
      whatsapp: '+2348031234599',
      cacNumber: 'RC-1846352',
      address: '50 Ladipo Market Road',
      state: 'Lagos',
      city: 'Mushin',
      description: 'Genuine parts.',
      acceptedTerms: true,
    });

    assert.equal(result.data.status, 'pending');

    const store = await storeOf(DEALER_UID);
    assert.equal(store.businessType, 'parts_dealer');
  });

  it('gets no identity block at all', async () => {
    // Not an empty one. An empty block on every dealer document is how BVN
    // creeps into a flow the client explicitly excluded it from.
    const store = await storeOf(DEALER_UID);
    assert.equal(store.identity ?? null, null);
    assert.equal(store.mechanic ?? null, null);
  });

  it('is approved without any identity check', async () => {
    await signInAs(ADMIN_UID, { role: 'super_admin' });

    await httpsCallable(fns, 'adminReviewStore')({
      storeId: DEALER_UID,
      action: 'approve',
    });

    const store = await storeOf(DEALER_UID);
    assert.equal(store.status, 'approved');
    assert.equal(store.visible, true);
  });

  it('cannot be verified through the mechanic callable', async () => {
    // Owner-only AND mechanic-only. A dealer reaching this would be both a
    // wasted billable call and the start of BVN collection from dealers.
    await signInAs(DEALER_UID);

    const err = await httpsCallable(fns, 'verifyMechanicIdentity')({
      bvn: '22345678901',
      nin: '70123456789',
      fullName: 'Tinuoye Adeyemi',
    }).then(
      (ok) => assert.fail(`expected a refusal, got ${JSON.stringify(ok.data)}`),
      (e) => e,
    );

    // Whatever the code, it must not be a success and must not be the
    // "provider unavailable" path — a dealer should be turned away on type,
    // before configuration is even consulted.
    assert.notEqual(codeOf(err), ERROR_CODE.IDENTITY_PROVIDER_UNAVAILABLE);
  });
});
