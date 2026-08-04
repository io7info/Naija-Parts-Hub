import type { ReactNode } from 'react'

/**
 * Shared shell for the static content pages (About, Contact, Terms, Privacy).
 *
 * Legal copy is deliberately isolated in the page files that use this shell, so
 * it can be replaced wholesale after professional legal review without touching
 * layout or navigation.
 */
export function LegalPage({
  title,
  intro,
  updated,
  children,
}: {
  title: string
  intro?: string
  updated?: string
  children: ReactNode
}) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:py-16">
      <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold tracking-tight sm:text-4xl">
        {title}
      </h1>
      {intro && <p className="mt-4 text-lg text-muted-foreground">{intro}</p>}
      {updated && (
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {updated}</p>
      )}
      <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-foreground/90">
        {children}
      </div>
    </article>
  )
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-[family-name:var(--font-heading)] text-xl font-semibold">{heading}</h2>
      <div className="space-y-3 text-muted-foreground">{children}</div>
    </section>
  )
}

/** Single source of truth for company details shown across the site. */
export const COMPANY = {
  product: 'Naija Parts Hub',
  operator: 'Lytod Motors Ltd',
  rc: 'RC 1207675',
  address: '50 Olumegbon St, Surulere, Lagos',
  phone: '+234 903 672 6262',
  phoneHref: 'tel:+2349036726262',
  domain: 'naijapartshub.com',
} as const
