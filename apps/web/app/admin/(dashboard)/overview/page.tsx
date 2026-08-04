import { requireAdmin } from '@/lib/admin-session'
import { AdminPageHeader } from '@/components/admin/page-header'
import { BarChart, DonutChart } from '@/components/admin/charts'
import { cn } from '@/lib/utils'
import { getAdminOverview } from '@/lib/repositories/admin-metrics'

// The prototype coloured each stat with an up/down delta. Real deltas need a
// historical snapshot nothing records yet, so the hint is a plain factual
// subtitle in neutral text rather than a fabricated trend arrow.
const toneStyles: Record<string, string> = {
  neutral: 'text-muted-foreground',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
}

// See requireAdmin() — the layout gate cannot stop this page rendering into
// the redirect body, because Next renders layout and page concurrently.
export default async function AdminOverviewPage() {
  await requireAdmin()

  // Derived from the stores and listings collections on each request rather
  // than from stored counters, so the figures cannot drift from the records an
  // administrator is about to act on.
  const {
    stats,
    newStoresByMonth,
    listingsByCategory,
    subscriptionBreakdown,
    recentActivity,
  } = await getAdminOverview()

  return (
    <div>
      <AdminPageHeader title="Overview" subtitle="Marketplace health at a glance" />

      <div className="space-y-6 p-5 sm:p-8">
        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-card p-5">
              <p className="text-sm text-muted-foreground">{s.label}</p>
              <p className="mt-2 font-heading text-2xl font-bold text-foreground">{s.value}</p>
              <p className={cn('mt-1 text-xs font-medium', toneStyles.neutral)}>{s.hint}</p>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-heading text-base font-semibold text-foreground">New stores by month</h2>
            <p className="text-xs text-muted-foreground">Approved dealer stores, last 6 months</p>
            <div className="mt-5">
              <BarChart data={newStoresByMonth} valueKey="value" labelKey="label" />
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-heading text-base font-semibold text-foreground">Subscription breakdown</h2>
            <p className="text-xs text-muted-foreground">Distribution of active dealer plans</p>
            <div className="mt-5">
              <DonutChart data={subscriptionBreakdown.map((d) => ({ name: d.label, value: d.value }))} />
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-heading text-base font-semibold text-foreground">Listings by category</h2>
            <p className="text-xs text-muted-foreground">Active listings across the marketplace</p>
            <div className="mt-5">
              <BarChart
                data={listingsByCategory}
                valueKey="value"
                labelKey="label"
                formatValue={(v) => v.toLocaleString('en-NG')}
              />
            </div>
          </div>

          {/* Recent activity */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-heading text-base font-semibold text-foreground">Recent activity</h2>
            <ul className="mt-4 space-y-4">
              {recentActivity.map((a, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-orange" />
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{a.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {a.when} · {a.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
