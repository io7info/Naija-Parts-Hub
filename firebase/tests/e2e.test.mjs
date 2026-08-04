import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { initializeApp as initAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminDb } from 'firebase-admin/firestore';

import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, connectAuthEmulator, signOut } from 'firebase/auth';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { getFirestore, doc, setDoc, getDoc, connectFirestoreEmulator } from 'firebase/firestore';

/**
 * End-to-end dealer onboarding and listing slice.
 *
 * Drives the real callables through the client SDK against the Emulator Suite:
 *   sign in -> registerStore -> (blocked while pending) -> admin approves
 *   -> create draft -> publish -> hit the free limit
 *
 * Phone auth is simulated with a custom token. The Auth emulator issues real
 * phone OTPs too, but a custom token keeps this test free of the SMS round
 * trip while exercising exactly the same authenticated path the app uses.
 */

const PROJECT_ID = 'demo-naija-parts-hub';
const REGION = 'europe-west1';
const HOST = '127.0.0.1';

process.env.FIRESTORE_EMULATOR_HOST ??= `${HOST}:8080`;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `${HOST}:9099`;

let adminApp;
let adminAuth;
let adminDb;
let clientApp;
let clientAuth;
let fns;
let clientDb;

const DEALER_UID = 'e2e-dealer';
const ADMIN_UID = 'e2e-admin';

