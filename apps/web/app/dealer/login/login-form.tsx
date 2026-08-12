'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Phone, ShieldCheck } from 'lucide-react'
import { auth, useEmulators } from '@/lib/firebase-client'
import { RecaptchaVerifier, confirmOtp, requestOtp } from '@/lib/dealer-auth'
import type { ConfirmationResult } from 'firebase/auth'

/**
 * Dealer sign-in, by phone OTP — the same identity the mobile app uses.
 *
 * Two steps in one component rather than two routes: the `ConfirmationResult`
 * Firebase hands back from step one is a live object that cannot survive a
 * navigation, so splitting the pages would mean re-sending the code.
 *
 * The reCAPTCHA verifier is created once, lazily, against a real DOM node.
 * Firebase requires one for every web phone sign-in; in `invisible` mode the
 * dealer never sees it unless Google decides to challenge them.
 */
export function DealerLoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  // Where to go after signing in. A path only — an absolute URL here would let
  // a crafted link bounce a signed-in dealer to another origin.
  const next = params.get('next')?.startsWith('/') ? params.get('next')! : '/dealer/subscription'

  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const captchaRef = useRef<HTMLDivElement>(null)
  const verifierRef = useRef<RecaptchaVerifier | null>(null)

  useEffect(() => {
    return () => {
      // Cleared on unmount, or a fast refresh leaves a stale widget bound to a
      // node that no longer exists and the next attempt throws.
      verifierRef.current?.clear()
      verifierRef.current = null
    }
  }, [])

  async function send() {
    setBusy(true)
    setError(null)

    if (!verifierRef.current && captchaRef.current) {
      verifierRef.current = new RecaptchaVerifier(auth, captchaRef.current, { size: 'invisible' })
    }
    if (!verifierRef.current) {
      setError('Could not start verification. Please reload the page.')
      setBusy(false)
      return
    }

    const result = await requestOtp(auth, phone, verifierRef.current)
    if (result.ok) setConfirmation(result.confirmation)
    else setError(result.message)
    setBusy(false)
  }

  async function verify() {
    if (!confirmation) return
    setBusy(true)
    setError(null)

    const result = await confirmOtp(confirmation, code)
    if (result.ok) {
      // replace, not push: the back button must not return to a sign-in form
      // for a session that already exists.
      router.replace(next)
    } else {
      setError(result.message)
      setBusy(false)
    }
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8">
      <h1 className="text-center font-heading text-xl font-semibold text-foreground">
        {confirmation ? 'Enter your code' : 'Dealer sign in'}
      </h1>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        {confirmation
          ? `We sent a six-digit code to ${phone}.`
          : 'Sign in with the phone number registered to your business.'}
      </p>

      {!confirmation ? (
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Phone number</span>
            <div className="mt-1 flex items-center gap-2 rounded-xl border border-border bg-background px-3">
              <Phone className="size-4 shrink-0 text-muted-foreground" />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                autoComplete="tel"
                placeholder="0803 123 4567"
                className="w-full bg-transparent py-2.5 text-sm outline-none"
              />
            </div>
          </label>

          <button
            type="submit"
            disabled={busy || !phone.trim()}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange text-sm font-semibold text-white transition-colors hover:bg-orange-hover disabled:opacity-60"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Send code
          </button>
        </form>
      ) : (
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void verify()
          }}
        >
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Verification code</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-center font-heading text-lg tracking-[0.4em] outline-none focus:border-orange"
            />
          </label>

          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange text-sm font-semibold text-white transition-colors hover:bg-orange-hover disabled:opacity-60"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Verify and continue
          </button>

          <button
            type="button"
            onClick={() => {
              setConfirmation(null)
              setCode('')
              setError(null)
            }}
            className="w-full text-center text-sm font-semibold text-orange"
          >
            Use a different number
          </button>
        </form>
      )}

      {error && (
        <p className="mt-4 rounded-xl border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}

      <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Listings are managed in the mobile app. Signing in here is for viewing and paying for
          your subscription.
        </span>
      </p>

      {useEmulators && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Emulator mode — use the test number and code from the Auth emulator.
        </p>
      )}

      {/* The invisible reCAPTCHA needs a real element to attach to. */}
      <div ref={captchaRef} />
    </div>
  )
}
