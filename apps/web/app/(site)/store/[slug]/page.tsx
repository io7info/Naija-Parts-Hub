import { cache } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_DOMAIN } from '@nph/contracts'
import { notFound } from 'next/navigation'
import { MapPin, Phone, CalendarDays, Package, ShieldCheck } from 'lucide-react'
import { VerifiedBadge } from '@/components/brand/badges'
import { WhatsAppButton, CallButton, ShareButton } from '@/components/brand/contact-buttons'
import { StoreInitials } from '@/components/brand/store-card'
import { formatNigerianPhone } from '@/lib/marketplace'
import { getPublicStore } from '@/lib/repositories/marketplace'
import { TrackView } from '@/components/web/track-view'
import { StoreProducts } from './store-products'

/**
 * Rendered per request, not prerendered.
 *
 * Two reasons. Prerendering would run these Firestore reads during
 * `next build`, making the build itself require production credentials for
 * pages it never serves. And a marketplace baked at build time is stale the
 * moment a dealer publishes: a listing would not appear until the next deploy.
 *
 * Revisit with revalidate once traffic justifies caching over freshness.
 */
export const dynamic = 'force-dynamic'

/**
 * One read per request, shared by generateMetadata and the page body.
 * See the same helper in the product page for why.
 */
const loadStore = cache(getPublicStore)

