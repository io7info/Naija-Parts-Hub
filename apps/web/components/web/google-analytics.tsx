'use client'

import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { GA_MEASUREMENT_ID } from '@/lib/analytics'

/**
 * GA4 tag, with extra page views sent on client-side navigation.
 *
 * The App Router never reloads the document after the first request, so the
 * page_view that gtag.js fires on load is the only one GA4 would otherwise
 * see: a buyer going home -> category -> product -> store registers as a
 * single view of the homepage, and every session looks like a bounce.
 *
 * The split of responsibility matters. gtag's own `config` call sends the
 * FIRST page view, unmodified — that path is Google's code and cannot be
 * broken by anything here. This component only adds the views that client-side
 * navigation would otherwise lose, and the effect skips its initial run so the
 * landing page is not counted twice.
 *
 * An earlier revision disabled the automatic view (`send_page_view: false`)
 * and sent every view by hand. That put the entire reporting path behind
 * hand-written code: if the push were malformed, GA4 received nothing at all
 * and the property looked dead rather than merely undercounting. Letting
 * Google send the first one means the worst case here is missing SPA
 * navigations, not missing everything.
 *
 * Keyed on pathname only, not the query string. Marketplace filters live in
 * the query (`?category=brake&condition=new`), and adjusting a filter is not a
 * new page — counting it would inflate views and bury the pages that matter.
 * It also avoids `useSearchParams`, which opts the subtree out of static
 * rendering unless wrapped in Suspense.
 */
export function GoogleAnalytics() {
  const pathname = usePathname()
  const skippedInitial = useRef(false)

  useEffect(() => {
    if (!skippedInitial.current) {
      // gtag('config') already reported this one.
      skippedInitial.current = true
      return
    }

    // `gtag` is declared by the inline script below, which has certainly run
    // by the time a navigation happens. Optional-called anyway: if analytics
    // is blocked by an extension the global is simply absent, and a missing
    // page view must never take the page down with a TypeError.
    const w = window as unknown as { gtag?: (...args: unknown[]) => void }
    w.gtag?.('event', 'page_view', {
      page_path: pathname,
      page_location: window.location.href,
      page_title: document.title,
    })
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
gtag('config', '${GA_MEASUREMENT_ID}');`}
      </Script>
    </>
  )
}
