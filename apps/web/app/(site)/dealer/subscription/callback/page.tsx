import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { CallbackClient } from './callback-client'

export const metadata: Metadata = {
  title: 'Confirming your payment',
  robots: { index: false, follow: false },
}

/**
 * Paystack's return URL.
 *
 * The origin is fixed server-side in `initializePayment` and only the path
 * comes from the caller, so this address cannot be pointed at another site —
 * an open redirect here would let an attacker send a dealer through a genuine
 * checkout and land them on a convincing page asking for their password.
 */
export default function PaymentCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[70vh] items-center justify-center">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <CallbackClient />
    </Suspense>
  )
}
