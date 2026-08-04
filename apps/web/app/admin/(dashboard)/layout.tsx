import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'

import { AdminSidebar } from '@/components/admin/admin-sidebar'
import { getAdminSession, redirectTargetFor } from '@/lib/admin-session'
import { AdminForbidden } from './forbidden'

/**
 * THE GATE. Every /admin/** route except /admin/login passes through here.
 *
 * A server component, so the check runs before any markup is produced.
 * Deliberately NOT middleware: firebase-admin needs Node crypto and cannot run
 * on the Edge runtime, so a proxy can only see whether a cookie *exists*, which
 * is not authorisation.
 *
 * This is a backstop, not the only gate. Each page calls requireAdmin() first,
 * because Next renders layout and page concurrently — a redirect here alone
 * still lets the page flush its RSC payload into the redirect body. The layout
 * exists so any route added to this group later is covered by construction.
 */
export const dynamic = 'force-dynamic'

export default async function AdminDashboardLayout({ children }: { children: ReactNode }) {
  const session = await getAdminSession()

  if (session.state === 'forbidden') {
    // A real signed-in user without the claim. Redirecting to sign-in would
    // loop them forever, since signing in again changes nothing.
    return <AdminForbidden email={session.email} />
  }

  if (session.state !== 'admin') {
    // expired / revoked / invalid route through a handler that clears the dead
    // cookie first; anonymous goes straight to sign-in.
    redirect(redirectTargetFor(session.state))
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background lg:flex-row">
      <AdminSidebar email={session.admin.email} />
      <div className="flex-1 overflow-x-hidden">{children}</div>
    </div>
  )
}
