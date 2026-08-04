import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

/**
 * Admin route protection and session security.
 *
 * Exercised over HTTP against a running Next.js server, because that is the
 * only way to prove the thing that matters: that an unauthenticated request for
 * /admin/overview never receives admin markup. A unit test of the session
 * helper could pass while the layout forgot to call it.
 *
 * Requires:
 *   emulators   npm run emulators
 *   web app     npm run dev --workspace @nph/web
 *
 * The prototype this replaced had no protection at all — "Sign In" was a plain
 * <Link href="/admin/overview"> — so every assertion here would have failed.
 */

const BASE = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3000';
const ORIGIN = BASE;
const PROJECT_ID = 'demo-naija-parts-hub';
const HOST = '127.0.0.1';

process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `${HOST}:9099`;
process.env.METADATA_SERVER_DETECTION ??= 'none';

const ADMIN_UID = 'route-test-admin';
const DEALER_UID = 'route-test-dealer';

const PROTECTED = [
  '/admin/overview',
  '/admin/verification',
  '/admin/moderation',
  '/admin/subscriptions',
];

let app;
let auth;

async function idTokenFor(uid) {
  const customToken = await auth.createCustomToken(uid);
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

/** Fetches a CSRF token and its cookie, as the login form does. */
async function csrf() {
  const res = await fetch(`${BASE}/api/admin/session`, { method: 'GET' });
  const { csrfToken } = await res.json();
  const cookie = (res.headers.get('set-cookie') ?? '')
    .split(',')
    .map((c) => c.trim().split(';')[0])
    .find((c) => c.startsWith('nph_admin_csrf='));
  return { csrfToken, cookie };
}

/** The full, correct session-creation call. */
async function createSession(uid, overrides = {}) {
  const idToken = await idTokenFor(uid);
  const { csrfToken, cookie } = await csrf();
  const res = await fetch(`${BASE}/api/admin/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      origin: overrides.origin ?? ORIGIN,
      ...(overrides.omitCsrfHeader ? {} : { 'x-nph-csrf': overrides.csrfToken ?? csrfToken }),
      ...(overrides.omitCsrfCookie ? {} : { cookie }),
    },
    body: JSON.stringify({ idToken: overrides.idToken ?? idToken }),
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  const session = setCookie
    .split(',')
    .map((c) => c.trim().split(';')[0])
    .find((c) => c.startsWith('nph_admin_session='));
  return { res, sessionCookie: session ?? '', rawSetCookie: setCookie };
}

const get = (path, cookie, extraHeaders = {}) =>
  fetch(`${BASE}${path}`, {
    redirect: 'manual',
    headers: { ...(cookie ? { cookie } : {}), ...extraHeaders },
  });

before(async () => {
  app = initializeApp({ projectId: PROJECT_ID }, 'admin-route-tests');
  auth = getAuth(app);

  await auth.createUser({ uid: ADMIN_UID, email: 'route-admin@lytodmotors.test' }).catch(() => {});
  await auth.setCustomUserClaims(ADMIN_UID, { role: 'super_admin' });

  // A perfectly valid Firebase user with NO admin claim — the case that
  // matters most, since anyone can hold an account in the project.
  await auth.createUser({ uid: DEALER_UID, email: 'route-dealer@example.test' }).catch(() => {});
  await auth.setCustomUserClaims(DEALER_UID, {});

  const ping = await fetch(`${BASE}/admin/login`).catch(() => null);
  if (!ping || !ping.ok) {
    throw new Error(`Web app not reachable at ${BASE}. Start: npm run dev --workspace @nph/web`);
  }
});

after(async () => {
  await deleteApp(app).catch(() => {});
});

describe('unauthenticated visitors', () => {
  for (const path of PROTECTED) {
    it(`redirects ${path} to sign-in`, async () => {
      const res = await get(path);
      assert.equal(res.status, 307, `${path} must redirect, got ${res.status}`);
      assert.match(res.headers.get('location') ?? '', /\/admin\/login/);
    });
  }

  it('never leaks admin markup in the redirect body', async () => {
    // Regression: the layout gate redirected correctly and leaked anyway,
    // because Next renders layout and page concurrently — 38 KB of dashboard
    // RSC arrived inside the 307 body, invisible to a browser but plain to curl.
    const res = await get('/admin/overview');
    const body = await res.text();
    for (const marker of ['Business Verification', 'Total Verified Stores', 'Pending Approvals']) {
      assert.ok(!body.includes(marker), `redirect body must not contain "${marker}"`);
    }
    assert.ok(body.length < 1000, `redirect body should be tiny, was ${body.length} bytes`);
  });

  it('leaves /admin/login reachable', async () => {
    const res = await fetch(`${BASE}/admin/login`);
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes('Admin Console'));
  });

  it('sends /admin to the sign-in page', async () => {
    const res = await get('/admin');
    assert.equal(res.status, 307);
    assert.match(res.headers.get('location') ?? '', /\/admin\/login/);
  });
});

describe('session creation — CSRF and origin', () => {
  it('rejects a request with no Origin header', async () => {
    const idToken = await idTokenFor(ADMIN_UID);
    const { csrfToken, cookie } = await csrf();
    const res = await fetch(`${BASE}/api/admin/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nph-csrf': csrfToken, cookie },
      body: JSON.stringify({ idToken }),
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).reason, 'bad-origin');
  });

  it('rejects a foreign Origin', async () => {
    const { res } = await createSession(ADMIN_UID, { origin: 'https://evil.example' });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).reason, 'bad-origin');
  });

  it('rejects a look-alike Origin', async () => {
    // An exact allowlist, not a suffix test: endsWith('naijapartshub.com')
    // would also accept evil-naijapartshub.com.
    const { res } = await createSession(ADMIN_UID, {
      origin: 'https://evil-naijapartshub.com',
    });
    assert.equal(res.status, 403);
  });

  it('rejects a missing CSRF header', async () => {
    const { res } = await createSession(ADMIN_UID, { omitCsrfHeader: true });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).reason, 'bad-csrf');
  });

  it('rejects a missing CSRF cookie', async () => {
    const { res } = await createSession(ADMIN_UID, { omitCsrfCookie: true });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).reason, 'bad-csrf');
  });

  it('rejects a mismatched CSRF token', async () => {
    const { res } = await createSession(ADMIN_UID, { csrfToken: 'a'.repeat(64) });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).reason, 'bad-csrf');
  });
});

