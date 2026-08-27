import { cache } from 'react'
import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CalendarDays, MapPin, Phone, ShieldCheck, Wrench } from 'lucide-react'

import { VerifiedBadge } from '@/components/brand/badges'
import { WhatsAppButton, CallButton, ShareButton } from '@/components/brand/contact-buttons'
import { StoreInitials } from '@/components/brand/store-card'
import { TrackView } from '@/components/web/track-view'
import { formatNigerianPhone } from '@/lib/marketplace'
import { getPublicMechanic } from '@/lib/repositories/marketplace'

/**
 * A mechanic's public profile.
 *
 * DELIBERATELY NOT THE STOREFRONT TEMPLATE.
 *
 * The client's requirement was that a mechanic must not look like a parts
 * dealer, and reusing /store/[slug] with the inventory hidden would have
 * produced exactly that: a shop page with an empty shelf. What a buyer needs
 * here is different — which services, where, is this person verified, and how
 * do I reach them — so the page leads with services and work photographs and
 * has no product grid, no category chips and no price anywhere.
 */
export const dynamic = 'force-dynamic'

/** One read per request, shared by generateMetadata and the body. */
const loadMechanic = cache(getPublicMechanic)

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const mechanic = await loadMechanic(slug)
  if (!mechanic) return { title: 'Mechanic not found' }

  // The services are the searchable substance here, the way a part number is
  // on a listing. A shared link should say what this person actually does.
  const description = [
    mechanic.services.slice(0, 4).join(', ') || 'Auto mechanic',
    `in ${mechanic.location}`,
  ].join(' ')

  return {
    title: mechanic.name,
    description,
    alternates: { canonical: `/mechanic/${slug}` },
    openGraph: {
      title: mechanic.name,
      description,
      url: `/mechanic/${slug}`,
      type: 'profile',
      images: mechanic.photos[0] ? [{ url: mechanic.photos[0], alt: mechanic.name }] : undefined,
    },
    twitter: {
      card: mechanic.photos[0] ? 'summary_large_image' : 'summary',
      title: mechanic.name,
      description,
      images: mechanic.photos[0] ? [mechanic.photos[0]] : undefined,
    },
  }
}

export default async function MechanicProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  // getPublicMechanic filters on approved + visible + businessType, so a
  // suspended or unapproved mechanic 404s rather than lingering at a known URL.
  const mechanic = await loadMechanic(slug)
  if (!mechanic) notFound()

  const contact = { surface: 'store' as const, storeSlug: slug }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <TrackView
        event="view_dealer_store"
        params={{ store_slug: slug, verified: mechanic.verified, business_type: 'mechanic' }}
      />

      <nav className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <Link href="/" className="hover:text-orange">
          Home
        </Link>
        <span>/</span>
        <Link href="/mechanics" className="hover:text-orange">
          Mechanics
        </Link>
      </nav>

      <header className="mt-4 flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <StoreInitials name={mechanic.name} size={72} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="font-heading text-2xl font-bold text-foreground sm:text-3xl">
                {mechanic.name}
              </h1>
              {mechanic.verified && <VerifiedBadge />}
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="size-4 shrink-0 text-orange" />
              {mechanic.location}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <CallButton phone={mechanic.phone} label="Call" size="sm" context={contact} />
          <WhatsAppButton
            phone={mechanic.whatsapp || mechanic.phone}
            message={`Hello ${mechanic.name}, I found your workshop on Naija Parts Hub.`}
            label="WhatsApp"
            size="sm"
            context={contact}
          />
          <ShareButton title={mechanic.name} text={mechanic.services.slice(0, 3).join(', ')} />
        </div>
      </header>

      {/* Identity verification, stated plainly. It is the reason a stranger
          should be willing to hand this person their car — but only the fact
          of it: no last-four digits, no legal name, nothing from the identity
          block, which is admin-only and never reaches public HTML. */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat icon={ShieldCheck} label="Status" value="Identity verified" />
        <Stat icon={Wrench} label="Services" value={String(mechanic.services.length)} />
        <Stat icon={CalendarDays} label="On NPH since" value={mechanic.memberSince} />
      </div>

      <div className="mt-8 grid gap-8 pb-16 lg:grid-cols-[1fr_300px]">
        <div className="order-2 lg:order-1">
          <h2 className="font-heading text-lg font-semibold text-foreground">Services offered</h2>
          {mechanic.services.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {mechanic.services.map((s) => (
                <li
                  key={s}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground"
                >
                  {s}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No services listed yet.</p>
          )}

          <h2 className="mt-8 font-heading text-lg font-semibold text-foreground">
            Workshop &amp; completed work
          </h2>
          {mechanic.photos.length > 0 ? (
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {mechanic.photos.map((src, i) => (
                <li
                  key={src}
                  className="relative aspect-[4/3] overflow-hidden rounded-xl border border-border bg-muted"
                >
                  <Image
                    src={src}
                    // Decorative in aggregate; the heading above names the set.
                    // A per-photo caption would be invented text.
                    alt={`${mechanic.name} — work photo ${i + 1}`}
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 50vw, 33vw"
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
              This mechanic has not added photos yet.
            </p>
          )}
        </div>

        <aside className="order-1 space-y-4 lg:order-2">
          {mechanic.about && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="font-heading text-base font-semibold text-foreground">About</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{mechanic.about}</p>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="font-heading text-base font-semibold text-foreground">Contact</h3>
            <ul className="mt-3 space-y-3 text-sm">
              {mechanic.address && (
                <li className="flex items-start gap-2 text-muted-foreground">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-orange" />
                  {mechanic.address}
                </li>
              )}
              {mechanic.phone && (
                <li className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="size-4 shrink-0 text-orange" />
                  <a
                    href={`tel:+${mechanic.phone.replace(/\D/g, '')}`}
                    className="hover:text-foreground"
                  >
                    {formatNigerianPhone(mechanic.phone)}
                  </a>
                </li>
              )}
            </ul>
          </div>

          {/* Said once, plainly. Repairs are arranged directly, exactly as
              parts are — the platform is an introduction, not an escrow. */}
          <p className="px-1 text-xs text-muted-foreground">
            Payment, parts and warranty are arranged directly with the mechanic. Naija Parts Hub
            does not handle repair payments.
          </p>

          <Link
            href="/mechanics"
            className="block text-center text-sm font-semibold text-orange hover:text-orange-hover"
          >
            ← Back to all mechanics
          </Link>
        </aside>
      </div>
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <Icon className="size-5 text-orange" />
      <p className="mt-2 font-heading text-lg font-bold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}
