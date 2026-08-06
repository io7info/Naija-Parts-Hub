import { after, before, beforeEach, describe, it } from 'node:test';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore';

import {
  admin,
  assertFails,
  assertSucceeds,
  dealer,
  dealerListingCreate,
  listingDoc,
  makeTestEnv,
  seed,
  storeDoc,
  visitor,
} from './helpers.mjs';

/**
 * Security rules tests.
 *
 * These exist because the rules encode the decision that makes SOW section 5
 * enforceable: approval, visibility, subscription and moderation fields are
 * backend-controlled and read-only to dealers. The clients are not a security
 * boundary — a dealer holding a valid ID token can call the REST API directly —
 * so every one of these assertions is about that direct path, not the UI.
 */

let env;

before(async () => {
  env = await makeTestEnv();
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

describe('stores', () => {
  it('lets a dealer read their own store', async () => {
    await seed(env, (db) => setDoc(doc(db, 'stores/dealer-1'), storeDoc()));
    await assertSucceeds(getDoc(doc(dealer(env, 'dealer-1'), 'stores/dealer-1')));
  });

  it('blocks a dealer from reading another dealer\'s pending store', async () => {
    await seed(env, (db) =>
      setDoc(doc(db, 'stores/dealer-2'), storeDoc({ status: 'pending', visible: false })));
    await assertFails(getDoc(doc(dealer(env, 'dealer-1'), 'stores/dealer-2')));
  });

  it('lets the public read an approved, visible store (storefront pages)', async () => {
    await seed(env, (db) => setDoc(doc(db, 'stores/dealer-1'), storeDoc()));
    await assertSucceeds(getDoc(doc(visitor(env), 'stores/dealer-1')));
  });

  it('hides an approved store that has been made invisible', async () => {
    await seed(env, (db) =>
      setDoc(doc(db, 'stores/dealer-1'), storeDoc({ visible: false })));
    await assertFails(getDoc(doc(visitor(env), 'stores/dealer-1')));
  });

  it('forbids client store creation — registerStore owns slug reservation', async () => {
    await assertFails(setDoc(doc(dealer(env, 'dealer-1'), 'stores/dealer-1'), storeDoc()));
  });

  // Regression: this exact read broke the whole onboarding flow.
  //
  // On a get for a non-existent document `resource` is null, so a rule that
  // touches resource.data raises a Null value error instead of evaluating
  // false — and the read is denied. myStoreProvider watches stores/{uid} from
  // the moment a dealer signs in, before any store exists, so every new dealer
  // hit a permission error where the registration screen should have been.
  it('lets a signed-in dealer read their own store BEFORE it exists', async () => {
    await assertSucceeds(getDoc(doc(dealer(env, 'new-dealer'), 'stores/new-dealer')));
  });

  it('still refuses a dealer reading someone else\'s non-existent store', async () => {
    await assertFails(getDoc(doc(dealer(env, 'dealer-1'), 'stores/nobody')));
  });

  it('lets a dealer edit their own profile fields', async () => {
    await seed(env, (db) => setDoc(doc(db, 'stores/dealer-1'), storeDoc()));
    await assertSucceeds(
      updateDoc(doc(dealer(env, 'dealer-1'), 'stores/dealer-1'), {
        businessName: 'Musa & Sons',
        ownerName: 'Musa Bello',
        phone: '+2348031234567',
        whatsapp: '+2348031234567',
        cacNumber: 'RC123456',
        address: '13 Ladipo Street',
        state: 'Lagos',
        city: 'Lagos',
        description: 'Updated',
        updatedAt: new Date(),
      }),
    );
  });

  // The critical set: the previous ruleset allowed all of these.
  //
  // Each fixture below must seed a value DIFFERENT from the one being written.
  // Firestore's diff().affectedKeys() reports only fields whose value actually
  // changed, so writing an identical value produces an empty diff and is
  // (correctly) permitted — it changes nothing. Seeding 'approved' and then
  // writing 'approved' would therefore pass while proving nothing.
  describe('backend-controlled fields are read-only to dealers', () => {
    beforeEach(async () => {
      await seed(env, (db) =>
        setDoc(doc(db, 'stores/dealer-1'), storeDoc({
          status: 'pending',
          visible: false,
          activeListingCount: 3,
        })));
    });

    it('rejects self-approval', async () => {
      await assertFails(
        updateDoc(doc(dealer(env, 'dealer-1'), 'stores/dealer-1'), { status: 'approved' }));
    });

    it('rejects self-granting a paid subscription', async () => {
      await assertFails(
        updateDoc(doc(dealer(env, 'dealer-1'), 'stores/dealer-1'), {
          subscription: { plan: 'yearly', status: 'active' },
        }),
      );
    });

    it('rejects tampering with activeListingCount', async () => {
      await assertFails(
        updateDoc(doc(dealer(env, 'dealer-1'), 'stores/dealer-1'), { activeListingCount: 0 }));
    });

    it('rejects making yourself visible', async () => {
      await assertFails(
        updateDoc(doc(dealer(env, 'dealer-1'), 'stores/dealer-1'), { visible: true }));
    });

    it('rejects changing your own slug', async () => {
      await assertFails(
        updateDoc(doc(dealer(env, 'dealer-1'), 'stores/dealer-1'), { slug: 'premium-slug' }));
    });

    it('rejects clearing a rejection reason', async () => {
      await seed(env, (db) =>
        setDoc(doc(db, 'stores/dealer-1'), storeDoc({
          status: 'rejected',
          rejectionReason: 'CAC number could not be verified',
        })));
      await assertFails(
        updateDoc(doc(dealer(env, 'dealer-1'), 'stores/dealer-1'), { rejectionReason: null }));
    });
  });

  it('lets an admin approve a store', async () => {
    await seed(env, (db) =>
      setDoc(doc(db, 'stores/dealer-1'), storeDoc({ status: 'pending', visible: false })));
    await assertSucceeds(
      updateDoc(doc(admin(env), 'stores/dealer-1'), { status: 'approved', visible: true }));
  });

  it('stops a suspended dealer editing their way back', async () => {
    await seed(env, (db) =>
      setDoc(doc(db, 'stores/dealer-1'), storeDoc({ status: 'suspended' })));
    await assertFails(
      updateDoc(doc(dealer(env, 'dealer-1'), 'stores/dealer-1'), {
        businessName: 'Renamed',
        ownerName: 'Musa Bello',
        phone: '+2348031234567',
        whatsapp: '',
        cacNumber: 'RC123456',
        address: '12 Ladipo Street',
        state: 'Lagos',
        city: 'Lagos',
        description: '',
        updatedAt: new Date(),
      }),
    );
  });
});

describe('listings', () => {
  beforeEach(async () => {
    await seed(env, (db) => setDoc(doc(db, 'stores/dealer-1'), storeDoc()));
  });

  it('allows a dealer to create a draft', async () => {
    await assertSucceeds(
      setDoc(doc(dealer(env, 'dealer-1'), 'listings/l1'), dealerListingCreate()));
  });

  // The single most important assertion in this file.
  it('REJECTS creating a listing already active — bypassing the limit check', async () => {
    await assertFails(
      setDoc(doc(dealer(env, 'dealer-1'), 'listings/l1'),
        dealerListingCreate({ status: 'active' })));
  });

  it('rejects creating a listing owned by another store', async () => {
    await assertFails(
      setDoc(doc(dealer(env, 'dealer-1'), 'listings/l1'),
        dealerListingCreate({ storeId: 'dealer-2' })));
  });

  it('rejects a float price — money is integer kobo', async () => {
    await assertFails(
      setDoc(doc(dealer(env, 'dealer-1'), 'listings/l1'),
        dealerListingCreate({ priceKobo: 5000.5 })));
  });

  it('rejects a negative price', async () => {
    await assertFails(
      setDoc(doc(dealer(env, 'dealer-1'), 'listings/l1'),
        dealerListingCreate({ priceKobo: -100 })));
  });

  it('rejects more than three images (SOW section 4)', async () => {
    await assertFails(
      setDoc(doc(dealer(env, 'dealer-1'), 'listings/l1'),
        dealerListingCreate({ images: [{}, {}, {}, {}] })));
  });

  // -----------------------------------------------------------------------
  // Create-time field allowlist.
  //
  // `validListingPayload` checks the fields it knows about and says nothing
  // about any others, so before the allowlist a dealer could post a perfectly
  // valid draft that also carried backend-owned fields. The update rule has
  // always blocked those; create did not.
  //
  // `createdAt` is the one that mattered most: the trigger only backfilled a
  // *missing* value, so a forged future timestamp survived and pinned that
  // listing above every legitimate result in each `createdAt desc` query.
  // -----------------------------------------------------------------------
  describe('create rejects backend-owned fields', () => {
    const forged = {
      publiclyVisible: true,
      searchTokens: ['toyota', 'honda', 'brake'],
      moderation: { removed: false, removedBy: null, removedReason: null, removedAt: null },
      createdAt: new Date('2099-01-01'),
      publishedAt: new Date(),
      storeApproved: true,
      storeVisible: true,
      storeSlug: 'someone-elses-store',
      storeBusinessName: 'Not My Store',
      storeState: 'Lagos',
      storeCity: 'Ikeja',
      storePhone: '+2348000000000',
      storeWhatsapp: '+2348000000000',
    };

    for (const [field, value] of Object.entries(forged)) {
      it(`rejects a draft carrying ${field}`, async () => {
        await assertFails(
          setDoc(doc(dealer(env, 'dealer-1'), 'listings/l1'),
            dealerListingCreate({ [field]: value })));
      });
    }

    it('rejects a draft carrying an unknown field', async () => {
      await assertFails(
        setDoc(doc(dealer(env, 'dealer-1'), 'listings/l1'),
          dealerListingCreate({ sponsoredRank: 1 })));
    });

    it('rejects a draft carrying every forged field at once', async () => {
      await assertFails(
        setDoc(doc(dealer(env, 'dealer-1'), 'listings/l1'),
          dealerListingCreate(forged)));
    });

    // hasOnly is a subset test, not equality, so a shorter payload is fine as
    // far as the allowlist is concerned.
    //
    // updatedAt is the field to prove it with: validListingPayload does not
    // check it, whereas it reads brand, partNumber and the compatibility
    // fields directly — and a bare property access on a missing key raises,
    // which denies. Those must therefore be present as empty strings, which is
    // what the Flutter client sends. That is unchanged by the allowlist.
    it('accepts a draft with updatedAt omitted', async () => {
      const payload = dealerListingCreate();
      delete payload.updatedAt;
      await assertSucceeds(
        setDoc(doc(dealer(env, 'dealer-1'), 'listings/l2'), payload));
    });

    // The forged draft is denied, so there is nothing to become visible. This
    // asserts the outcome rather than the mechanism: a rule that failed open
    // would leave a publiclyVisible document a visitor could read.
    it('a rejected forged draft never becomes publicly readable', async () => {
      await assertFails(
        setDoc(doc(dealer(env, 'dealer-1'), 'listings/forged'),
          dealerListingCreate({ publiclyVisible: true })));

      await assertFails(getDoc(doc(visitor(env), 'listings/forged')));
    });
  });

  it('rejects self-publishing by update', async () => {
    await seed(env, (db) => setDoc(doc(db, 'listings/l1'), listingDoc()));
    await assertFails(
      updateDoc(doc(dealer(env, 'dealer-1'), 'listings/l1'), { status: 'active' }));
  });

  it('rejects making a listing publicly visible directly', async () => {
    await seed(env, (db) => setDoc(doc(db, 'listings/l1'), listingDoc()));
    await assertFails(
      updateDoc(doc(dealer(env, 'dealer-1'), 'listings/l1'), { publiclyVisible: true }));
  });

  it('rejects stuffing search tokens', async () => {
    await seed(env, (db) => setDoc(doc(db, 'listings/l1'), listingDoc()));
    await assertFails(
      updateDoc(doc(dealer(env, 'dealer-1'), 'listings/l1'), {
        searchTokens: ['toyota', 'honda', 'brake', 'engine'],
      }),
    );
  });

  it('rejects reassigning a listing to another store', async () => {
    await seed(env, (db) => setDoc(doc(db, 'listings/l1'), listingDoc()));
    await assertFails(
      updateDoc(doc(dealer(env, 'dealer-1'), 'listings/l1'), { storeId: 'dealer-2' }));
  });

  it('rejects clearing an admin moderation flag', async () => {
    await seed(env, (db) =>
      setDoc(doc(db, 'listings/l1'), listingDoc({
        moderation: { removed: true, removedBy: 'admin-1', removedReason: 'fake', removedAt: new Date() },
      })));
    await assertFails(
      updateDoc(doc(dealer(env, 'dealer-1'), 'listings/l1'), {
        moderation: { removed: false, removedBy: null, removedReason: null, removedAt: null },
      }),
    );
  });

  it('allows editing dealer-owned content fields', async () => {
    await seed(env, (db) => setDoc(doc(db, 'listings/l1'), listingDoc()));
    await assertSucceeds(
      updateDoc(doc(dealer(env, 'dealer-1'), 'listings/l1'), {
        name: 'Bajaj Brake Pad (Front)',
        description: 'Updated',
        categoryId: 'brake',
        condition: 'used',
        priceKobo: 450000,
        quantity: 5,
        brand: 'Bosch',
        partNumber: 'BP-1234',
        compatibleMake: 'Bajaj',
        compatibleModel: 'Pulsar',
        images: [],
        updatedAt: new Date(),
      }),
    );
  });

  it('forbids dealers deleting listings directly — the counter would drift', async () => {
    await seed(env, (db) => setDoc(doc(db, 'listings/l1'), listingDoc()));
    await assertFails(deleteDoc(doc(dealer(env, 'dealer-1'), 'listings/l1')));
  });
});

describe('public marketplace reads', () => {
  it('lets a visitor query publicly visible listings', async () => {
    await seed(env, async (db) => {
      await setDoc(doc(db, 'stores/dealer-1'), storeDoc());
      await setDoc(doc(db, 'listings/l1'),
        listingDoc({ status: 'active', publiclyVisible: true }));
    });
    await assertSucceeds(
      getDocs(query(collection(visitor(env), 'listings'), where('publiclyVisible', '==', true))));
  });

  it('rejects an unfiltered listings query — it would expose drafts', async () => {
    await assertFails(getDocs(collection(visitor(env), 'listings')));
  });

  it('rejects a visitor reading a draft directly', async () => {
    await seed(env, (db) => setDoc(doc(db, 'listings/l1'), listingDoc()));
    await assertFails(getDoc(doc(visitor(env), 'listings/l1')));
  });

  it('rejects enumerating every dealer', async () => {
    await assertFails(getDocs(collection(visitor(env), 'stores')));
  });
});

describe('backend-only collections', () => {
  it('lets a dealer read their own payments but not write them', async () => {
    await seed(env, (db) =>
      setDoc(doc(db, 'payments/ref-1'), { reference: 'ref-1', storeId: 'dealer-1', status: 'success' }));
    await assertSucceeds(getDoc(doc(dealer(env, 'dealer-1'), 'payments/ref-1')));
    await assertFails(
      setDoc(doc(dealer(env, 'dealer-1'), 'payments/ref-2'),
        { reference: 'ref-2', storeId: 'dealer-1', status: 'success' }));
  });

  it('blocks reading another dealer\'s payment', async () => {
    await seed(env, (db) =>
      setDoc(doc(db, 'payments/ref-1'), { reference: 'ref-1', storeId: 'dealer-2' }));
    await assertFails(getDoc(doc(dealer(env, 'dealer-1'), 'payments/ref-1')));
  });

  it('keeps the admin audit trail out of dealer hands', async () => {
    await seed(env, (db) =>
      setDoc(doc(db, 'adminActions/a1'), { action: 'store.approve', adminId: 'admin-1' }));
    await assertFails(getDoc(doc(dealer(env, 'dealer-1'), 'adminActions/a1')));
    await assertSucceeds(getDoc(doc(admin(env), 'adminActions/a1')));
  });

  it('allows public slug resolution but no writes', async () => {
    await seed(env, (db) => setDoc(doc(db, 'storeSlugs/musa-auto-parts'), { storeId: 'dealer-1' }));
    await assertSucceeds(getDoc(doc(visitor(env), 'storeSlugs/musa-auto-parts')));
    await assertFails(
      setDoc(doc(dealer(env, 'dealer-1'), 'storeSlugs/premium'), { storeId: 'dealer-1' }));
  });
});

describe('default deny', () => {
  it('rejects an unknown collection', async () => {
    await assertFails(setDoc(doc(dealer(env, 'dealer-1'), 'somethingNew/x'), { a: 1 }));
    await assertFails(getDoc(doc(visitor(env), 'somethingNew/x')));
  });
});
