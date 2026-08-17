'use client'

import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { GA_MEASUREMENT_ID } from '@/lib/analytics'

/**
 * GA4 tag, with page views sent manually on navigation.
 *
 * The App Router never reloads the document after the first request, so the
 * page_view that gtag.js fires on load is the only one GA4 would ever see: a
 * buyer going home -> category -> product -> store would register as a single
 * view of the homepage. Every session would look like a bounce, which is
 * exactly the metric a marketplace is judged on.
 *
 * So `send_page_view: false` suppresses the automatic one, and the effect
 * below sends one per pathname — including the first, because the effect runs
 * on mount too. Leaving the automatic view enabled as well would double-count
 * every landing.
 *
 * Deliberately keyed on pathname only, not the query string. Marketplace
 * filters live in the query (`?category=brake&condition=new`), and each
 * adjustment of a filter is not a new page — counting them would inflate views
 * and bury the pages that matter. It also avoids `useSearchParams`, which
 * opts the whole subtree out of static rendering unless wrapped in Suspense.
 */
export function GoogleAnalytics() {
  const pathname = usePathname()

  useEffect(() => {
    // gtag.js may not have finished loading when this first runs — both
    // Script tags below are afterInteractive, and effects are not ordered
    // against them. Pushing straight to dataLayer is safe regardless: gtag.js
    // drains whatever it finds there once it loads, so an early event is
    // queued rather than dropped.
    const w = window as unknown as { dataLayer?: unknown[] }
    w.dataLayer = w.dataLayer ?? []
    w.dataLayer.push([
      'event',
      'page_view',
      {
        page_path: pathname,
        page_location: window.location.href,
        page_title: document.title,
      },
    ])
  }, [pathname])

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_MEASUREMENT_ID}', { send_page_view: false });`}
      </Script>
    </>
  )
}