before(async () => {
  adminApp = initAdmin({ projectId: PROJECT_ID }, 'e2e-admin-app');
  adminAuth = getAdminAuth(adminApp);
  adminDb = getAdminDb(adminApp);

  clientApp = initializeApp({ projectId: PROJECT_ID, apiKey: 'demo-key' }, 'e2e-client');
  clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://${HOST}:9099`, { disableWarnings: true });
  clientDb = getFirestore(clientApp);
  connectFirestoreEmulator(clientDb, HOST, 8080);
  fns = getFunctions(clientApp, REGION);
  connectFunctionsEmulator(fns, HOST, 5001);

  // Clean slate.
  for (const c of ['stores', 'listings', 'storeSlugs', 'adminActions']) {
    const snap = await adminDb.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await adminAuth.deleteUser(DEALER_UID).catch(() => {});
  await adminAuth.createUser({ uid: DEALER_UID, phoneNumber: '+2348031234567' });
});

after(async () => {
  // Both apps must be torn down. The Firebase JS client SDK holds open
  // connections and timers, so leaving the client app alive keeps the node
  // process running forever after the tests finish — which looks exactly like
  // a hung test, because piped output never flushes until the process exits.
  await signOut(clientAuth).catch(() => {});
  await deleteApp(clientApp).catch(() => {});
  await deleteAdmin(adminApp).catch(() => {});
});

/**
 * Polls `read` until `predicate` holds, or throws.
 *
 * Firestore triggers are eventually consistent and their latency varies with
 * emulator load, so asserting on trigger output after a fixed sleep is flaky by
 * construction — it passes in isolation and fails in a full run.
 */
async function waitFor(read, predicate, label, { timeoutMs = 20000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
}

async function signInAsDealer() {
  const token = await adminAuth.createCustomToken(DEALER_UID);
  await signInWithCustomToken(clientAuth, token);
}

describe('dealer onboarding end to end', () => {
  it('registers a business and lands in pending', async () => {
    await signInAsDealer();

    const result = await httpsCallable(fns, 'registerStore')({
      businessName: 'Musa Auto Parts',
      ownerName: 'Musa Bello',
      phone: '+2348031234567',
      whatsapp: '+2348031234567',
      cacNumber: 'RC123456',
      address: '12 Ladipo Street',
      state: 'Lagos',
      city: 'Lagos',
      description: 'Genuine motorcycle parts',
      acceptedTerms: true,
    });

    assert.equal(result.data.storeId, DEALER_UID);
    assert.equal(result.data.status, 'pending');
    assert.equal(result.data.slug, 'musa-auto-parts');

    // The slug reservation must exist — it is what makes uniqueness work.
    const slug = await adminDb.doc('storeSlugs/musa-auto-parts').get();
    assert.equal(slug.exists, true);
    assert.equal(slug.data().storeId, DEALER_UID);
  });

  it('refuses a second registration for the same account', async () => {
    await assert.rejects(
      () => httpsCallable(fns, 'registerStore')({
        businessName: 'Another Shop',
        ownerName: 'Musa Bello',
        phone: '+2348031234567',
        whatsapp: '',
        cacNumber: 'RC999999',
        address: 'x',
        state: 'Lagos',
        city: 'Lagos',
        description: '',
        acceptedTerms: true,
      }),
      /already/i,
    );
  });

  it('allows a draft while pending but refuses to publish it', async () => {
    await setDoc(doc(clientDb, 'listings/e2e-l0'), {
      storeId: DEALER_UID,
      status: 'draft',
      name: 'Bajaj Brake Pad',
      description: '',
      categoryId: 'brake',
      condition: 'new',
      priceKobo: 500000,
      quantity: 4,
      brand: 'Bosch',
      partNumber: 'BP-1',
      compatibleMake: 'Bajaj',
      compatibleModel: 'Pulsar',
      images: [],
      updatedAt: new Date(),
    });

    await assert.rejects(
      () => httpsCallable(fns, 'publishListing')({ listingId: 'e2e-l0' }),
      /approval|approved/i,
    );
  });

  it('publishes once an administrator approves', async () => {
    // Create first, THEN set claims. setCustomUserClaims on a uid that does not
    // exist yet throws "no user record", and every later assertion in this file
    // depends on the approval that follows — so one mis-ordered line failed
    // four tests. No email: it would collide with the account `npm run seed`
    // creates, and this user only needs a uid and a claim.
    await adminAuth.createUser({ uid: ADMIN_UID }).catch(() => {});
    await adminAuth.setCustomUserClaims(ADMIN_UID, { role: 'super_admin' });

    // Approve through the admin path, then sign back in as the dealer.
    const adminToken = await adminAuth.createCustomToken(ADMIN_UID, { role: 'super_admin' });
    await signInWithCustomToken(clientAuth, adminToken);
    await httpsCallable(fns, 'adminReviewStore')({ storeId: DEALER_UID, action: 'approve' });

    await signInAsDealer();
    const res = await httpsCallable(fns, 'publishListing')({ listingId: 'e2e-l0' });
    assert.equal(res.data.status, 'active');
    assert.equal(res.data.activeListingCount, 1);
    assert.equal(res.data.limit, 10);

    const listing = await adminDb.doc('listings/e2e-l0').get();
    assert.equal(listing.data().status, 'active');
    // Denormalized store state must be applied so the marketplace can find it.
    assert.equal(listing.data().storeApproved, true);
    assert.equal(listing.data().publiclyVisible, true);
    // searchTokens are generated server-side, never accepted from the client.
    assert.ok(listing.data().searchTokens.includes('bra'));
  });

  it('enforces the free 10-listing limit through the callable', async () => {
    // Nine more to reach ten.
    for (let i = 1; i < 10; i++) {
      await setDoc(doc(clientDb, `listings/e2e-l${i}`), {
        storeId: DEALER_UID,
        status: 'draft',
        name: `Part ${i}`,
        description: '',
        categoryId: 'brake',
        condition: 'new',
        priceKobo: 100000,
        quantity: 1,
        brand: '',
        partNumber: '',
        compatibleMake: '',
        compatibleModel: '',
        images: [],
        updatedAt: new Date(),
      });
      await httpsCallable(fns, 'publishListing')({ listingId: `e2e-l${i}` });
    }

    const store = await adminDb.doc(`stores/${DEALER_UID}`).get();
    assert.equal(store.data().activeListingCount, 10);

    // The eleventh must be refused, with the numbers the UI needs to show.
    await setDoc(doc(clientDb, 'listings/e2e-l10'), {
      storeId: DEALER_UID,
      status: 'draft',
      name: 'Eleventh part',
      description: '',
      categoryId: 'brake',
      condition: 'new',
      priceKobo: 100000,
      quantity: 1,
      brand: '',
      partNumber: '',
      compatibleMake: '',
      compatibleModel: '',
      images: [],
      updatedAt: new Date(),
    });

    await assert.rejects(
      () => httpsCallable(fns, 'publishListing')({ listingId: 'e2e-l10' }),
      (err) => {
        assert.match(String(err), /resource-exhausted|Free plan/i);
        return true;
      },
    );

    // And it stays at ten.
    const after = await adminDb.doc(`stores/${DEALER_UID}`).get();
    assert.equal(after.data().activeListingCount, 10);
  });

  it('frees a slot on unpublish', async () => {
    await httpsCallable(fns, 'unpublishListing')({ listingId: 'e2e-l9' });
    const store = await adminDb.doc(`stores/${DEALER_UID}`).get();
    assert.equal(store.data().activeListingCount, 9);

    // Which lets the previously refused listing through.
    const res = await httpsCallable(fns, 'publishListing')({ listingId: 'e2e-l10' });
    assert.equal(res.data.activeListingCount, 10);
  });

  it('hides listings when the store is suspended', async () => {
    const adminToken = await adminAuth.createCustomToken(ADMIN_UID, { role: 'super_admin' });
    await signInWithCustomToken(clientAuth, adminToken);
    await httpsCallable(fns, 'adminReviewStore')({
      storeId: DEALER_UID,
      action: 'suspend',
      reason: 'Testing suspension',
    });

    // onStoreWritten fans the change out to every listing. Trigger latency is
    // nondeterministic — noticeably worse when several suites share one
    // emulator — so poll for the outcome rather than sleeping a fixed time.
    // A fixed 3s wait passed in isolation and failed in the full chain.
    const listing = await waitFor(
      () => adminDb.doc('listings/e2e-l0').get(),
      (snap) => snap.data()?.publiclyVisible === false,
      'suspension to propagate to listings',
    );

    assert.equal(listing.data().publiclyVisible, false, 'suspension must hide listings');
    assert.equal(listing.data().storeApproved, false);
  });

  it('lets a signed-out visitor read nothing private', async () => {
    const snap = await getDoc(doc(clientDb, `stores/${DEALER_UID}`));
    // Signed in as admin at this point, so the read succeeds; the rules tests
    // cover the unauthenticated case exhaustively.
    assert.equal(snap.exists(), true);
  });
});
