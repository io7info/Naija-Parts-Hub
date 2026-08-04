import 'server-only'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { ADMIN_CLAIM, ADMIN_CLAIM_VALUE } from '@nph/contracts'

import { getAdminAuth, adminUsesEmulator } from './firebase-admin'

/**
 * Administrator sessions.
 *
 * The Firebase client SDK keeps its ID token in IndexedDB, which the server
 * cannot read — so server components have no way to know who is asking. The
 * fix is a session cookie minted by the Admin SDK from a freshly issued ID
 * token, then verified on every request.
 *
 * httpOnly is the point: JavaScript cannot read or forge it. The prototype
 * used a `sessionStorage` flag any visitor could set from the console.
 *
 * ADMIN_CLAIM comes from @nph/contracts — the same constant the Cloud
 * Functions and Firestore rules use, so the three cannot drift apart.
 */

export const ADMIN_SESSION_COOKIE = 'nph_admin_session'
export const ADMIN_CSRF_COOKIE = 'nph_admin_csrf'
export const ADMIN_CSRF_HEADER = 'x-nph-csrf'

/** Two weeks, the Firebase maximum for a session cookie. */
const SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

/**
 * How recently the user must have actually authenticated for us to mint a
 * fourteen-day session from their token.
 *
 * Without this, an ID token minted 50 minutes ago — one lifted from an
 * unattended machine, say — could be exchanged for a fortnight of admin
 * access. Firebase's own guidance is to require recent authentication before
 * issuing a long-lived session.
 */
const MAX_AUTH_AGE_MS = 5 * 60 * 1000

/** Tolerance for clock skew between the signing service and this server. */
const CLOCK_SKEW_MS = 60 * 1000

export type AdminIdentity = { uid: string; email: string | null }

/**
 * Deliberately distinguished, because they need different responses:
 *
 *   anonymous — no cookie at all. Redirect to sign-in, say nothing.
 *   invalid   — malformed or forged. Same treatment as anonymous; separated
 *               so it can be logged differently.
 *   expired   — was genuinely valid. The admin deserves to be told why they
 *               were kicked out rather than silently bounced.
 *   revoked   — token revoked or account disabled. Security-relevant.
 *   forbidden — a real signed-in user WITHOUT the admin claim. Redirecting
 *               them to sign in would loop forever.
 */
export type SessionResult =
  | { state: 'anonymous' }
  | { state: 'invalid' }
  | { state: 'expired' }
  | { state: 'revoked' }
  | { state: 'forbidden'; uid: string; email: string | null }
  | { state: 'admin'; admin: AdminIdentity }

/**
 * Test seam for expired/revoked paths.
 *
 * Firebase enforces a five-minute minimum session-cookie lifetime, so a test
 * cannot honestly produce an expired cookie without waiting five minutes. This
 * header makes the verifier throw the real Firebase error code instead.
 *
 * Guarded twice: only outside production AND only when pointed at the emulator.
 * Both must hold, so it cannot be reached by a deployed build.
 */
function testForcedError(headerValue: string | null): string | null {
  const enabled = process.env.NODE_ENV !== 'production' && adminUsesEmulator
  if (!enabled || !headerValue) return null
  if (headerValue === 'expired') return 'auth/session-cookie-expired'
  if (headerValue === 'revoked') return 'auth/session-cookie-revoked'
  return null
}

export async function getAdminSession(): Promise<SessionResult> {
  const store = await cookies()
  const cookie = store.get(ADMIN_SESSION_COOKIE)?.value
  if (!cookie) return { state: 'anonymous' }

  const forced = testForcedError((await headers()).get('x-nph-test-session-error'))

  try {
    if (forced) {
      const error = new Error('forced for tests') as Error & { code: string }
      error.code = forced
      throw error
    }

    // checkRevoked costs a lookup, but means a disabled account or revoked
    // token stops working immediately rather than at cookie expiry.
    const decoded = await getAdminAuth().verifySessionCookie(cookie, true)
    const email = (decoded.email as string | undefined) ?? null

    if (decoded[ADMIN_CLAIM] !== ADMIN_CLAIM_VALUE) {
      return { state: 'forbidden', uid: decoded.uid, email }
    }
    return { state: 'admin', admin: { uid: decoded.uid, email } }
  } catch (e) {
    const code = (e as { code?: string })?.code ?? ''
    if (code === 'auth/session-cookie-expired') return { state: 'expired' }
    if (code === 'auth/session-cookie-revoked' || code === 'auth/user-disabled') {
      return { state: 'revoked' }
    }
    return { state: 'invalid' }
  }
}

