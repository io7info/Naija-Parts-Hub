'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard,
  ShieldCheck,
  ListChecks,
  CreditCard,
  Menu,
  X,
} from 'lucide-react'
import { Logo } from '@/components/brand/logo'
import { cn } from '@/lib/utils'
import { SignOutButton } from '@/app/admin/(dashboard)/sign-out-button'

const nav = [
  { href: '/admin/overview', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/verification', label: 'Business Verification', icon: ShieldCheck },
  { href: '/admin/moderation', label: 'Listing Moderation', icon: ListChecks },
  { href: '/admin/subscriptions', label: 'Subscriptions', icon: CreditCard },
]

export function AdminSidebar({ email }: { email?: string | null }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const content = (
    <>
      <div className="flex items-center gap-2 px-5 py-5">
        <Logo variant="dark" size={34} />
        <div className="leading-none">
          <p className="font-heading text-sm font-bold text-white">Naija Parts Hub</p>
          <p className="mt-0.5 text-[11px] text-white/50">Admin Console</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {nav.map((item) => {
          const active = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                active ? 'bg-orange text-white' : 'text-white/70 hover:bg-white/5 hover:text-white',
              )}
            >
              <Icon className="size-5" />
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="border-t border-white/10 p-3">
        <div className="mb-2 flex items-center gap-3 rounded-xl px-3 py-2">
          <span className="inline-flex size-9 items-center justify-center rounded-full bg-orange/20 font-heading text-sm font-bold text-orange">
            {(email ?? "A").slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">Admin Operator</p>
            <p className="truncate text-xs text-white/50">{email ?? "Signed in"}</p>
          </div>
        </div>
        <SignOutButton
          label="Sign out"
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-60"
        />
      </div>
    </>
  )

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-border bg-dark px-4 py-3 lg:hidden">
        <Logo variant="dark" size={30} withWordmark />
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="inline-flex size-9 items-center justify-center rounded-lg text-white hover:bg-white/10"
        >
          <Menu className="size-5" />
        </button>
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col bg-dark lg:flex">{content}</aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-dark">
            <button
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-4 inline-flex size-8 items-center justify-center rounded-full text-white hover:bg-white/10"
            >
              <X className="size-4" />
            </button>
            {content}
          </div>
        </div>
      )}
    </>
  )
}
