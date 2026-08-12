'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { AlertTriangle, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'
import { auth, functions } from '@/lib/firebase-client'

/**
 * Where Paystack returns the dealer after checkout.
 *
 * This page asks our own backend what happened rather than believing the query
 * string. Paystack appends `?reference=`, and a return URL is trivially
 * forgeable — anyone can visit this path with any reference. `verifyPayment`
 * re-checks with Paystack's API, confirms the dealer owns that reference, and
 * only then reports success.
 *
 * It also races the webhook, deliberately. Paystack fires the webhook the
 * instant the charge clears, often before the browser finishes redirecting, so
 * by the time this runs the subscription may already be active. That is why
 * `already-applied` is reported as success rather than as an error: from the
 * dealer's side the payment worked, and the only difference is which path got
 * there first.
 */
const DATE = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })

type Result =
  | { state: 'checking' }
  | { state: 'success'; expiresAt: string | null }
  | { state: 'pending' }
  | { state: 'failed'; message: string }
  | { state: 'needs-support'; message: string }
  | { state: 'no-reference' }

export function CallbackClient() {
  const params = useSearchParams()
  const reference = params.get('reference') ?? params.get('trxref')
  // Derived at first render rather than set from inside the effect. Whether a
  // reference is present is known before anything asynchronous happens, so
  // setting it in an effect would render "checking" for a frame and then
  // correct itself — a flash of the wrong answer, and a cascading render.
  const [result, setResult] = useState<Result>(
    reference ? { state: 'checking' } : { state: 'no-reference' },
  )

  useEffect(() => {
    if (!reference) return

    // Waits for the session to resolve rather than firing immediately: the
    // Firebase SDK restores the signed-in user asynchronously, and calling a
    // callable in that window fails as unauthenticated for a dealer who is
    // perfectly well signed in.
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setResult({
          state: 'failed',
          message: 'Your session ended during checkout. Sign in again to see your payment.',
        })
        return
      }

      try {
        const res = await httpsCallable<
          { reference: string },
          { status: string; expiresAt: string | null }
        >(
          functions,
          'verifyPayment',
        )({ reference })

        if (res.data.status === 'success') {
          setResult({ state: 'success', expiresAt: res.data.expiresAt })
        } else if (res.data.status === 'pending') {
          setResult({ state: 'pending' })
        } else {
          setResult({
            state: 'failed',
            message: 'That payment did not go through. You have not been charged.',
          })
        }
      } catch (e) {
        const message = (e as { message?: string })?.message ?? ''
        // The amount-mismatch path: Paystack took the money and the plan was
        // not applied. Distinguished from a failure because it is neither, and
        // telling a dealer "payment failed" would contradict their bank alert.
        if (/amount/i.test(message)) {
          setResult({ state: 'needs-support', message })
        } else {
          setResult({
            state: 'failed',
            message: message || 'We could not confirm that payment. Please contact support.',
          })
        }
      }
    })
  }, [reference])

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 py-12 text-center">
      {result.state === 'checking' && (
        <>
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <h1 className="mt-6 font-heading text-xl font-semibold text-foreground">
            Confirming your payment
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This takes a moment. Please do not close this page.
          </p>
        </>
      )}

      {result.state === 'success' && (
        <>
          <Badge tone="success">
            <CheckCircle2 className="size-7" />
          </Badge>
          <h1 className="mt-6 font-heading text-xl font-semibold text-foreground">
            Payment received — your plan is active
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            You can now publish up to 200 active listings.
            {result.expiresAt
              ? ` Your plan runs until ${DATE.format(new Date(result.expiresAt))}.`
              : ''}
          </p>
        </>
      )}

      {result.state === 'pending' && (
        <>
          <Badge tone="neutral">
            <Clock className="size-7" />
          </Badge>
          <h1 className="mt-6 font-heading text-xl font-semibold text-foreground">
            Payment not completed
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            We have not received this payment. If you did complete it, it can take a minute to
            arrive — reopen your subscription page shortly and it will show there.
          </p>
        </>
      )}

      {result.state === 'failed' && (
        <>
          <Badge tone="neutral">
            <XCircle className="size-7" />
          </Badge>
          <h1 className="mt-6 font-heading text-xl font-semibold text-foreground">
            Payment not completed
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{result.message}</p>
        </>
      )}

      {result.state === 'needs-support' && (
        <>
          <Badge tone="error">
            <AlertTriangle className="size-7" />
          </Badge>
          <h1 className="mt-6 font-heading text-xl font-semibold text-foreground">
            Payment received, but not applied
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Your payment went through, but we could not apply it to your plan automatically. Nothing
            is lost. Contact support with the reference below and we will apply it manually.
          </p>
          {reference && (
            <p className="mt-3 rounded-xl border border-border bg-card px-4 py-2 font-mono text-xs">
              {reference}
            </p>
          )}
        </>
      )}

      {result.state === 'no-reference' && (
        <>
          <Badge tone="neutral">
            <XCircle className="size-7" />
          </Badge>
          <h1 className="mt-6 font-heading text-xl font-semibold text-foreground">
            Nothing to confirm
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This page confirms a payment after checkout, and no payment reference was provided.
          </p>
        </>
      )}

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/dealer/subscription"
          className="inline-flex h-11 items-center justify-center rounded-xl bg-orange px-6 text-sm font-semibold text-white transition-colors hover:bg-orange-hover"
        >
          Back to my subscription
        </Link>
        {(result.state === 'needs-support' || result.state === 'failed') && (
          <Link
            href="/contact"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-border px-6 text-sm font-semibold text-foreground hover:bg-muted"
          >
            Contact support
          </Link>
        )}
      </div>
    </div>
  )
}

function Badge({
  tone,
  children,
}: {
  tone: 'success' | 'neutral' | 'error'
  children: React.ReactNode
}) {
  const styles = {
    success: 'bg-success/10 text-success',
    neutral: 'bg-muted text-muted-foreground',
    error: 'bg-error/10 text-error',
  }[tone]
  return (
    <span className={`inline-flex size-16 items-center justify-center rounded-2xl ${styles}`}>
      {children}
    </span>
  )
}
