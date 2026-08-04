#!/usr/bin/env node
/**
 * Seeds approved dealer stores and live listings into the Local Emulator Suite,
 * so the public marketplace and the admin dashboards have real documents to
 * render instead of hardcoded arrays.
 *
 * Writes the same shapes the Cloud Functions produce — including the
 * denormalised store fields and the `publiclyVisible` flag — because the
 * marketplace queries filter on exactly those. Seeding a listing without them
 * produces a document that exists but can never appear, which is a confusing
 * way to discover the contract.
 *
 * Safety: refuses to run unless the project id starts with `demo-`. This
 * creates dealer records and public listings; pointing it at production would
 * publish fictional businesses.
 *
 * Usage (emulators must already be running):
 *   node functions/scripts/seed-marketplace.mjs
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import sharp from 'sharp';

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-naija-parts-hub';
const STORAGE_HOST = process.env.STORAGE_HOST ?? '127.0.0.1';
const STORAGE_PORT = process.env.STORAGE_PORT ?? '9199';
const BUCKET = `${PROJECT_ID}.appspot.com`;

process.env.FIRESTORE_EMULATOR_HOST ??= 'localhost:8080';
// firebase-admin wants the scheme here, unlike the Firestore/Auth variables.
process.env.STORAGE_EMULATOR_HOST ??= `http://${STORAGE_HOST}:${STORAGE_PORT}`;
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.METADATA_SERVER_DETECTION = 'none';

if (!PROJECT_ID.startsWith('demo-')) {
  console.error(`✗ Refusing to seed non-demo project "${PROJECT_ID}".`);
  process.exit(1);
}

initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET });
const db = getFirestore();
const bucket = getStorage().bucket();

/**
 * Generates a placeholder photo and uploads it to the Storage emulator at the
 * path the Flutter uploader uses.
 *
 * Real files rather than empty galleries, because an empty `images` array
 * exercises none of the pipeline: not the Storage rules, not the download-URL
 * format, not the remotePatterns allowlist in next.config. Seeding with []
 * produced blank cards that looked like a rendering bug.
 *
 * Deliberately drawn as an obvious placeholder — a flat colour tile carrying
 * the part name and the word PLACEHOLDER. Stock photography of real parts would
 * be indistinguishable from a dealer's own upload, and nobody reviewing the site
 * could tell which listings were fabricated.
 */
const CATEGORY_COLOUR = {
  car: '#1F3A5F',
  motorcycle: '#5F1F3A',
  truck: '#3A5F1F',
  tractor: '#5F4A1F',
  heavy: '#1F5F5A',
  electrical: '#4A1F5F',
};

function escapeXml(value) {
  return value.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c],
  );
}

/**
 * Where product photos are read from, in order of preference.
 *
 * The approved design pack already ships these images at
 * apps/web/public/products, and they are committed. Reading them directly means
 * a fresh clone seeds with real photography and no manual copying — and there
 * is one copy of each file in the repo rather than two.
 *
 * seed-images/ is kept as an override for anyone who wants different fixtures
 * without touching the design assets.
 */
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PHOTO_DIRS = [
  join(SCRIPT_DIR, 'seed-images'),
  join(SCRIPT_DIR, '..', '..', 'apps', 'web', 'public', 'products'),
];
const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * First existing file matching any accepted name, or null.
 *
 * Each listing offers several spellings rather than one exact filename —
 * tyre/tire and singular/plural are both natural to type, and a fixture that
 * silently falls back to a colour tile because of a missing "s" is a poor
 * trade for the thirty seconds it takes to accept both.
 */
