import Link from 'next/link'
import {
  Search,
  Store as StoreIcon,
  MessageCircle,
  Handshake,
  ShieldCheck,
  MapPinned,
  Wrench,
  ArrowRight,
} from 'lucide-react'
import { CategoryCard } from '@/components/brand/ui-bits'
import { ProductCard } from '@/components/brand/product-card'
import { StoreCard } from '@/components/brand/store-card'
import { HeroSearch } from '@/components/web/hero-search'
import { categoryIcon } from '@/lib/marketplace'
import { listCategories } from '@/lib/repositories/categories'
import { listPublicListings, listPublicStores } from '@/lib/repositories/marketplace'

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

const steps = [
  { icon: Search, title: 'Search for a part', desc: 'Filter by part name, vehicle, category, condition and location.' },
  { icon: StoreIcon, title: 'Find a verified seller', desc: 'Browse listings from approved physical stores across Nigeria.' },
  { icon: MessageCircle, title: 'Contact the seller directly', desc: 'Reach the dealer instantly on WhatsApp or by phone.' },
  { icon: Handshake, title: 'Arrange payment & delivery', desc: 'Negotiate price, pickup or delivery directly with the seller.' },
]

const trust = [
  { icon: ShieldCheck, title: 'Verified Physical Stores', desc: 'Every dealer has an approved, real store location in Nigeria.' },
  { icon: MessageCircle, title: 'Direct Seller Contact', desc: 'No middlemen — talk to sellers directly on WhatsApp or phone.' },
  { icon: MapPinned, title: 'Nationwide Discovery', desc: 'Find parts from Lagos to Kano and everywhere in between.' },
  { icon: Wrench, title: 'Automotive-Only Marketplace', desc: 'Focused purely on vehicle, machinery and equipment parts.' },
]

export default async function WebHomePage() {
  // Eight newest live listings and the busiest verified stores. Both queries
  // filter on backend-maintained flags, so an unapproved dealer can never
  // surface here regardless of what they write to their own document.
  const [listings, stores, categories] = await Promise.all([
    listPublicListings({ limit: 8 }),
    listPublicStores(6),
    listCategories(),
  ])
  const products = listings.products

  return (
    <>
      {/* Hero */}
      <section className="relative isolate overflow-hidden border-b border-border bg-warm">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-cover bg-center"
          style={{ backgroundImage: 'url(/images/hero-auto-parts.png)' }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-gradient-to-r from-warm via-warm/95 to-warm/60"
        />
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-full bg-orange/10 px-3 py-1 text-xs font-semibold text-orange">
              <ShieldCheck className="size-3.5" />
              Verified dealers only
            </span>
            <h1 className="mt-4 text-balance font-heading text-4xl font-bold leading-tight text-foreground sm:text-5xl">
              Find Automotive Parts Anywhere in Nigeria
            </h1>
            <p className="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              Search verified physical stores for car, motorcycle, truck, tractor, and heavy-equipment parts.
            </p>
          </div>
          <div className="mt-8 max-w-4xl">
            <HeroSearch />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <span>Popular:</span>
            <Link href="/parts?q=brake%20pad" className="font-medium text-foreground hover:text-orange">
              Brake pads
            </Link>
            <Link href="/parts?q=alternator" className="font-medium text-foreground hover:text-orange">
              Alternators
            </Link>
            <Link href="/parts?q=clutch" className="font-medium text-foreground hover:text-orange">
              Clutch plates
            </Link>
            <Link href="/parts?q=hydraulic" className="font-medium text-foreground hover:text-orange">
              Hydraulic pumps
            </Link>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="font-heading text-2xl font-semibold text-foreground">Shop by part category</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The same categories dealers file their parts under.
            </p>
          </div>
          <Link href="/parts" className="hidden text-sm font-semibold text-orange hover:text-orange-hover sm:inline">
            View all parts
          </Link>
        </div>
        {/* Eight categories, so four across rather than the six the vehicle-type
            tiles used — two even rows beat one row of eight narrow tiles. */}
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-4">
          {categories.map((c) => (
            <CategoryCard
              key={c.categoryId}
              label={c.name}
              icon={categoryIcon(c.categoryId)}
              href={`/parts?category=${c.categoryId}`}
            />
          ))}
        </div>
      </section>

      {/* Featured listings */}
      <section className="bg-warm">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="font-heading text-2xl font-semibold text-foreground">Featured Listings</h2>
              <p className="mt-1 text-sm text-muted-foreground">Fresh parts from verified stores across Nigeria.</p>
            </div>
            <Link href="/parts" className="hidden text-sm font-semibold text-orange hover:text-orange-hover sm:inline">
              See all
            </Link>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} href={`/parts/${p.id}`} />
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6">
        <div className="text-center">
          <h2 className="font-heading text-2xl font-semibold text-foreground sm:text-3xl">How it works</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            Naija Parts Hub connects buyers and sellers. Payment, delivery and warranty are arranged directly
            with the seller.
          </p>
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => {
            const Icon = s.icon
            return (
              <div key={s.title} className="relative rounded-2xl border border-border bg-card p-6">
                <span className="inline-flex size-12 items-center justify-center rounded-xl bg-orange/10 text-orange">
                  <Icon className="size-6" />
                </span>
                <span className="absolute right-5 top-5 font-heading text-2xl font-bold text-border">
                  {i + 1}
                </span>
                <h3 className="mt-4 font-heading text-base font-semibold text-foreground">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* Verified stores */}
      <section className="bg-warm">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="font-heading text-2xl font-semibold text-foreground">Verified Stores</h2>
              <p className="mt-1 text-sm text-muted-foreground">Approved automotive dealers with physical locations.</p>
            </div>
            <Link href="/stores" className="hidden text-sm font-semibold text-orange hover:text-orange-hover sm:inline">
              View all stores
            </Link>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stores.map((s) => (
              <StoreCard key={s.slug} store={s} href={`/store/${s.slug}`} />
            ))}
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {trust.map((t) => {
            const Icon = t.icon
            return (
              <div key={t.title} className="flex flex-col items-start">
                <span className="inline-flex size-12 items-center justify-center rounded-xl bg-dark text-orange">
                  <Icon className="size-6" />
                </span>
                <h3 className="mt-4 font-heading text-base font-semibold text-foreground">{t.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t.desc}</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* Sell CTA */}
      <section id="sell" className="scroll-mt-20 bg-dark">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-14 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <h2 className="text-balance font-heading text-2xl font-bold text-white sm:text-3xl">
              Grow your automotive store
            </h2>
            <p className="mt-3 text-pretty text-sm leading-relaxed text-white/70 sm:text-base">
              List up to 10 products for free. Upgrade to a subscription when your business needs more
              visibility. Buyers reach you directly on WhatsApp — no commissions, no middlemen.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/dealer/login"
              className="inline-flex items-center gap-2 rounded-xl bg-orange px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-orange-hover"
            >
              Register your store
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/dealer/subscription"
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              View plans
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
