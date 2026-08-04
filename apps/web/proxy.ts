import { NextResponse, type NextRequest } from 'next/server'

/**
 * First line of defence for /admin/**.
 *
 * This is NOT authorisation — it cannot be. The proxy runs on the Edge
 * runtime, where firebase-admin (Node crypto) cannot run, so it can only see
 * whether a cookie is present, never whether it is valid.
 *
 * It exists to stop RENDERING. Next.js renders the layout and page
 * concurrently, so a redirect() issued from the layout still lets the page
 * finish and flush its RSC payload into the response body. A 307 with the full
 * admin dashboard serialised inside it is a real leak: browsers follow the
 * redirect and show nothing, but curl reads the body directly. Verified before
 * this file existed — 38 KB of dashboard markup in the redirect body.
 *
* The proxy short-circuits before any rendering begins, so the common case —
 * no cookie at all — produces no payload to leak.
 *
 * Authorisation still happens twice behind this, and both are authoritative:
 *   1. requireAdmin() at the top of each admin page, before any JSX
 *   2. the (dashboard) layout, covering anything added later
 */
const ADMIN_SESSION_COOKIE = 'nph_admin_session'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // The sign-in page and the session endpoints must stay reachable, or nobody
  // can acquire a cookie — and, just as importantly, nobody holding a dead
  // cookie could ever reach the handler that clears it.
  if (pathname.startsWith('/admin/login') || pathname.startsWith('/api/admin/session')) {
    return NextResponse.next()
  }

  const hasCookie = request.cookies.has(ADMIN_SESSION_COOKIE)
  if (!hasCookie) {
    const url = request.nextUrl.clone()
    url.pathname = '/admin/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // A cookie exists but has not been verified. requireAdmin() does that.
  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*'],
}
