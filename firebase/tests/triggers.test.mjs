import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

/**
 * onListingWritten — the backend fields nobody may forge.
 *
 * The security rules deny a dealer sending these at create time; this suite
 * asserts the second line of defence, that the trigger derives them from
 * trusted data even when a forged value somehow reaches the document. Both
 * layers matter: rules stop the write, the trigger stops a write that arrived
 * some other way — a mis-scoped Admin SDK script, a future rule regression, or
 * a period where the rules were older than the code.
 *
 * Written entirely through the Admin SDK, which bypasses rules. That is
 * deliberate: forging these fields through a client is impossible by design, so
 * the only way to test the trigger's own behaviour is to plant the forged
 * document directly. What a *client* can do is asserted in rules.test.mjs.
 *
 * Needs the functions emulator, so it runs as its own emulator instance for the
 * same reason every other suite does — see the note in package.json.
 */

const PROJECT_ID = 'demo-naija-parts-hub';
const HOST = process.env.EMULATOR_HOST ?? '127.0.0.1';
const FIRESTORE_PORT = process.env.FIRESTORE_EMULATOR_PORT ?? '8080';

process.env.FIRESTORE_EMULATOR_HOST ??= `${HOST}:${FIRESTORE_PORT}`;

let app;
let db;

const STORE_ID = 'trig-dealer';
const LISTING = 'listings/trig-l1';

/** An approved, visible store — the case where a published listing goes public. */
function approvedStore(overrides = {}) {
  return {
    storeId: STORE_ID,
    businessName: 'Ladipo Auto Spares',
    ownerName: 'Tinuoye Adeyemi',
    phone: '+2349053114741',
    whatsapp: '+2349053114741',
    cacNumber: 'RC-1846352',
    address: '50 Ladipo Market Road',
    state: 'Lagos',
    city: 'Mushin',
    description: 'Genuine parts.',
    slug: 'ladipo-auto-spares',
    status: 'approved',
    visible: true,
    activeListingCount: 0,
    subscription: { plan: 'free', status: 'none' },
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  };
}

/** Exactly what the security rules permit a dealer to create. */
function legitimateDraft(overrides = {}) {
  return {
    storeId: STORE_ID,
    status: 'draft',
    name: 'Toyota Corolla Brake Pad',
    description: 'Front set.',
    categoryId: 'brake',
    condition: 'new',
    priceKobo: 4500000,
    quantity: 3,
    brand: 'Bosch',
    partNumber: 'TCBP-01',
    compatibleMake: 'Toyota',
    compatibleModel: 'Corolla',
    images: [],
    updatedAt: Timestamp.now(),
    ...overrides,
  };
}