function findPhoto(names) {
  if (!names) return null;
  for (const dir of PHOTO_DIRS) {
    for (const name of Array.isArray(names) ? names : [names]) {
      for (const ext of PHOTO_EXTENSIONS) {
        const candidate = join(dir, `${name}${ext}`);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

/**
 * Uploads a real photo when one has been supplied, or a generated tile when it
 * has not.
 *
 * Re-encoded rather than uploaded verbatim: the Storage rules cap a listing
 * image at 512 KB, and a 4 MB phone photo would be rejected at the exact point
 * a dealer is least able to diagnose it. 1200px on the long edge is well beyond
 * what the largest rendered slot needs.
 */
async function uploadListingPhoto(listing, store, index) {
  const source = findPhoto(listing.photo);

  if (source) {
    const buffer = await sharp(source)
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    const meta = await sharp(buffer).metadata();
    return storeImage(listing, buffer, index, meta.width, meta.height);
  }

  return uploadPlaceholder(listing, store, index);
}

async function uploadPlaceholder(listing, store, index) {
  const width = 800;
  const height = 600;
  const colour = CATEGORY_COLOUR[listing.categoryId] ?? '#333333';

  // Wrapped by hand: SVG text has no line breaking, and a long part name on one
  // line simply runs off the canvas.
  const words = listing.name.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > 22) {
      lines.push(current.trim());
      current = word;
    } else {
      current += ` ${word}`;
    }
  }
  if (current.trim()) lines.push(current.trim());

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="${colour}"/>
    <rect x="0" y="${height - 90}" width="${width}" height="90" fill="#000000" opacity="0.35"/>
    ${lines
      .map(
        (line, i) =>
          `<text x="50%" y="${240 + i * 52}" text-anchor="middle" fill="#FFFFFF"
             font-family="sans-serif" font-size="42" font-weight="bold">${escapeXml(line)}</text>`,
      )
      .join('')}
    <text x="50%" y="${height - 34}" text-anchor="middle" fill="#FFFFFF"
      font-family="sans-serif" font-size="26" opacity="0.85">SEED PLACEHOLDER · ${escapeXml(store.businessName)}</text>
  </svg>`;

  const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
  return storeImage(listing, buffer, index, width, height);
}

/** Writes bytes to the Storage emulator and returns the ListingImage record. */
async function storeImage(listing, buffer, index, width, height) {
  const imageId = `seed-${index}`;
  const path = `stores/${listing.storeId}/listings/${listing.listingId}/${imageId}.jpg`;
  // The token is what makes the URL publicly fetchable. The Storage emulator
  // honours firebaseStorageDownloadTokens exactly as production does, so the
  // URL shape below is the same one the Flutter app's getDownloadURL returns.
  const token = randomUUID();

  await bucket.file(path).save(buffer, {
    contentType: 'image/jpeg',
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });

  const url =
    `http://${STORAGE_HOST}:${STORAGE_PORT}/v0/b/${BUCKET}/o/` +
    `${encodeURIComponent(path)}?alt=media&token=${token}`;

  return { path, url, width, height, sizeBytes: buffer.length };
}

/**
 * Fails early and readably when an emulator is not running.
 *
 * Without this the first upload dies inside the Google Cloud Storage client
 * with a forty-line GaxiosError whose actual cause — ECONNREFUSED — is buried
 * in the middle. The stores are seeded by then too, leaving a half-populated
 * database that looks like corruption rather than a stopped service.
 */
async function requireEmulators() {
  const checks = [
    ['Firestore', `http://${process.env.FIRESTORE_EMULATOR_HOST}/`],
    ['Storage', `http://${STORAGE_HOST}:${STORAGE_PORT}/`],
  ];

  const down = [];
  for (const [name, url] of checks) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(3000) });
    } catch {
      down.push(name);
    }
  }

  if (down.length > 0) {
    console.error(
      `✗ ${down.join(' and ')} emulator${down.length > 1 ? 's are' : ' is'} not reachable.\n` +
        '  Start the suite first, from the repo root:\n\n' +
        '    npm run emulators\n',
    );
    process.exit(1);
  }
}

const now = Timestamp.now();
const daysAgo = (n) => Timestamp.fromMillis(Date.now() - n * 86_400_000);

