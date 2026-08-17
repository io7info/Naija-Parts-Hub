import Script from 'next/script'
import { GA_MEASUREMENT_ID } from '@/lib/analytics'

/**
 * The GA4 tag. Page views are Google's responsibility, not ours.
 *
 * WHY THERE IS NO MANUAL page_view HERE
 *
 * GA4 can report a page view from two independent places, and they cannot see
 * each other:
 *
 *   1. gtag.js, on load, from the `config` call below.
 *   2. Enhanced Measurement's "page changes based on browser history events",
 *      a switch in the GA4 admin UI. When on, gtag.js listens for History API
 *      navigations — exactly what the App Router performs on every link — and
 *      reports each one itself.
 *
 * Sending our own page_view on route change duplicates (2) whenever that
 * switch is on. Duplicated views inflate sessions, halve the bounce rate and
 * corrupt every per-page average, and because the switch lives in the GA4
 * dashboard rather than in this repository, code review cannot catch it: the
 * data silently doubles the day somebody toggles it.
 *
 * The two safe configurations are "manual only, switch off" and "automatic
 * only, switch on". Only the second is safe *regardless* of the switch:
 *
 *   switch ON  + no manual code -> correct
 *   switch OFF + no manual code -> initial load only, undercounts SPA routes
 *   switch ON  + manual code    -> every view double counted
 *   switch OFF + manual code    -> correct
 *
 * We do not control the client's GA4 dashboard, so we choose the column that
 * cannot double count. The worst case becomes missing SPA navigations, which
 * is visible in the reports as implausibly low page counts and is fixed by one
 * dashboard toggle. The alternative fails silently and inflates the numbers
 * the client will report to their own stakeholders.
 *
 * tests/analytics.test.ts asserts no application code sends page_view, so this
 * property is enforced rather than merely documented.
 *
 * REQUIRED SETTING: GA4 Admin -> Data streams -> NPH Web -> Enhanced
 * measurement -> Page views -> "Page changes based on browser history events"
 * must stay ON. Everything else on that panel is optional.
 *
 * Not a client component: it renders two <Script> tags and holds no state, so
 * it stays server-rendered and ships no component JavaScript of its own.
 */
export function GoogleAnalytics() {
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