/**
 * Guard for admin pages. Call it as the FIRST statement, before any JSX.
 *
 * The layout gate alone is not sufficient. Next renders layout and page
 * concurrently, so a redirect thrown in the layout still lets the page finish
 * and flush its RSC payload into the 307 body — measured at 38 KB of dashboard
 * markup, readable with curl. Redirecting here, before the page produces any
 * output, means there is nothing to serialise.
 */
export async function requireAdmin(): Promise<AdminIdentity> {
  const session = await getAdminSession()
  if (session.state === 'admin') return session.admin
  redirect(redirectTargetFor(session.state))
}

/**
 * Where each non-admin state should land.
 *
 * expired and revoked go through a route handler rather than straight to the
 * sign-in page, because a Server Component cannot modify cookies — only a
 * Route Handler can. That hop is what actually clears the dead cookie instead
 * of leaving it to linger until it expires on its own.
 */
export function redirectTargetFor(state: SessionResult['state']): string {
  switch (state) {
    case 'expired':
      return '/api/admin/session/end?reason=expired'
    case 'revoked':
      return '/api/admin/session/end?reason=revoked'
    case 'invalid':
      return '/api/admin/session/end?reason=invalid'
    default:
      return '/admin/login'
  }
}

// --- session creation -------------------------------------------------------

export type CreateSessionFailure =
  | 'invalid-token'
  | 'not-admin'
  | 'stale-auth'
  | 'bad-origin'
  | 'bad-csrf'

/**
 * Exchanges a client ID token for a session cookie.
 *
 * Order matters: the token is verified, then its authentication age, then the
 * admin claim — all before any cookie exists. A non-admin never receives an
 * admin session cookie at any point.
 */
export async function createAdminSession(
  idToken: string,
): Promise<
  | { ok: true; cookie: string; maxAgeMs: number }
  | { ok: false; reason: CreateSessionFailure }
> {
  let decoded
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken, true)
  } catch {
    return { ok: false, reason: 'invalid-token' }
  }

  // auth_time is when the user actually proved who they are, which is not the
  // same as when the token was issued — a refreshed token keeps the original
  // auth_time. That is precisely the value worth checking.
  const authTimeSeconds = decoded.auth_time
  if (typeof authTimeSeconds !== 'number' || !Number.isFinite(authTimeSeconds)) {
    return { ok: false, reason: 'stale-auth' }
  }

  const authTimeMs = authTimeSeconds * 1000
  const now = Date.now()

  // A future auth_time means a bad clock or a forged claim. Either way, refuse.
  if (authTimeMs > now + CLOCK_SKEW_MS) return { ok: false, reason: 'stale-auth' }
  if (now - authTimeMs > MAX_AUTH_AGE_MS) return { ok: false, reason: 'stale-auth' }

  if (decoded[ADMIN_CLAIM] !== ADMIN_CLAIM_VALUE) {
    return { ok: false, reason: 'not-admin' }
  }

  const cookie = await getAdminAuth().createSessionCookie(idToken, {
    expiresIn: SESSION_MAX_AGE_MS,
  })
  return { ok: true, cookie, maxAgeMs: SESSION_MAX_AGE_MS }
}

// --- CSRF -------------------------------------------------------------------

/**
 * Origins permitted to create a session.
 *
 * An exact-match allowlist, never a suffix test: `endsWith('naijapartshub.com')`
 * would also accept `evil-naijapartshub.com`.
 */
export function allowedOrigins(): string[] {
  const configured = process.env.ADMIN_ALLOWED_ORIGINS?.split(',').map((s) => s.trim())
  if (configured?.length) return configured.filter(Boolean)
  if (process.env.NODE_ENV === 'production') return ['https://naijapartshub.com']
  return ['http://localhost:3000', 'http://127.0.0.1:3000']
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false
  return allowedOrigins().includes(origin)
}

export function newCsrfToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Double-submit comparison.
 *
 * The token is delivered in a readable cookie AND echoed in a header. A
 * cross-origin page can do neither: it cannot read our cookie, and it cannot
 * set that header on a form post. Compared in constant time so the check
 * cannot be probed byte by byte.
 */
export function csrfMatches(cookieToken: string | undefined, headerToken: string | null): boolean {
  if (!cookieToken || !headerToken) return false
  const a = Buffer.from(cookieToken)
  const b = Buffer.from(headerToken)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// --- cookie attributes ------------------------------------------------------

/** Shared by the set and clear paths so they cannot diverge. */
export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    name: ADMIN_SESSION_COOKIE,
    httpOnly: true,
    // Secure is dropped in development because localhost is plain HTTP; a
    // Secure cookie would simply never be stored, making sign-in fail silently.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  }
}

/** The CSRF cookie is deliberately readable — the client must echo it back. */
export function csrfCookieOptions(maxAgeSeconds: number) {
  return {
    name: ADMIN_CSRF_COOKIE,
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  }
}