const STORES = [
  {
    storeId: 'seed-ladipo-auto',
    businessName: 'Ladipo Auto Spares',
    ownerName: 'Chinedu Okafor',
    phone: '+2349036726262',
    whatsapp: '+2349036726262',
    cacNumber: 'RC1207675',
    address: '50 Ladipo Market Road, Mushin',
    state: 'Lagos',
    city: 'Mushin',
    description:
      'Genuine and quality-used parts for Toyota, Honda and Nissan. Trading at Ladipo since 2011.',
    slug: 'ladipo-auto-spares',
    createdAt: daysAgo(420),
    approvedAt: daysAgo(400),
  },
  {
    storeId: 'seed-nnewi-motor',
    businessName: 'Nnewi Motor Parts Hub',
    ownerName: 'Ifeanyi Obi',
    phone: '+2348051234567',
    whatsapp: '+2348051234567',
    cacNumber: 'RC0993412',
    address: '12 Edo-Ezemewi Road',
    state: 'Anambra',
    city: 'Nnewi',
    description: 'Commercial vehicle and truck components, sourced direct from importers.',
    slug: 'nnewi-motor-parts-hub',
    createdAt: daysAgo(300),
    approvedAt: daysAgo(280),
  },
  {
    storeId: 'seed-kano-heavy',
    businessName: 'Kano Heavy Equipment Parts',
    ownerName: 'Musa Abdullahi',
    phone: '+2348122223333',
    whatsapp: '+2348122223333',
    cacNumber: 'RC1440021',
    address: '8 Zaria Road',
    state: 'Kano',
    city: 'Kano',
    description: 'Tractor, excavator and generator spares for the northern corridor.',
    slug: 'kano-heavy-equipment-parts',
    createdAt: daysAgo(120),
    approvedAt: daysAgo(100),
  },
  {
    // Deliberately left pending, so the verification queue has something in it
    // and the marketplace can be checked for correctly excluding it.
    storeId: 'seed-pending-dealer',
    businessName: 'Surulere Auto Centre',
    ownerName: 'Bola Adeyemi',
    phone: '+2347011119999',
    whatsapp: '+2347011119999',
    cacNumber: 'RC1550998',
    address: '3 Adeniran Ogunsanya Street',
    state: 'Lagos',
    city: 'Surulere',
    description: 'Awaiting verification.',
    slug: 'surulere-auto-centre',
    createdAt: daysAgo(2),
    approvedAt: null,
    status: 'pending',
  },
];

