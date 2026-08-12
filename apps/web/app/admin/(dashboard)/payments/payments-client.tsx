'use client'

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { AdminPageHeader } from '@/components/admin/page-header'
import { formatNaira } from '@/lib/marketplace'
import { cn } from '@/lib/utils'
import type { AdminPayment } from '@/lib/repositories/admin-metrics'

/**
 * Paystack transaction review — SOW §9.
 *
 * Read-only, deliberately. Nothing here can alter a payment or grant a
 * subscription: activation happens in one transactional path shared by the
 * webhook and the dealer's own verify call, and adding a second, manual writer
 * in the admin portal would be the easiest way to grant two months for one
 * payment.
 *
 * The default view is "needs attention" rather than "all". A payments table is
 * mostly rows nobody will look at again; the ones worth an administrator's time
 * are those where money moved and no plan was granted.
 */
const FILTERS = ['attention', 'all', 'success', 'pending', 'failed'] as const
type Filter = (typeof FILTERS)[number]

const LABEL: Record<Filter, string> = {
  attention: 'Needs attention',
  all: 'All',
  success: 'Successful',
  pending: 'Pending',
  failed: 'Failed',
}

function matches(payment: AdminPayment, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'attention') return payment.needsSupport
  if (filter === 'failed') return payment.status === 'failed' || payment.status === 'abandoned'
  return payment.status === filter
}

export function PaymentsClient({ payments }: { payments: AdminPayment[] }) {
  const [filter, setFilter] = useState<Filter>('attention')

  const rows = payments.filter((p) => matches(p, filter))
  const attention = payments.filter((p) => p.needsSupport).length

  return (
    <div>
      <AdminPageHeader
        title="Payments"
        subtitle="Paystack transactions and how they were applied"
      />

      <div className="p-5 sm:p-8">
        {attention > 0 && (
          <div className="mb-5 flex items-start gap-2 rounded-xl border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              {attention} payment{attention === 1 ? '' : 's'} succeeded at Paystack but{' '}
              {attention === 1 ? 'was' : 'were'} not applied to a subscription. The{' '}
              {attention === 1 ? 'dealer has' : 'dealers have'} been charged.
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-xl border px-3 py-1.5 text-sm font-semibold transition-colors',
                filter === f
                  ? 'border-orange bg-orange/10 text-orange'
                  : 'border-border text-muted-foreground hover:bg-muted',
              )}
            >
              {LABEL[f]} ({payments.filter((p) => matches(p, f)).length})
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            {filter === 'attention'
              ? 'Nothing needs attention. Every successful payment has been applied.'
              : 'No payments in this view.'}
          </p>
        ) : (
          <div className="mt-5 overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Reference</th>
                  <th className="px-4 py-3 font-semibold">Dealer</th>
                  <th className="px-4 py-3 font-semibold">Plan</th>
                  <th className="px-4 py-3 font-semibold">Amount</th>
                  <th className="px-4 py-3 font-semibold">Started</th>
                  <th className="px-4 py-3 font-semibold">Applied</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.reference} className="border-b border-border align-top last:border-0">
                    <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                      {p.reference}
                      {p.channel && <div className="mt-0.5">via {p.channel}</div>}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">{p.store}</td>
                    <td className="px-4 py-3 capitalize text-muted-foreground">{p.plan}</td>
                    <td className="px-4 py-3">{formatNaira(p.amount)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.initializedAt}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {p.verifiedAt ?? '—'}
                      {p.verifiedVia && <div className="mt-0.5 text-[11px]">by {p.verifiedVia}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                          p.needsSupport
                            ? 'bg-error/10 text-error'
                            : p.status === 'success'
                              ? 'bg-success/10 text-success'
                              : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {p.needsSupport ? 'Paid — not applied' : p.status}
                      </span>
                      {p.needsSupport && (
                        <p className="mt-1 max-w-xs text-xs text-error">
                          Usually an amount mismatch, or the store was deleted mid-checkout. Apply
                          manually or refund through the Paystack dashboard.
                        </p>
                      )}
                      {p.paystackStatus && p.paystackStatus !== p.status && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Paystack: {p.paystackStatus}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
