/**
 * Google Analytics 4 configuration and the marketplace event layer.
 *
 * The measurement ID is not a secret — it ships in the client bundle by
 * definition, and anyone can read it in devtools. It lives here as a constant
 * rather than an environment variable so a deployment cannot silently lose
 * analytics by forgetting to set a var, which is the usual failure and is
 * invisible until someone asks why a month of data is missing.
 *
 * Supplied by the client (Lytod Motors), GA4 property `naijapartshub`,
 * stream "NPH Web".
 */
import { SEARCH_VOCABULARY } from '@/lib/search-vocabulary'

export const GA_MEASUREMENT_ID = 'G-FY4MWY0Z0V'

/**
 * Whether to load Analytics at all.
 *
 * Only the real production deployment reports. Local development and Vercel
 * preview builds must not, or the client's reports mix real Nigerian buyers
 * with our own test traffic — and once that data is in GA4 it cannot be
 * removed retroactively, only filtered.
 *
 * `VERCEL_ENV` is 'production' only for the production deployment; preview
 * branches get 'preview' even though NODE_ENV is 'production' in both. That
 * distinction is the whole reason this reads VERCEL_ENV rather than NODE_ENV.
 * Undefined off-Vercel, so `npm run dev` and `next start` locally stay silent.
 *
 * NEXT_PUBLIC_ANALYTICS_ENABLED overrides in either direction, for verifying
 * the tag from a preview deployment without shipping to production first.
 */
export function analyticsEnabled(): boolean {
  const override = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED
  if (override === 'true') return true
  if (override === 'false') return false
  return process.env.VERCEL_ENV === 'production'
}

/**
 * Every event this site may send. A closed union, not a string.
 *
 * GA4 has no schema and accepts any event name silently, so a typo produces a
 * new event that reports zero and is indistinguishable from a feature nobody
 * uses. Reports are also built on exact names, so renaming one later orphans
 * the history behind it. The union makes both a compile error instead.
 *
 * `search` is GA4's recommended name rather than a custom `search_parts`,
 * which means its `search_term` lands in the built-in "Search term" dimension:
 * no custom definition to register, no slot spent, and the standard reports
 * populate on their own. Only the NPH-specific parameters alongside it need
 * registering.
 *
 * `page_view` is deliberately absent — see components/web/google-analytics.tsx.
 */
export type MarketplaceEvent =
  | 'search'
  | 'view_listing'
  | 'view_dealer_store'
  | 'click_whatsapp_dealer'
  | 'click_call_dealer'
  | 'dealer_subscription_view'
  | 'payment_started'
  | 'payment_completed'

export type EventParams = Record<string, string | number | boolean | undefined>

/**
 * Personal data must never reach GA4.
 *
 * Beyond the client's instruction, Google's own terms prohibit sending PII to
 * Analytics and breaching them can get a property terminated — taking the
 * history with it. The dealer's phone and WhatsApp numbers are the live risk
 * here: they sit in scope at every contact button, and passing one as an event
 * parameter would be a single careless line.
 *
 * So contact events carry the store slug — already public, already in the page
 * URL GA4 records — and never the number that was dialled.
 */
const FORBIDDEN_PARAM = /phone|whatsapp|email|mobile|msisdn|full_?name|owner|address/i

/** How many words a single reported search term may contain. */
const MAX_TERM_WORDS = 8

/**
 * Reduces a buyer's search text to known automotive vocabulary.
 *
 * ALLOWLIST, NOT REDACTION. An earlier version stripped things that looked
 * like phone numbers and emails, which is a denylist — and a denylist cannot
 * catch a name or an address. "call chidi at ladipo market" defeats every
 * pattern you can write. Matching against a fixed vocabulary inverts the
 * problem: the output is assembled only from words in
 * lib/search-vocabulary.ts, so no user input can produce anything that is not
 * already shipped in this bundle. That makes the guarantee provable instead of
 * probabilistic, which is what the client asked for.
 *
 * `dropped` counts the tokens that did not match. It carries no text, and it
 * is the feedback loop: a search reporting many dropped words means the
 * vocabulary is missing real parts, and the fix is to extend the list. Without
 * it the allowlist would quietly lose coverage with nobody the wiser.
 *
 * `term` is undefined when nothing survives, so the caller omits the parameter
 * rather than sending an empty string, which GA4 records as a distinct value.
 */
export function sanitizeSearchTerm(raw: string): { term?: string; dropped: number } {
  const tokens = raw
    .toLowerCase()
    // Keep hyphens inside words so 'santa-fe' survives as one token, then let
    // the vocabulary decide. Everything else becomes a separator.
    .split(/[^a-z0-9-]+/)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter(Boolean)

  const kept: string[] = []
  let dropped = 0

  for (const token of tokens) {
    if (SEARCH_VOCABULARY.has(token)) {
      if (kept.length < MAX_TERM_WORDS) kept.push(token)
    } else {
      dropped += 1
    }
  }

  return { term: kept.length > 0 ? kept.join(' ') : undefined, dropped }
}