const LISTINGS = [
  {
    listingId: 'seed-toyota-camry-brake-pads',
    photo: ['brake-pads', 'brake-pad'],
    storeId: 'seed-ladipo-auto',
    name: 'Toyota Camry 2017 Front Brake Pads',
    description:
      'Genuine Toyota front brake pads for the 2015–2018 Camry. Sold as a complete axle set.',
    categoryId: 'car',
    condition: 'new',
    priceKobo: 4_500_000,
    quantity: 12,
    brand: 'Toyota',
    partNumber: 'TCBP-2017-F',
    compatibleMake: 'Toyota',
    compatibleModel: 'Camry 2015-2018',
    publishedAt: daysAgo(3),
  },
  {
    listingId: 'seed-honda-accord-alternator',
    photo: 'alternator',
    storeId: 'seed-ladipo-auto',
    name: 'Honda Accord 2013 Alternator',
    description: 'Tested used alternator pulled from a 2013 Accord. 90-day warranty.',
    categoryId: 'electrical',
    condition: 'used',
    priceKobo: 7_800_000,
    quantity: 3,
    brand: 'Honda',
    partNumber: 'HA-2013-ALT',
    compatibleMake: 'Honda',
    compatibleModel: 'Accord 2008-2013',
    publishedAt: daysAgo(9),
  },
  {
    listingId: 'seed-truck-clutch-plate',
    photo: ['clutch-plates', 'clutch-plate'],
    storeId: 'seed-nnewi-motor',
    name: 'Mack Truck Heavy Duty Clutch Plate',
    description: 'Reinforced clutch plate for Mack and Iveco tractor units.',
    categoryId: 'truck',
    condition: 'new',
    priceKobo: 21_000_000,
    quantity: 5,
    brand: 'Mack',
    partNumber: 'MT-CL-880',
    compatibleMake: 'Mack',
    compatibleModel: 'CH / CX series',
    publishedAt: daysAgo(14),
  },
  {
    listingId: 'seed-excavator-hydraulic-pump',
    photo: 'hydraulic-pump',
    storeId: 'seed-kano-heavy',
    name: 'Caterpillar Excavator Hydraulic Pump',
    description: 'Refurbished hydraulic pump for CAT 320 series excavators. Bench tested.',
    categoryId: 'heavy',
    condition: 'used',
    priceKobo: 145_000_000,
    quantity: 1,
    brand: 'Caterpillar',
    partNumber: 'CAT-HYD-PUMP',
    compatibleMake: 'Caterpillar',
    compatibleModel: '320 / 320D',
    publishedAt: daysAgo(21),
  },
  {
    listingId: 'seed-tractor-fuel-filter',
    photo: ['fuel-filter', 'oil-filter'],
    storeId: 'seed-kano-heavy',
    name: 'Massey Ferguson Tractor Fuel Filter',
    description: 'Fuel filter assembly for Massey Ferguson 375 and 385 tractors.',
    categoryId: 'tractor',
    condition: 'new',
    priceKobo: 1_250_000,
    quantity: 40,
    brand: 'Massey Ferguson',
    partNumber: 'MF-375-FF',
    compatibleMake: 'Massey Ferguson',
    compatibleModel: '375 / 385',
    publishedAt: daysAgo(30),
  },
  {
    listingId: 'seed-bajaj-chain-sprocket',
    storeId: 'seed-nnewi-motor',
    name: 'Bajaj Boxer Chain and Sprocket Kit',
    description: 'Complete chain and sprocket kit for Bajaj Boxer 100cc.',
    categoryId: 'motorcycle',
    condition: 'new',
    priceKobo: 950_000,
    quantity: 25,
    brand: 'Bajaj',
    partNumber: 'BJ-BX-CS',
    compatibleMake: 'Bajaj',
    compatibleModel: 'Boxer 100',
    publishedAt: daysAgo(45),
    // No photo supplied for this one on purpose: a dealer who has published
    // before uploading is a real state, and the card must degrade to the
    // "No photo" tile rather than a broken image.
  },
  {
    listingId: 'seed-corolla-headlight',
    photo: 'headlight',
    storeId: 'seed-ladipo-auto',
    name: 'Toyota Corolla LED Headlight Assembly',
    description:
      'Complete left-hand LED headlamp unit with daytime running light. Direct fit, no coding required.',
    categoryId: 'electrical',
    condition: 'new',
    priceKobo: 32_500_000,
    quantity: 2,
    brand: 'Toyota',
    partNumber: 'TC-LED-LH',
    compatibleMake: 'Toyota',
    compatibleModel: 'Corolla 2017-2021',
    publishedAt: daysAgo(5),
  },
  {
    listingId: 'seed-tractor-tyre',
    photo: ['tractor-tyre', 'tractor-tire'],
    storeId: 'seed-kano-heavy',
    name: '710/70R42 Tractor Rear Tyre',
    description:
      'Radial rear tyre for high-horsepower tractors. Deep lug pattern for wet-season fieldwork.',
    categoryId: 'tractor',
    condition: 'new',
    priceKobo: 98_000_000,
    quantity: 4,
    brand: 'Michelin',
    partNumber: '710-70R42',
    compatibleMake: 'John Deere',
    compatibleModel: '7R / 8R series',
    publishedAt: daysAgo(11),
  },
  {
    // Removed by moderation: proves the marketplace hides it while the admin
    // queue still shows it with a Restore action.
    listingId: 'seed-removed-listing',
    storeId: 'seed-ladipo-auto',
    name: 'Counterfeit Brake Disc (removed)',
    description: 'Listing removed by an administrator during moderation review.',
    categoryId: 'car',
    condition: 'new',
    priceKobo: 2_000_000,
    quantity: 4,
    brand: 'Unbranded',
    partNumber: 'CF-BD-001',
    compatibleMake: 'Various',
    compatibleModel: 'Various',
    publishedAt: daysAgo(6),
    removed: true,
    removedReason: 'Suspected counterfeit part',
  },
];