/**
 * Per-storefront metadata.
 *
 * This is the link dealers actually share. The app's My Store screen offers
 * "Share Link" and "Copy Link", and both hand naijapartshub.com/store/{slug}
 * to WhatsApp — where, without this, the preview read "Naija Parts Hub —
 * Automotive Parts Marketplace" instead of the dealer's own business name.
 * A dealer promoting their shop was advertising the platform.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const result = await loadStore(slug)

  if (!result) return { title: 'Store not found' }
  const { store, products } = result

  const path = `/store/${slug}`
  const count = products.length
  const description =
    store.about?.trim() ||
    [
      `${store.name} — verified automotive parts dealer`,
      store.tagline || store.state || null,
      `${count} listing${count === 1 ? '' : 's'} available`,
    ]
      .filter(Boolean)
      .join(' · ')

  return {
    title: store.name,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: store.name,
      description,
      url: path,
      type: 'website',
      // The storefront has no logo of its own, so the first listing photo
      // stands in — a real part beats a generic placeholder in a link preview.
      images: products[0]?.image ? [{ url: products[0].image, alt: store.name }] : undefined,
    },
    twitter: {
      card: products[0]?.image ? 'summary_large_image' : 'summary',
      title: store.name,
      description,
      images: products[0]?.image ? [products[0].image] : undefined,
    },
  }
}

export default async function WebStorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  // getPublicStore filters on status === 'approved' && visible, so a suspended
  // dealer's storefront 404s rather than lingering at a known URL.
  const result = await loadStore(slug)
  if (!result) notFound()
  const { store, products: items } = result

  return (
    <div>
      <TrackView
        event="view_dealer_store"
        params={{
          store_slug: slug,
          verified: store.verified,
          listing_count: items.length,
        }}
      />

      {/*
        No cover banner.

        The design pack drew a full-width dark band here, sized like a cover
        photo. Dealers have no cover image: there is no upload in the app, no
        field on the store document, and nothing in the SOW that adds one. So
        it rendered as an empty near-black rectangle on every storefront —
        shaped like a container for a picture that can never arrive — and it
        pushed the name, the stats and the products below the fold.

        Removed rather than shrunk. A decorative band that holds nothing is
        still holding nothing at half the height, and the page reads better
        without it: the storefront now opens on the dealer's name and their
        parts, which is what a buyer followed the link for.
      */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/*
          Store header.

          `items-center`, not `items-end`: the previous alignment existed to
          stand the avatar on the banner's lower edge, and without the banner it
          left the name hanging below the avatar's midpoint.

          The avatar is 72px rather than 88px and has lost its 4px background
          border. Both were there to punch it out of the dark band; at 88px on
          a plain background it overpowered two lines of text.

          `min-w-0` lets a long business name wrap instead of shunting the
          contact buttons off the right edge, and the name row wraps so the
          verified badge drops under a long name rather than squashing it —
          "Kano Heavy Equipment Parts" is not an unusual length here.

          The bottom border does the separating the banner used to do.
        */}
        <div className="flex flex-col gap-5 border-b border-border pb-6 pt-8 sm:flex-row sm:items-center sm:justify-between sm:pt-10">
          <div className="flex items-center gap-4">
            <StoreInitials name={store.name} size={72} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h1 className="font-heading text-2xl font-bold text-foreground sm:text-3xl">
                  {store.name}
                </h1>
                {store.verified && <VerifiedBadge />}
              </div>
              {/* tagline is `city, state` — see toStore — so it earns the pin. */}
              <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="size-4 shrink-0 text-orange" />
                {store.tagline}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <CallButton
              phone={store.phone}
              label="Call Store"
              size="sm"
              context={{ surface: 'store', storeSlug: slug }}
            />
            <WhatsAppButton
              phone={store.whatsapp || store.phone}
              message={`Hello ${store.name}, I found your store on Naija Parts Hub.`}
              label="WhatsApp Store"
              size="sm"
              context={{ surface: 'store', storeSlug: slug }}
            />
            <ShareButton title={store.name} text={store.tagline} />
          </div>
        </div>

        {/*
          Stats show only what the store document actually holds. The design had
          a star rating and an "Open Today" indicator; there is no ratings system
          and no opening-hours field in the SOW, so both were inventions. A
          fabricated 4.8 next to a verified badge is a trust signal buyers would
          reasonably act on, which makes it the one kind of placeholder that must
          not ship.
        */}
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat icon={Package} label="Active Listings" value={String(store.activeListings)} />
          <Stat icon={ShieldCheck} label="Status" value="Verified dealer" />
          <Stat icon={CalendarDays} label="Member Since" value={store.memberSince} />
          <Stat icon={MapPin} label="Location" value={store.state || '—'} />
        </div>

        <div className="mt-8 grid gap-8 pb-16 lg:grid-cols-[1fr_300px]">
          {/* Products */}
          <div className="order-2 lg:order-1">
            <h2 className="mb-4 font-heading text-lg font-semibold text-foreground">
              Products ({items.length})
            </h2>
            {items.length > 0 ? (
              <StoreProducts items={items} />
            ) : (
              <p className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                This dealer has no live listings right now.
              </p>
            )}
          </div>

          {/* About / contact sidebar */}
          <aside className="order-1 space-y-4 lg:order-2">
            {store.about && (
              <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="font-heading text-base font-semibold text-foreground">About</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{store.about}</p>
              </div>
            )}
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="font-heading text-base font-semibold text-foreground">Contact</h3>
              <ul className="mt-3 space-y-3 text-sm">
                {store.address && (
                  <li className="flex items-start gap-2 text-muted-foreground">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-orange" />
                    {store.address}
                  </li>
                )}
                {store.phone && (
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="size-4 shrink-0 text-orange" />
                    <a href={`tel:+${store.phone.replace(/\D/g, '')}`} className="hover:text-foreground">
                      {formatNigerianPhone(store.phone)}
                    </a>
                  </li>
                )}
              </ul>
            </div>
            {store.categories.length > 0 && (
              <div className="rounded-2xl border border-border bg-card p-5">
                <h3 className="font-heading text-base font-semibold text-foreground">Categories</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {store.categories.map((c) => (
                    <span key={c} className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <p className="px-1 text-xs text-muted-foreground">
              Store URL: {SITE_DOMAIN}/store/{store.slug}
            </p>
            <Link
              href="/stores"
              className="block text-center text-sm font-semibold text-orange hover:text-orange-hover"
            >
              ← Back to all stores
            </Link>
          </aside>
        </div>
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
