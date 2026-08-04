'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu, X, Search } from 'lucide-react'
import { Logo } from '@/components/brand/logo'

const links = [
  { href: '/parts', label: 'Browse Parts' },
  { href: '/stores', label: 'Dealers' },
  { href: '/about', label: 'How it works' },
  { href: '/plans', label: 'Sell on NPH' },
]

export function SiteHeader() {
  const [open, setOpen] = useState(false)
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" aria-label="NPH home">
          <Logo variant="light" size={36} withWordmark />
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-orange"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Link
            href="/parts"
            aria-label="Search parts"
            className="inline-flex size-9 items-center justify-center rounded-full text-foreground hover:bg-muted"
          >
            <Search className="size-5" />
          </Link>
          <Link
            href="/app"
            className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:border-orange/40"
          >
            Get the app
          </Link>
          <Link
            href="/dealer/login"
            className="rounded-xl bg-orange px-4 py-2 text-sm font-semibold text-white hover:bg-orange-hover"
          >
            Sell your parts
          </Link>
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
          className="inline-flex size-9 items-center justify-center rounded-lg text-foreground hover:bg-muted md:hidden"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-border bg-card md:hidden">
          <nav className="flex flex-col px-4 py-2">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="border-b border-border py-3 text-sm font-medium text-foreground last:border-0"
              >
                {l.label}
              </Link>
            ))}
            <div className="flex gap-2 py-3">
              <Link
                href="/app"
                className="flex-1 rounded-xl border border-border bg-card px-4 py-2 text-center text-sm font-semibold text-foreground"
              >
                Get the app
              </Link>
              <Link
                href="/dealer/login"
                className="flex-1 rounded-xl bg-orange px-4 py-2 text-center text-sm font-semibold text-white"
              >
                Sell parts
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