async function seedStores() {
  const batch = db.batch();

  for (const store of STORES) {
    const status = store.status ?? 'approved';
    batch.set(db.collection('stores').doc(store.storeId), {
      businessName: store.businessName,
      ownerName: store.ownerName,
      phone: store.phone,
      whatsapp: store.whatsapp,
      cacNumber: store.cacNumber,
      address: store.address,
      state: store.state,
      city: store.city,
      description: store.description,
      slug: store.slug,
      status,
      rejectionReason: null,
      // Approved AND visible are both required by the public query; a store
      // that is approved but hidden is a valid state the admin can set.
      visible: status === 'approved',
      activeListingCount: LISTINGS.filter(
        (l) => l.storeId === store.storeId && !l.removed,
      ).length,
      subscription: {
        plan: 'free',
        status: 'none',
        startedAt: null,
        expiresAt: null,
        graceEndsAt: null,
        lastPaymentReference: null,
      },
      termsAcceptedAt: store.createdAt,
      createdAt: store.createdAt,
      updatedAt: store.approvedAt ?? store.createdAt,
      approvedAt: store.approvedAt,
      reviewedBy: store.approvedAt ? 'seed-script' : null,
    });

    // Slug reservation, mirroring what registerStore writes transactionally.
    batch.set(db.collection('storeSlugs').doc(store.slug), {
      storeId: store.storeId,
      createdAt: store.createdAt,
    });
  }

  await batch.commit();
  console.log(`✓ seeded ${STORES.length} stores (${STORES.filter((s) => !s.status).length} approved)`);
}

async function seedListings() {
  // Uploaded first: the listing document has to carry the resulting download
  // URLs, so the files must exist before the batch is written.
  let uploaded = 0;
  for (const listing of LISTINGS) {
    const store = STORES.find((s) => s.storeId === listing.storeId);
    listing.images = [await uploadListingPhoto(listing, store, 1)];
    uploaded += 1;
  }
  console.log(`✓ uploaded ${uploaded} listing photos to the Storage emulator`);

  const batch = db.batch();

  for (const listing of LISTINGS) {
    const store = STORES.find((s) => s.storeId === listing.storeId);
    const storeApproved = (store.status ?? 'approved') === 'approved';
    const removed = listing.removed === true;

    batch.set(db.collection('listings').doc(listing.listingId), {
      storeId: listing.storeId,
      name: listing.name,
      description: listing.description,
      categoryId: listing.categoryId,
      condition: listing.condition,
      priceKobo: listing.priceKobo,
      quantity: listing.quantity,
      brand: listing.brand,
      partNumber: listing.partNumber,
      compatibleMake: listing.compatibleMake,
      compatibleModel: listing.compatibleModel,
      images: listing.images ?? [],
      status: 'active',
      searchTokens: listing.name.toLowerCase().split(/\s+/),

      storeApproved,
      storeVisible: storeApproved,
      storeSlug: store.slug,
      storeBusinessName: store.businessName,
      storeState: store.state,
      storeCity: store.city,
      storePhone: store.phone,
      storeWhatsapp: store.whatsapp,

      // The one flag every public query filters on.
      publiclyVisible: storeApproved && !removed,

      moderation: {
        removed,
        removedBy: removed ? 'seed-script' : null,
        removedReason: removed ? listing.removedReason : null,
        removedAt: removed ? now : null,
      },

      createdAt: listing.publishedAt,
      updatedAt: listing.publishedAt,
      publishedAt: listing.publishedAt,
    });
  }

  await batch.commit();
  const live = LISTINGS.filter((l) => !l.removed).length;
  console.log(`✓ seeded ${LISTINGS.length} listings (${live} publicly visible)`);
}

await requireEmulators();
await seedStores();
await seedListings();

console.log('\nMarketplace seeded.');
console.log('  Public site : http://localhost:3000');
console.log('  Admin portal: http://localhost:3000/admin');