/**
 * Sends one marketplace event.
 *
 * Safe to call from anywhere: a no-op during SSR, and a no-op when gtag is
 * absent — which is the normal state for the roughly one visitor in four
 * running a content blocker, and for every local and preview build. Analytics
 * must never be able to break a page, so nothing here throws.
 *
 * Undefined parameters are dropped rather than sent, because GA4 records the
 * literal string "undefined" as a dimension value otherwise.
 */
export function track(name: MarketplaceEvent, params: EventParams = {}): void {
  if (typeof window === 'undefined') return

  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag
  if (typeof gtag !== 'function') return

  const payload: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    // Defence in depth. The tests reject a forbidden key at build time; this
    // catches one introduced dynamically, where no test can see it.
    if (FORBIDDEN_PARAM.test(key)) continue
    payload[key] = value
  }

  gtag('event', name, payload)
}

/**
 * The ceiling on how long checkout waits for GA4 to answer.
 *
 * This is a real delay added before the redirect to Paystack, not a free
 * operation. It is bounded, and the bound is what makes it acceptable:
 *
 *   analytics blocked     ~0 ms   — `gtag` is undefined, so it returns at once
 *   gtag.js already loaded ~0 ms  — the getter answers on the next tick
 *   gtag.js still loading  ≤400 ms — the timeout fires and capture is skipped
 *
 * The worst case is only reachable in the narrow window where the script is
 * present but not yet initialised, and 400 ms was chosen to sit under the
 * threshold where a delay becomes noticeable while still covering a slow
 * connection.
 */
const GA_LOOKUP_TIMEOUT_MS = 400

/**
 * Reads one GA4 field through gtag's asynchronous getter.
 *
 * `gtag('get', …)` queues behind gtag.js loading and never calls back if the
 * script was blocked, so an un-timed promise here would hang checkout forever
 * for every visitor running an ad blocker.
 */
function gaField(field: 'client_id' | 'session_id'): Promise<string | null> {
  return new Promise((resolve) => {
    const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag
    if (typeof gtag !== 'function') return resolve(null)

    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }

    const timer = setTimeout(() => finish(null), GA_LOOKUP_TIMEOUT_MS)

    try {
      gtag('get', GA_MEASUREMENT_ID, field, (value: unknown) => {
        // session_id comes back as a number.
        finish(value === undefined || value === null ? null : String(value))
      })
    } catch {
      finish(null)
    }
  })
}

/**
 * Extracts the client id from a cookie string.
 *
 * PARSES, NEVER PASSES THROUGH. The capture group is the point: what is
 * returned is the client id itself, never a raw cookie value. Persisting a
 * whole cookie would couple stored data to a format Google changes without
 * notice — the session cookie already has at least two incompatible layouts,
 * the older `GS1.1.<id>.…` and a newer `$`-delimited `GS2.1.s<id>$o1$g1…` —
 * and would put separator characters into a document admins read.
 *
 * Only `_ga` is read, which holds the client id and has a stable
 * `GA<n>.<n>.<client_id>` shape. The per-stream `_ga_<container-id>` cookie,
 * which holds the session id, is deliberately NOT parsed: session_id comes
 * from `gtag('get', …)` alone. Google recommends the getter over cookie
 * reading, and the fallback window here is the fraction of a second between
 * gtag.js loading and a dealer clicking a plan — not worth coupling to an
 * undocumented format that has already changed once.
 *
 * The `(?:^|;\s*)` prefix anchors to a cookie boundary so `_ga_FY4MWY0Z0V=…`
 * and any `x_ga=…` cannot be mistaken for `_ga=…`.
 *
 * Exported for testing: this runs in a browser but is a pure string function,
 * and its invariant — a raw cookie value can never be returned — is worth
 * enforcing rather than assuming.
 */
export function parseGaClientId(cookie: string): string | null {
  const match = /(?:^|;\s*)_ga=GA\d+\.\d+\.(\d+\.\d+)/.exec(cookie)
  return match?.[1] ?? null
}

/**
 * GA4 attribution for a checkout, captured in the browser.
 *
 * These identifiers exist nowhere else. A `purchase` reported later from the
 * webhook without them does not produce an unattributed conversion — it
 * fabricates a new user and a new session in GA4, breaking channel
 * attribution and the checkout funnel at once. Capturing them now, before any
 * live payment, is what makes that later work possible: a payment taken
 * without them can never be attributed retroactively.
 *
 * Always resolves and never rejects. It does add a bounded delay before
 * checkout — at most GA_LOOKUP_TIMEOUT_MS, and effectively none in the two
 * common cases — but it can neither hang nor fail the payment. Empty results
 * are an expected outcome rather than an error.
 */
export async function gaAttribution(): Promise<{
  clientId?: string
  sessionId?: string
}> {
  if (typeof window === 'undefined') return {}

  try {
    const [clientId, sessionId] = await Promise.all([gaField('client_id'), gaField('session_id')])
    // gtag('get') stays the primary source for both fields, per Google's own
    // guidance. The cookie is consulted only when the getter gave nothing.
    const resolved = clientId ?? parseGaClientId(document.cookie)

    // Undefined rather than null: this crosses a callable boundary, and
    // Firebase callables reject undefined-valued keys less noisily than they
    // handle nulls the contract does not declare.
    return {
      ...(resolved ? { clientId: resolved } : {}),
      ...(sessionId ? { sessionId } : {}),
    }
  } catch {
    return {}
  }
}
