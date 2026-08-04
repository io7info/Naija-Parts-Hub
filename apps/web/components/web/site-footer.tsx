import Link from 'next/link'
import { Logo } from '@/components/brand/logo'

const columns = [
  {
    title: 'Marketplace',
    links: [
      { href: '/parts', label: 'Browse Parts' },
      { href: '/stores', label: 'Verified Stores' },
      { href: '/about', label: 'How it works' },
      { href: '/plans', label: 'Dealer Plans' },
    ],
  },
  {
    title: 'For Dealers',
    links: [
      { href: '/dealer/login', label: 'Register Your Store' },
      { href: '/dealer/login', label: 'Dealer Sign In' },
      { href: '/dealer/subscription', label: 'Subscriptions' },
      { href: '/plans', label: 'Sell on NPH' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact' },
      { href: '/terms', label: 'Terms' },
      { href: '/privacy', label: 'Privacy' },
    ],
  },
]

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-dark text-white">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="max-w-xs">
            <Logo variant="dark" size={40} withWordmark />
            <p className="mt-4 text-sm leading-relaxed text-white/60">
              Nigeria&apos;s automotive-parts marketplace connecting buyers with verified physical stores.
              Contact sellers directly by phone or WhatsApp.
            </p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <h3 className="font-heading text-sm font-semibold text-white">{col.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-sm text-white/60 transition-colors hover:text-orange">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-white/10 pt-6 text-xs text-white/40 sm:flex-row sm:items-center sm:justify-between">
          <p>Operated by Lytod Motors Ltd · RC 1207675</p>
          <p>© 2026 Naija Parts Hub. Automotive-only marketplace.</p>
        </div>
      </div>
    </footer>
  )
}