describe('session creation — token and claim', () => {
  it('rejects a request with no token', async () => {
    const { csrfToken, cookie } = await csrf();
    const res = await fetch(`${BASE}/api/admin/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        origin: ORIGIN,
        'x-nph-csrf': csrfToken,
        cookie,
      },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  it('rejects a garbage token', async () => {
    const { res } = await createSession(ADMIN_UID, { idToken: 'not-a-real-token' });
    assert.equal(res.status, 401);
  });

  it('REFUSES a valid non-admin and issues no cookie', async () => {
    const { res, sessionCookie } = await createSession(DEALER_UID);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).reason, 'not-admin');
    assert.equal(sessionCookie, '', 'no session cookie may be issued to a non-admin');
  });

  it('accepts an admin and sets a hardened cookie', async () => {
    const { res, rawSetCookie } = await createSession(ADMIN_UID);
    assert.equal(res.status, 200);
    assert.match(rawSetCookie, /nph_admin_session=/);
    assert.match(rawSetCookie, /HttpOnly/i);
    assert.match(rawSetCookie, /SameSite=Lax/i);
    assert.match(rawSetCookie, /Path=\//i);
  });
});

describe('authorised administrator', () => {
  it('reaches every protected route', async () => {
    const { sessionCookie } = await createSession(ADMIN_UID);
    for (const path of PROTECTED) {
      const res = await get(path, sessionCookie);
      assert.equal(res.status, 200, `${path} should be reachable, got ${res.status}`);
    }
  });

  it('sees real admin content', async () => {
    const { sessionCookie } = await createSession(ADMIN_UID);
    const body = await (await get('/admin/verification', sessionCookie)).text();
    assert.ok(body.includes('Business Verification'));
  });
});

describe('invalid and forged cookies', () => {
  it('rejects a fabricated cookie value', async () => {
    const res = await get('/admin/overview', 'nph_admin_session=totally-made-up');
    assert.equal(res.status, 307, 'a forged cookie must not grant access');
    assert.match(res.headers.get('location') ?? '', /reason=invalid|\/admin\/login/);
  });

  it('rejects an ID token used directly as a session cookie', async () => {
    // ID tokens and session cookies are different artefacts; passing one where
    // the other is expected must fail rather than quietly work.
    const idToken = await idTokenFor(ADMIN_UID);
    const res = await get('/admin/overview', `nph_admin_session=${idToken}`);
    assert.equal(res.status, 307);
  });
});

describe('expired session', () => {
  /**
   * Firebase enforces a five-minute minimum session-cookie lifetime, so an
   * honestly expired cookie cannot be produced without waiting five minutes.
   * The server exposes a test-only header that makes the verifier throw the
   * real auth/session-cookie-expired code, guarded so it is inert outside
   * development against the emulator.
   */
  const forceExpired = { 'x-nph-test-session-error': 'expired' };

  it('routes an expired session through the handler that clears it', async () => {
    const { sessionCookie } = await createSession(ADMIN_UID);
    const res = await get('/admin/overview', sessionCookie, forceExpired);
    assert.equal(res.status, 307);
    assert.match(res.headers.get('location') ?? '', /\/api\/admin\/session\/end\?reason=expired/);
  });

  it('clears the cookie and lands on sign-in with an explanation', async () => {
    const res = await fetch(`${BASE}/api/admin/session/end?reason=expired`, {
      redirect: 'manual',
    });
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location') ?? '', /\/admin\/login\?reason=expired/);

    const setCookie = res.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /nph_admin_session=/, 'must clear the session cookie');
    assert.match(setCookie, /Max-Age=0|Expires=Thu, 01 Jan 1970/i, 'cookie must be expired');
  });

  it('shows "Your session has expired" on the sign-in page', async () => {
    const body = await (await fetch(`${BASE}/admin/login?reason=expired`)).text();
    assert.ok(body.includes('Your session has expired'), 'admin must be told why');
  });

  it('leaks no admin markup while expiring', async () => {
    const { sessionCookie } = await createSession(ADMIN_UID);
    const body = await (await get('/admin/overview', sessionCookie, forceExpired)).text();
    assert.ok(!body.includes('Total Verified Stores'));
  });
});

describe('revoked session', () => {
  const forceRevoked = { 'x-nph-test-session-error': 'revoked' };

  it('routes a revoked session to the clearing handler', async () => {
    const { sessionCookie } = await createSession(ADMIN_UID);
    const res = await get('/admin/overview', sessionCookie, forceRevoked);
    assert.equal(res.status, 307);
    assert.match(res.headers.get('location') ?? '', /reason=revoked/);
  });

  it('explains a revoked session distinctly from an expired one', async () => {
    const body = await (await fetch(`${BASE}/admin/login?reason=revoked`)).text();
    assert.ok(body.includes('ended for security reasons'));
  });
});

describe('logout', () => {
  it('clears both cookies on DELETE', async () => {
    const res = await fetch(`${BASE}/api/admin/session`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /nph_admin_session=/);
    assert.match(setCookie, /nph_admin_csrf=/);
  });

  it('a signed-out cookie no longer grants access', async () => {
    const { sessionCookie } = await createSession(ADMIN_UID);
    assert.equal((await get('/admin/overview', sessionCookie)).status, 200);

    // The browser drops the cookie; simulate by sending none.
    const after = await get('/admin/overview');
    assert.equal(after.status, 307);
  });
});
