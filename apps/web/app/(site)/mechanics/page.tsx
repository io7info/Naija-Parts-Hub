import Link from 'next/link'
import { MapPin, Wrench, ChevronRight } from 'lucide-react'
import { MECHANIC_SPECIALTIES } from '@nph/contracts'

import { VerifiedBadge } from '@/components/brand/badges'
import { StoreInitials } from '@/components/brand/store-card'
import { listMechanicStates, listPublicMechanics } from '@/lib/repositories/marketplace'

/**
 * Rendered per request, not prerendered — same reasoning as the dealer
 * directory: prerendering would need production credentials at build time, and
 * a directory baked at build time is stale the moment a mechanic is approved.
 */
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Auto Mechanics — Naija Parts Hub',
  description:
    'Find verified auto mechanics across Nigeria by service and location. ' +
    'Engine, transmission, brakes, auto electrical, AC repair and more.',
  alternates: { canonical: '/mechanics' },
}

export default async function MechanicsPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; state?: string }>
}) {
  const { service, state } = await searchParams

  const [mechanics, states] = await Promise.all([
    listPublicMechanics({ service, state }),
    listMechanicStates(),
  ])

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground sm:text-3xl">
          Auto Mechanics
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Verified mechanics and workshops across Nigeria. Every listed mechanic has had their
          identity checked before approval. Contact them directly — Naija Parts Hub does not take
          a commission or handle payment for repairs.
        </p>
      </header>

      {/* Service filter. Ids go in the URL, labels on screen: a wording change
          must not orphan every link already shared. */}
      <nav className="mt-6 flex flex-wrap gap-2" aria-label="Filter by service">
        <FilterChip href="/mechanics" active={!service} label="All services" />
        {MECHANIC_SPECIALTIES.map((s) => (
          <FilterChip
            key={s.id}
            href={`/mechanics?service=${s.id}${state ? `&state=${encodeURIComponent(state)}` : ''}`}
            active={service === s.id}
            label={s.label}
          />
        ))}
      </nav>

      {states.length > 0 && (
        <nav className="mt-3 flex flex-wrap gap-2" aria-label="Filter by state">
          <FilterChip
            href={service ? `/mechanics?service=${service}` : '/mechanics'}
            active={!state}
            label="All states"
          />
          {states.map((s) => (
            <FilterChip
              key={s}
              href={`/mechanics?state=${encodeURIComponent(s)}${service ? `&service=${service}` : ''}`}
              active={state === s}
              label={s}
            />
          ))}
        </nav>
      )}

      {mechanics.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No mechanics match this filter yet.{' '}
          <Link href="/mechanics" className="text-primary hover:underline">
            Show all mechanics
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mechanics.map((m) => (
            <li key={m.slug}>
              <Link
                href={`/mechanic/${m.slug}`}
                className="flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-colors hover:border-orange/40"
              >
                <div className="flex items-center gap-3">
                  <StoreInitials name={m.name} size={48} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h2 className="font-heading text-base font-semibold text-foreground">
                        {m.name}
                      </h2>
                      {m.verified && <VerifiedBadge />}
                    </div>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3.5 shrink-0 text-orange" />
                      {m.location}
                    </p>
                  </div>
                </div>

                {m.services.length > 0 && (
                  <ul className="mt-4 flex flex-wrap gap-1.5">
                    {/* Three, then a count. A workshop offering everything
                        would otherwise make every card a different height. */}
                    {m.services.slice(0, 3).map((s) => (
                      <li
                        key={s}
                        className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
                      >
                        {s}
                      </li>
                    ))}
                    {m.services.length > 3 && (
                      <li className="px-1 py-1 text-xs text-muted-foreground">
                        +{m.services.length - 3} more
                      </li>
                    )}
                  </ul>
                )}

                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-orange">
                  View profile <ChevronRight className="size-4" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-10 flex items-center gap-2 rounded-2xl border border-border bg-warm p-5 text-sm text-muted-foreground">
        <Wrench className="size-4 shrink-0 text-orange" />
        Are you a mechanic? Register in the Naija Parts Hub app to advertise your services.
      </p>
    </div>
  )
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'rounded-full bg-orange px-3 py-1.5 text-xs font-semibold text-white'
          : 'rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-orange/40'
      }
    >
      {label}
    </Link>
  )
}
