import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import {
  ADMIN_CSRF_COOKIE,
  ADMIN_CSRF_HEADER,
  ADMIN_SESSION_COOKIE,
  createAdminSession,
  csrfCookieOptions,
  csrfMatches,
  isAllowedOrigin,
  newCsrfToken,
  sessionCookieOptions,
} from '@/lib/admin-session'

/**
 * Admin session endpoint.
 *
 * GET    -> issues a CSRF token and sets it as a readable cookie
 * POST   -> verifies origin, CSRF, ID token, auth recency and the admin claim,
 *           then sets an httpOnly session cookie
 * DELETE -> clears both cookies
 *
 * Node runtime is required: firebase-admin needs Node crypto and cannot run on
 * the Edge runtime.
 */
export const runtime = 'nodejs'

/** Issue a CSRF token. The client reads the cookie and echoes it on POST. */
export async function GET() {
  const token = newCsrfToken()
  const response = NextResponse.json({ csrfToken: token })
  response.cookies.set({ ...csrfCookieOptions(60 * 30), value: token })
  return response
}

export async function POST(request: Request) {
  // 1. Origin. Exact match against an allowlist — a suffix check would accept
  //    evil-naijapartshub.com.
  const origin = request.headers.get('origin')
  if (!isAllowedOrigin(origin)) {
    return NextResponse.json(
      { error: 'Request origin is not allowed.', reason: 'bad-origin' },
      { status: 403 },
    )
  }

  // 2. Double-submit CSRF. A cross-origin page can neither read our cookie nor
  //    set this header, so matching values prove same-origin intent.
  const store = await cookies()
  const cookieToken = store.get(ADMIN_CSRF_COOKIE)?.value
  const headerToken = request.headers.get(ADMIN_CSRF_HEADER)
  if (!csrfMatches(cookieToken, headerToken)) {
    return NextResponse.json(
      { error: 'CSRF token missing or invalid.', reason: 'bad-csrf' },
      { status: 403 },
    )
  }

  let idToken: unknown
  try {
    ({ idToken } = await request.json())
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 })
  }

  if (typeof idToken !== 'string' || idToken.length === 0) {
    return NextResponse.json({ error: 'idToken is required.' }, { status: 400 })
  }

  // 3. Token validity, authentication recency, admin claim — in that order,
  //    all before any session cookie exists.
  const result = await createAdminSession(idToken)

  if (!result.ok) {
    const { status, error } = describeFailure(result.reason)
    return NextResponse.json({ error, reason: result.reason }, { status })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set({
    ...sessionCookieOptions(Math.floor(result.maxAgeMs / 1000)),
    value: result.cookie,
  })
  // The CSRF token is single-use for session creation; a fresh one is issued
  // on the next GET.
  response.cookies.set({ ...csrfCookieOptions(0), value: '' })
  return response
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set({ ...sessionCookieOptions(0), value: '' })
  response.cookies.set({ ...csrfCookieOptions(0), value: '' })
  response.cookies.delete(ADMIN_SESSION_COOKIE)
  response.cookies.delete(ADMIN_CSRF_COOKIE)
  return response
}

function describeFailure(reason: string): { status: number; error: string } {
  switch (reason) {
    case 'not-admin':
      return { status: 403, error: 'This account is not an administrator.' }
    case 'stale-auth':
      return {
        status: 401,
        error: 'Please sign in again — authentication must be recent to start an admin session.',
      }
    default:
      return { status: 401, error: 'Sign-in could not be verified.' }
  }
}
