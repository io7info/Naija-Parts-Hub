/**
 * The protected admin screens render real Firestore data.
 *
 * Runs against the live dev server and a running Emulator Suite, seeded by
 * `npm run seed && npm run seed:marketplace`. It asserts on the rendered HTML
 * rather than on the repository functions, because the failure this guards
 * against is a page that compiles and authenticates correctly while still
 * displaying prototype constants.
 *
 * Prerequisites:
 *   npm run emulators
 *   npm run seed && npm run seed:marketplace
 *   NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true npm run dev --workspace @nph/web
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const HOST = process.env.EMULATOR_HOST ?? '127.0.0.1';
const BASE = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3000';
const PROJECT_ID = 'demo-naija-parts-hub';

process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `${HOST}:9099`;
process.env.FIRESTORE_EMULATOR_HOST ??= `${HOST}:8080`;
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.METADATA_SERVER_DETECTION = 'none';

const ADMIN_UID = 'admin-data-test-uid';
let app;
let sessionCookie = '';

async function idTokenFor(uid) {
  const customToken = await getAuth(app).createCustomToken(uid);
  const res = await fetch(
    `http://${HOST}:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const body = await res.json();
  if (!body.idToken) throw new Error(`no idToken: ${JSON.stringify(body)}`);
  return body.idToken;
}

/** Fetches a protected page with the admin session cookie attached. */
async function getAdminPage(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie: `nph_admin_session=${sessionCookie}` },
    redirect: 'manual',
  });
  assert.equal(res.status, 200, `${path} should render for an admin, got ${res.status}`);
  return res.text();
}

before(async () => {
  const ping = await fetch(`${BASE}/admin/login`).catch(() => null);
  if (!ping) {
    throw new Error(
      `Web app not reachable at ${BASE}. Start: NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true npm run dev --workspace @nph/web`,
    );
  }

  app = initializeApp({ projectId: PROJECT_ID }, 'admin-data-tests');

  // setCustomUserClaims must follow createUser — reversing them silently
  // produces a user with no claim and every assertion below fails as 403.
  await getAuth(app)
    .createUser({ uid: ADMIN_UID, email: 'admin-data@lytodmotors.test' })
    .catch(() => {});
  await getAuth(app).setCustomUserClaims(ADMIN_UID, { role: 'super_admin' });

  const csrfRes = await fetch(`${BASE}/api/admin/session`, { method: 'GET' });
  const { csrfToken } = await csrfRes.json();
  const csrfCookie = (csrfRes.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');

  const idToken = await idTokenFor(ADMIN_UID);
  const res = await fetch(`${BASE}/api/admin/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-nph-csrf': csrfToken,
      origin: BASE,
      cookie: csrfCookie,
    },
    body: JSON.stringify({ idToken }),
  });

  const setCookie = res.headers.getSetCookie?.() ?? [];
  sessionCookie =
    setCookie
      .find((c) => c.startsWith('nph_admin_session='))
      ?.split(';')[0]
      .split('=')[1] ?? '';
  assert.ok(sessionCookie, 'admin session cookie required for these tests');
});

after(async () => {
  await getAuth(app).deleteUser(ADMIN_UID).catch(() => {});
});

describe('verification screen', () => {
  it('lists seeded dealers, including the pending one', async () => {
    const html = await getAdminPage('/admin/verification');

    assert.match(html, /Ladipo Auto Spares/, 'approved dealer should appear');
    // The pending dealer is hidden from the public site but is precisely what
    // the verification queue exists to show.
    assert.match(html, /Surulere Auto Centre/, 'pending dealer should appear');
    assert.match(html, /RC1207675/, 'CAC number should be shown to an admin');
  });
});

describe('overview screen', () => {
  it('reports figures derived from Firestore, not constants', async () => {
    const html = await getAdminPage('/admin/overview');

    assert.match(html, /Total dealers/);
    assert.match(html, /Pending verification/);
    // Four seeded stores, one of them pending.
    assert.match(html, />4</, 'total dealer count should reflect the seeded stores');
  });

  it('names a seeded store in recent activity', async () => {
    const html = await getAdminPage('/admin/overview');
    assert.match(html, /Ladipo Auto Spares|Kano Heavy Equipment Parts|Surulere Auto Centre/);
  });
});

describe('moderation screen', () => {
  it('shows live listings and the removed one', async () => {
    const html = await getAdminPage('/admin/moderation');

    assert.match(html, /Toyota Camry 2017 Front Brake Pads/);
    // Removed listings must stay visible here, or removal becomes a one-way
    // door with no way to reinstate a listing.
    assert.match(html, /Counterfeit Brake Disc/);
    assert.match(html, /Suspected counterfeit part/, 'removal reason should be shown');
  });

  it('offers Restore for a removed listing and Remove for a live one', async () => {
    const html = await getAdminPage('/admin/moderation');

    assert.match(html, /Restore/);
    assert.match(html, /Remove/);
    // Actions with no backing callable were removed rather than left inert.
    assert.doesNotMatch(html, /Flag Seller/);
  });
});

describe('subscriptions screen', () => {
  it('lists seeded stores on the free plan', async () => {
    const html = await getAdminPage('/admin/subscriptions');

    assert.match(html, /Ladipo Auto Spares/);
    assert.match(html, /free/i);
  });

  it('states plainly that Paystack is not connected', async () => {
    const html = await getAdminPage('/admin/subscriptions');

    assert.match(html, /Paystack is not connected/i);
    // Extend and Suspend only ever mutated local state; a control that looks
    // like it grants a subscription must not exist until it does.
    assert.doesNotMatch(html, /Extend<\/button>/);
    assert.doesNotMatch(html, /Reactivate<\/button>/);
  });
});

describe('no prototype constants survive', () => {
  it('serves no store the seed data does not contain', async () => {
    const html = await getAdminPage('/admin/verification');
    // These names existed only in lib/prototype-admin-data.ts.
    assert.doesNotMatch(html, /Ibadan Spare Parts Ltd|Aba Motor Spares|Port Harcourt Auto/);
  });
});
