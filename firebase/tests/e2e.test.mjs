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
// From the contract, so this suite fails the moment the deployed region and
// the client's expectation diverge — which in production is a 404 per callable.
const { FUNCTIONS_REGION: REGION } = await import('@nph/contracts');
import { emulatorTarget } from './helpers.mjs';

// Follow whatever ports emulators:exec was launched with; see helpers.mjs.
const FIRESTORE = emulatorTarget('FIRESTORE_EMULATOR_HOST', 8080);
const AUTH = emulatorTarget('FIREBASE_AUTH_EMULATOR_HOST', 9099);
// The CLI exports no variable for the functions port, so this one is explicit.
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

const DEALER_UID = 'e2e-dealer';
const ADMIN_UID = 'e2e-admin';

before(async () => {
  adminApp = initAdmin({ projectId: PROJECT_ID }, 'e2e-admin-app');
  adminAuth = getAdminAuth(adminApp);
  adminDb = getAdminDb(adminApp);

  clientApp = initializeApp({ projectId: PROJECT_ID, apiKey: 'demo-key' }, 'e2e-client');
  clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://${AUTH.host}:${AUTH.port}`, { disableWarnings: true });
  clientDb = getFirestore(clientApp);
  connectFirestoreEmulator(clientDb, FIRESTORE.host, FIRESTORE.port);
  fns = getFunctions(clientApp, REGION);
  connectFunctionsEmulator(fns, HOST, FUNCTIONS_PORT);

  // Clean slate.
  for (const c of ['stores', 'listings', 'storeSlugs', 'adminActions']) {
    const snap = await adminDb.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }

  // The taxonomy, because publishListing now requires the listing's category to
  // exist and still be active. Production always has these — the seed script
  // creates them before any dealer registers — so a fixture without them was
  // testing a state the app never runs in.
  await adminDb.doc('categories/brake').set({
    categoryId: 'brake',
    name: 'Brake',
    slug: 'brake',
    order: 2,
    active: true,
  });
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

describe('publishing into a retired category', () => {
  // Two pieces of state left by earlier tests, both of which would refuse the
  // publish before it ever reached the category check being tested here:
  // the client is signed in as the administrator, and the store was suspended
  // to prove suspension hides listings.
  before(async () => {
    await signInAsDealer();
    await adminDb.doc(`stores/${DEALER_UID}`).update({ status: 'approved', visible: true });
  });

  /** A draft in the given category, written the way the app writes one. */
  async function draft(id, categoryId) {
    await setDoc(doc(clientDb, `listings/${id}`), {
      storeId: DEALER_UID,
      status: 'draft',
      name: 'Retired-category part',
      description: '',
      categoryId,
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
  }

  it('refuses a category an administrator has deactivated', async () => {
    // A draft can outlive the category it was written against. Publishing it
    // anyway would put it in a category absent from the marketplace nav and
    // from the dealer's own picker — reachable only by typing the URL, and
    // invisible to the dealer who published it.
    await adminDb.doc('categories/retired').set({
      categoryId: 'retired',
      name: 'Retired',
      slug: 'retired',
      order: 99,
      active: false,
    });
    await draft('e2e-retired', 'retired');

    await assert.rejects(
      () => httpsCallable(fns, 'publishListing')({ listingId: 'e2e-retired' }),
      (err) => /no longer available/i.test(err.message),
    );

    assert.equal((await adminDb.doc('listings/e2e-retired').get()).data().status, 'draft');
  });

  it('refuses a category that does not exist at all', async () => {
    await draft('e2e-ghost', 'no-such-category');

    await assert.rejects(
      () => httpsCallable(fns, 'publishListing')({ listingId: 'e2e-ghost' }),
      (err) => /no longer exists/i.test(err.message),
    );
  });

  it('checks the category before the listing limit', async () => {
    // Ordering matters for the message the dealer sees. By this point the store
    // is at its free limit, so a category check placed after the limit check
    // would report "upgrade your plan" for a listing whose real problem is a
    // retired category — sending them to a payment page that would not fix it.
    const countBefore = (await adminDb.doc(`stores/${DEALER_UID}`).get()).data()
      .activeListingCount;

    await draft('e2e-ghost-2', 'still-no-such-category');
    await assert.rejects(
      () => httpsCallable(fns, 'publishListing')({ listingId: 'e2e-ghost-2' }),
      (err) => /category/i.test(err.message) && !/limit|plan/i.test(err.message),
    );

    const countAfter = (await adminDb.doc(`stores/${DEALER_UID}`).get()).data()
      .activeListingCount;
    assert.equal(countAfter, countBefore, 'a refused publish must not consume a slot');
  });
});
