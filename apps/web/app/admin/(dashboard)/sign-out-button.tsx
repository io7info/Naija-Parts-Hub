'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from 'firebase/auth'
import { LogOut } from 'lucide-react'

import { auth } from '@/lib/firebase-client'

/**
 * Signs out of both halves of the session.
 *
 * Two things have to be cleared, and forgetting either leaves a confusing
 * half-signed-in state:
 *   - the httpOnly session cookie, which only the server can delete
 *   - the client SDK's own credentials, which only the browser can clear
 */
export function SignOutButton({
  label = 'Sign out',
  className,
}: {
  label?: string
  className?: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function handleSignOut() {
    setBusy(true)
    try {
      await fetch('/api/admin/session', { method: 'DELETE' })
      await signOut(auth).catch(() => {})
      // refresh() re-runs the server layout, which now sees no cookie and
      // redirects. push() alone could render a cached authorised shell.
      router.replace('/admin/login')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={busy}
      className={
        className ??
        'inline-flex items-center gap-2 rounded-xl bg-orange px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-hover disabled:opacity-60'
      }
    >
      <LogOut className="size-4" />
      {busy ? 'Signing out…' : label}
    </button>
  )
}
