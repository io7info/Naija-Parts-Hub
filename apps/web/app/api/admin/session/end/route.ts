import { NextResponse } from 'next/server'

import {
  ADMIN_CSRF_COOKIE,
  ADMIN_SESSION_COOKIE,
  csrfCookieOptions,
  sessionCookieOptions,
} from '@/lib/admin-session'

/**
 * Clears a dead session and sends the admin to sign-in with an explanation.
 *
 * This hop exists because a Server Component cannot modify cookies — only a
 * Route Handler can. Redirecting straight from requireAdmin() to /admin/login
 * would leave the expired or revoked cookie sitting in the browser until it
 * lapsed on its own, so every subsequent request would repeat the same failed
 * verification.
 *
 * The reason is carried through to the sign-in page so the admin is told why
 * they were signed out instead of being silently bounced.
 */
export const runtime = 'nodejs'

const REASONS = new Set(['expired', 'revoked', 'invalid'])

export async function GET(request: Request) {
  const url = new URL(request.url)
  const raw = url.searchParams.get('reason') ?? ''
  const reason = REASONS.has(raw) ? raw : 'invalid'

  const destination = new URL('/admin/login', url.origin)
  destination.searchParams.set('reason', reason)

  const response = NextResponse.redirect(destination, { status: 303 })
  response.cookies.set({ ...sessionCookieOptions(0), value: '' })
  response.cookies.set({ ...csrfCookieOptions(0), value: '' })
  response.cookies.delete(ADMIN_SESSION_COOKIE)
  response.cookies.delete(ADMIN_CSRF_COOKIE)
  return response
}
