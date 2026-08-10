import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronRight, MapPin, Info } from 'lucide-react'
import { ProductGallery } from '@/components/web/product-gallery'
import { VerifiedBadge, ConditionBadge } from '@/components/brand/badges'
import { WhatsAppButton, CallButton, ShareButton } from '@/components/brand/contact-buttons'
import { StoreInitials } from '@/components/brand/store-card'
import { ProductCard } from '@/components/brand/product-card'
import { formatNaira } from '@/lib/marketplace'
import {
  getPublicListing,
  getPublicStore,
  listPublicListings,
} from '@/lib/repositories/marketplace'

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

export default async function WebProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  // Re-checks publiclyVisible on this single-document path: a removed or
  // suspended listing must 404 rather than stay reachable by its URL.
  const product = await getPublicListing(slug)
  if (!product) notFound()

  const [storeResult, sameCategory] = await Promise.all([
    getPublicStore(product.storeSlug),
    listPublicListings({ categoryId: product.category, limit: 5 }),
  ])
  const store = storeResult?.store ?? null
  const relatedList = sameCategory.products.filter((p) => p.id !== product.id).slice(0, 4)

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <Link href="/" className="hover:text-orange">
          Home
        </Link>
        <ChevronRight className="size-3" />
        <Link href="/parts" className="hover:text-orange">
          Parts
        </Link>
        <ChevronRight className="size-3" />
        <span className="text-foreground">{product.category}</span>
      </nav>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1.1fr_1fr]">
        <ProductGallery images={product.images} name={product.name} />

        <div>
          <div className="flex items-center gap-2">
            <ConditionBadge condition={product.condition} />
            {product.inStock && <span className="text-xs font-semibold text-success">In Stock</span>}
          </div>
          <h1 className="mt-2 text-balance font-heading text-2xl font-bold text-foreground sm:text-3xl">
            {product.name}
          </h1>
          <p className="mt-2 font-heading text-3xl font-bold text-orange">{formatNaira(product.price)}</p>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="size-4" />
            {product.location} · Posted {product.postedLabel}
          </p>

          {/* Specs */}
          <dl className="mt-6 grid grid-cols-2 gap-4 rounded-2xl border border-border bg-warm p-5 text-sm">
            <Spec label="Part Number" value={product.partNumber} />
            <Spec label="Category" value={product.category} />
            <Spec label="Compatible Vehicles" value={product.compatible} span />
          </dl>

          {/* Actions */}
          <div className="mt-6 flex flex-wrap gap-3">
            <WhatsAppButton
              phone={product.storeWhatsapp || product.storePhone}
              message={`Hello, is "${product.name}" still available on Naija Parts Hub?`}
              className="flex-1"
            />
            <CallButton phone={product.storePhone} className="flex-1" />
          </div>
          <div className="mt-3 flex gap-3">
            <Link
              href={`/store/${product.storeSlug}`}
              className="flex-1 rounded-xl border border-border py-2.5 text-center text-sm font-semibold text-foreground transition-colors hover:bg-muted"
            >
              View Store
            </Link>
            <ShareButton title={product.name} text={`${product.name} — ${formatNaira(product.price)}`} label="Share" />
          </div>

          {/* Notice */}
          <div className="mt-6 flex gap-2 rounded-2xl bg-warning/10 p-4 text-xs leading-relaxed text-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-warning" />
            Naija Parts Hub connects buyers and sellers. Payment, delivery, warranty, and product compatibility are
            arranged directly with the seller.
          </div>
        </div>
      </div>

      {/* Description + seller */}
      <div className="mt-10 grid gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <h2 className="font-heading text-lg font-semibold text-foreground">Description</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{product.description}</p>
        </div>
        {store && (
          <div>
            <h2 className="font-heading text-lg font-semibold text-foreground">Seller</h2>
            <Link
              href={`/store/${store.slug}`}
              className="mt-2 flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-orange/40"
            >
              <StoreInitials name={store.name} size={56} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-semibold text-foreground">{store.name}</p>
                  {store.verified && <VerifiedBadge compact />}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{store.address}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {store.activeListings} active listings · Member since {store.memberSince}
                </p>
              </div>
              <ChevronRight className="size-5 text-muted-foreground" />
            </Link>
          </div>
        )}
      </div>

      {/* Related */}
      <div className="mt-12">
        <h2 className="font-heading text-xl font-semibold text-foreground">Related parts</h2>
        <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
          {relatedList.map((p) => (
            <ProductCard key={p.id} product={p} href={`/parts/${p.id}`} />
          ))}
        </div>
      </div>
    </div>
  )
}

function Spec({ label, value, span }: { label: string; value: string; span?: boolean }) {
  return (
    <div className={span ? 'col-span-2' : ''}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-semibold text-foreground">{value}</dd>
    </div>
  )
}
