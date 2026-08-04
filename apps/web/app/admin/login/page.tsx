import type { Metadata } from 'next'
import { AdminLoginForm } from './login-form'

export const metadata: Metadata = {
  title: 'Admin Sign In',
  // The admin console must never be indexed.
  robots: { index: false, follow: false },
}

/**
 * `reason` explains why the admin landed back here. Without it, an expired
 * session looks identical to a random sign-out, which is the kind of silent
 * failure that generates support calls.
 */
const NOTICES: Record<string, string> = {
  expired: 'Your session has expired. Please sign in again.',
  revoked: 'Your session was ended for security reasons. Please sign in again.',
  invalid: 'Your session could not be verified. Please sign in again.',
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason } = await searchParams
  const notice = reason ? NOTICES[reason] : undefined

  return (
    <main className="flex min-h-dvh items-center justify-center bg-dark px-4 py-10">
      <AdminLoginForm notice={notice} />
    </main>
  )
}