async function waitFor(predicate, label, { timeoutMs = 20000, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = (await db.doc(LISTING).get()).data();
    if (last && predicate(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}; last: ${JSON.stringify(last)}`);
}

/** The trigger writes back, so "settled" means two identical reads in a row. */
async function settled(label) {
  await waitFor((d) => Array.isArray(d.searchTokens), label);
  let previous = JSON.stringify((await db.doc(LISTING).get()).data());
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const current = JSON.stringify((await db.doc(LISTING).get()).data());
    if (current === previous) return (await db.doc(LISTING).get()).data();
    previous = current;
  }
  throw new Error(`document never settled while waiting for ${label}`);
}

before(async () => {
  app = initializeApp({ projectId: PROJECT_ID }, 'triggers-suite');
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  for (const c of ['stores', 'listings']) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await db.doc(`stores/${STORE_ID}`).set(approvedStore());
});

describe('onListingWritten — create', () => {
  it('fills in the fields a dealer never sends', async () => {
    await db.doc(LISTING).set(legitimateDraft());
    const d = await settled('backfill');

    assert.ok(d.searchTokens.includes('bra'), 'searchTokens are generated server-side');
    assert.equal(d.storeApproved, true);
    assert.equal(d.storeVisible, true);
    assert.equal(d.storeSlug, 'ladipo-auto-spares');
    assert.equal(d.storeBusinessName, 'Ladipo Auto Spares');
    assert.equal(d.storeState, 'Lagos');
    assert.equal(d.storeCity, 'Mushin');
    assert.equal(d.storePhone, '+2349053114741');
    assert.equal(d.storeWhatsapp, '+2349053114741');
    assert.equal(d.moderation.removed, false);
    assert.ok(d.createdAt, 'createdAt is stamped by the backend');
    // A draft is not public, however approved and visible its store is.
    assert.equal(d.publiclyVisible, false);
  });

  it('replaces a forged future createdAt', async () => {
    const forged = Timestamp.fromDate(new Date('2099-01-01T00:00:00Z'));
    const before = Timestamp.now();

    await db.doc(LISTING).set(legitimateDraft({ createdAt: forged }));
    const d = await settled('createdAt to be replaced');

    // The permanent risk: every marketplace query orders by createdAt desc, so
    // a surviving year-2099 stamp would pin this listing above all legitimate
    // results for the life of the listing.
    assert.notDeepEqual(d.createdAt, forged, 'a forged createdAt must not survive');
    assert.ok(
      d.createdAt.toMillis() >= before.toMillis() && d.createdAt.toMillis() <= Date.now() + 5000,
      `createdAt must be a backend timestamp, got ${d.createdAt.toDate().toISOString()}`,
    );
  });

  it('replaces forged moderation data', async () => {
    await db.doc(LISTING).set(
      legitimateDraft({
        moderation: {
          removed: false,
          removedBy: 'not-an-admin',
          removedReason: 'planted',
          removedAt: Timestamp.now(),
        },
      }),
    );
    const d = await settled('moderation to be reset');

    assert.deepEqual(d.moderation, {
      removed: false,
      removedBy: null,
      removedReason: null,
      removedAt: null,
    });
  });

  it('recalculates a forged publiclyVisible', async () => {
    await db.doc(LISTING).set(legitimateDraft({ publiclyVisible: true }));
    const d = await settled('publiclyVisible to be recalculated');

    // status is 'draft', so the only correct answer is false regardless of what
    // the document arrived carrying.
    assert.equal(d.publiclyVisible, false);
  });

  it('overwrites forged denormalized store fields with the real store', async () => {
    await db.doc(LISTING).set(
      legitimateDraft({
        storeApproved: true,
        storeVisible: true,
        storeSlug: 'someone-elses-store',
        storeBusinessName: 'Not My Store',
        storeState: 'Kano',
        storeCity: 'Nowhere',
        storePhone: '+2340000000000',
        storeWhatsapp: '+2340000000000',
      }),
    );
    const d = await settled('store fields to be re-derived');

    assert.equal(d.storeSlug, 'ladipo-auto-spares');
    assert.equal(d.storeBusinessName, 'Ladipo Auto Spares');
    assert.equal(d.storeState, 'Lagos');
    assert.equal(d.storeCity, 'Mushin');
    assert.equal(d.storePhone, '+2349053114741');
    assert.equal(d.storeWhatsapp, '+2349053114741');
  });

  it('strips a forged publishedAt', async () => {
    await db.doc(LISTING).set(legitimateDraft({ publishedAt: Timestamp.now() }));
    const d = await settled('publishedAt to be stripped');

    // Nothing the trigger derives, so it is deleted rather than overwritten.
    // publishListing is the only writer that may set it.
    assert.equal(d.publishedAt, undefined);
  });

  it('stuffed search tokens do not survive', async () => {
    await db.doc(LISTING).set(
      legitimateDraft({ searchTokens: ['toyota', 'honda', 'bmw', 'mercedes', 'free'] }),
    );
    const d = await settled('searchTokens to be regenerated');

    assert.ok(!d.searchTokens.includes('mercedes'), 'tokens come from this listing only');
    assert.ok(d.searchTokens.includes('bra'), 'tokens are derived from the real name');
  });

  it('a listing whose store does not exist stays invisible', async () => {
    await db.doc(LISTING).set(legitimateDraft({ storeId: 'no-such-store' }));
    const d = await settled('unresolvable store');

    assert.equal(d.storeApproved, false);
    assert.equal(d.storeVisible, false);
    assert.equal(d.publiclyVisible, false);
  });
});

describe('onListingWritten — update', () => {
  it('preserves createdAt across an edit', async () => {
    await db.doc(LISTING).set(legitimateDraft());
    const created = (await settled('initial backfill')).createdAt;

    await new Promise((r) => setTimeout(r, 1100)); // outside timestamp resolution
    await db.doc(LISTING).update({ name: 'Renamed part', updatedAt: Timestamp.now() });
    const d = await settled('the edit');

    // Re-stamping on every write would silently reorder the whole marketplace
    // — every edited listing would jump to the top of `createdAt desc`.
    assert.equal(d.createdAt.toMillis(), created.toMillis(), 'an edit must not restamp createdAt');
    assert.ok(d.searchTokens.includes('ren'), 'tokens follow the new name');
  });

  it('does not undo an admin removal', async () => {
    await db.doc(LISTING).set(legitimateDraft());
    await settled('initial backfill');

    await db.doc(LISTING).update({
      moderation: {
        removed: true,
        removedBy: 'admin-1',
        removedReason: 'Counterfeit part',
        removedAt: Timestamp.now(),
      },
      publiclyVisible: false,
    });
    const d = await settled('the removal');

    // Forcing the default on every write — rather than on create only — would
    // put a removed listing straight back on the marketplace.
    assert.equal(d.moderation.removed, true, 'a removal must survive the trigger');
    assert.equal(d.moderation.removedReason, 'Counterfeit part');
    assert.equal(d.publiclyVisible, false);
  });

  it('publishing an approved store\'s listing makes it public', async () => {
    await db.doc(LISTING).set(legitimateDraft());
    await settled('initial backfill');

    // What publishListing does, minus the transactional count.
    await db.doc(LISTING).update({ status: 'active', publishedAt: Timestamp.now() });
    const d = await settled('publication');

    assert.equal(d.publiclyVisible, true);
    assert.ok(d.publishedAt, 'publishedAt set by a backend writer is preserved');
  });
});
