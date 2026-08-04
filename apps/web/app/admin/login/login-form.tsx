'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mail, Lock, AlertCircle, Loader2 } from 'lucide-react'

import { Logo } from '@/components/brand/logo'
import { signInAdmin } from '@/lib/admin-login'
import { auth, useEmulators } from '@/lib/firebase-client'

/**
 * Administrator sign-in — approved design, real authentication.
 *
 * Two steps, and the second is the one that matters:
 *
 *   1. Firebase signs the user in and issues an ID token.
 *   2. POST it to /api/admin/session, which verifies the token AND the
 *      super_admin claim server-side before setting an httpOnly cookie.
 *
 * Step 1 alone proves nothing — anyone with a Firebase account in this project
 * can complete it. Authorisation happens on the server in step 2, so a
 * non-admin never receives an admin session cookie.
 *
 * On rejection we sign out of the client SDK too, so a non-admin is not left
 * holding half a session that makes the UI behave oddly.
 */
export function AdminLoginForm({ notice }: { notice?: string }) {
  const router = useRouter()
  const [email, setEmail] = useState(useEmulators ? 'admin@lytodmotors.test' : '')
  const [password, setPassword] = useState(useEmulators ? 'password123' : '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    // The exchange itself lives in lib/admin-login so it can be tested without
    // a DOM. This handler owns only presentation and navigation.
    const result = await signInAdmin(auth, email, password)

    if (!result.ok) {
      setError(result.message)
      setBusy(false)
      return
    }

    // Navigate only after the server has set the session cookie. refresh()
    // re-runs the server layout so it sees that cookie.
    router.replace('/admin/overview')
    router.refresh()
    setBusy(false)
  }

  return (
    <div className="w-full max-w-sm">
      <div className="flex flex-col items-center text-center">
        <Logo variant="dark" size={56} />
        <h1 className="mt-5 font-heading text-2xl font-bold text-white">Admin Console</h1>
        <p className="mt-1 text-sm text-white/60">
          Sign in to manage the Naija Parts Hub marketplace.
        </p>
      </div>

      {notice && (
        <p className="mt-6 flex gap-2 rounded-xl border border-orange/30 bg-orange/10 p-3 text-xs leading-relaxed text-orange">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{notice}</span>
        </p>
      )}

      <form className="mt-6 rounded-2xl border border-white/10 bg-soft-black p-6" onSubmit={handleSubmit}>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-white/80">Email</span>
          <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-dark px-3 py-2.5">
            <Mail className="size-4 text-white/40" />
            <input
              type="email"
              name="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@lytodmotors.com"
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/40"
            />
          </div>
        </label>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-sm font-medium text-white/80">Password</span>
          <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-dark px-3 py-2.5">
            <Lock className="size-4 text-white/40" />
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/40"
            />
          </div>
        </label>

        <div className="mt-3 flex items-center justify-between text-sm">
          <label className="flex items-center gap-2 text-white/70">
            <input type="checkbox" name="remember" className="size-4 accent-orange" defaultChecked />
            Remember me
          </label>
          <button type="button" className="font-semibold text-orange hover:text-orange-hover">
            Forgot password?
          </button>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-orange py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-orange-hover disabled:opacity-60"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? 'Signing in…' : 'Sign In'}
        </button>

        {error && (
          <p className="mt-4 flex gap-2 rounded-xl border border-orange/30 bg-orange/10 p-3 text-xs leading-relaxed text-orange">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </p>
        )}

        {useEmulators && (
          <p className="mt-4 text-center text-[11px] text-white/30">
            Emulator: seed an admin with <code className="text-white/50">npm run seed</code>
          </p>
        )}
      </form>

      <p className="mt-6 text-center text-xs text-white/40">
        Operated by Lytod Motors Ltd · Authorized personnel only
      </p>
    </div>
  )
}
