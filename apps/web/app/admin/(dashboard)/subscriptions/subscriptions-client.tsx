'use client'

import { useMemo, useState } from 'react'
import { Download, Info, X } from 'lucide-react'
import { AdminPageHeader } from '@/components/admin/page-header'
import { StatusBadge } from '@/components/brand/badges'
import { formatNaira } from '@/lib/marketplace'
import type { AdminSubscription } from '@/lib/repositories/admin-metrics'

type Row = AdminSubscription

/**
 * Subscription ledger — read-only until Paystack is implemented.
 *
 * The prototype shipped "Extend" and "Suspend" buttons that mutated local
 * component state and nothing else. Clicking Extend moved a date on screen, the
 * dealer's subscription was untouched, and a refresh silently reverted it. That
 * is worse than no button: an administrator would reasonably believe they had
 * granted someone another month.
 *
 * Both are removed rather than disabled, because a greyed-out control still
 * implies the capability exists. They return with the Paystack work, when the
 * change has somewhere real to be written.
 *
 * View and Export remain — they only read what is already on screen.
 */
export function SubscriptionsClient({ subscriptions }: { subscriptions: Row[] }) {
  const [viewing, setViewing] = useState<Row | null>(null)

  const { active, revenue, expired, grace } = useMemo(() => {
    const activeRows = subscriptions.filter((s) => s.status === 'active')
    return {
      active: activeRows.length,
      revenue: activeRows.reduce((sum, s) => sum + s.amount, 0),
      expired: subscriptions.filter((s) => s.status === 'expired').length,
      // 'grace' is the contract's term for a lapsed-but-not-yet-cut-off plan.
      // The prototype called this "pending", which is a store status, not a
      // subscription one.
      grace: subscriptions.filter((s) => s.status === 'grace').length,
    }
  }, [subscriptions])

  function exportCsv() {
    const header = ['Store', 'Plan', 'Amount', 'Reference', 'Start', 'Expiry', 'Status']
    const lines = subscriptions.map((s) => [
      s.store, s.plan, s.amount, s.reference ?? '', s.startedAt, s.expiresAt, s.status,
    ])
    const csv = [header, ...lines]
      .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'subscriptions.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <AdminPageHeader
        title="Subscriptions"
        subtitle="Dealer plans and payment records"
        action={
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-2 rounded-xl bg-orange px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-hover"
          >
            <Download className="size-4" />
            Export CSV
          </button>
        }
      />

      <div className="space-y-6 p-5 sm:p-8">
        <div className="flex gap-2 rounded-2xl bg-warning/10 p-4 text-xs leading-relaxed text-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-warning" />
          Paystack is not connected yet, so every dealer is on the free plan and no payment has been
          recorded. This table is read-only until it is.
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <SummaryCard label="Active Subscriptions" value={String(active)} />
          <SummaryCard label="Recognized Revenue" value={formatNaira(revenue)} />
          <SummaryCard label="Expired" value={String(expired)} />
          <SummaryCard label="In Grace Period" value={String(grace)} />
        </div>

        {subscriptions.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
            No dealer stores yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border bg-warm text-left text-xs font-semibold text-muted-foreground">
                  <th className="px-4 py-3">Store</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Paystack Reference</th>
                  <th className="px-4 py-3">Start Date</th>
                  <th className="px-4 py-3">Expiration</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3 font-semibold text-foreground">{s.store}</td>
                    <td className="px-4 py-3 capitalize text-muted-foreground">{s.plan}</td>
                    <td className="px-4 py-3 text-foreground">{formatNaira(s.amount)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {s.reference ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{s.startedAt}</td>
                    <td className="px-4 py-3 text-muted-foreground">{s.expiresAt}</td>
                    <td className="px-4 py-3">
                      <SubscriptionStatusBadge status={s.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => setViewing(s)}
                          className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
                        >
                          View
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewing && <DetailsModal row={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

/** Maps the contract's subscription status onto the shared badge vocabulary. */
function SubscriptionStatusBadge({ status }: { status: Row['status'] }) {
  const mapped = status === 'active' ? 'active' : status === 'grace' ? 'pending' : 'archived'
  return <StatusBadge status={mapped} />
}

function DetailsModal({ row, onClose }: { row: Row; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Subscription details for ${row.store}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-heading text-lg font-bold text-foreground">{row.store}</h2>
            <p className="mt-1 text-sm capitalize text-muted-foreground">{row.plan} plan</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X className="size-5" />
          </button>
        </div>

        <dl className="mt-5 space-y-3 text-sm">
          <DetailRow label="Amount" value={formatNaira(row.amount)} />
          <DetailRow label="Paystack Reference" value={row.reference ?? '—'} mono />
          <DetailRow label="Start Date" value={row.startedAt} />
          <DetailRow label="Expiration" value={row.expiresAt} />
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <SubscriptionStatusBadge status={row.status} />
            </dd>
          </div>
        </dl>

        <button
          onClick={onClose}
          className="mt-6 w-full rounded-xl bg-orange px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-hover"
        >
          Close
        </button>
      </div>
    </div>
  )
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-xs text-foreground' : 'font-medium text-foreground'}>{value}</dd>
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 font-heading text-xl font-bold text-foreground">{value}</p>
    </div>
  )
}
