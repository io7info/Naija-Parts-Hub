import type { ReactNode } from 'react'
import { SiteHeader } from '@/components/web/site-header'
import { SiteFooter } from '@/components/web/site-footer'

export default function WebLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  )
}
