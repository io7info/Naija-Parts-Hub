import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Relative, not the '@/' alias: vitest.config.ts sets no resolve.alias, because
// every other suite here reads source as text rather than importing it.
import { parseGaClientId, sanitizeSearchTerm } from '../lib/analytics'

const WEB_ROOT = join(__dirname, '..')
const SKIP = new Set(['node_modules', '.next', 'dist', '.turbo', 'tests'])

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry) || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, acc)
    else if (/\.tsx?$/.test(entry)) acc.push(full)
  }
  return acc
}

const code = (path: string) => readFileSync(path, 'utf8')
const posix = (path: string) => relative(WEB_ROOT, path).replace(/\\/g, '/')

/**
 * Every event the site can emit, however it is emitted.
 *
 * Two forms, because Server Components cannot call `track` directly: client
 * code calls `track('name', …)`, while server-rendered pages render
 * `<TrackView event="name" …/>`. Matching only the first would let a whole
 * class of events escape both checks below — which is exactly what happened
 * when this was written.
 */
function trackCalls(): { event: string; file: string }[] {
  const patterns = [/\btrack\(\s*'([a-z_]+)'/g, /<TrackView\s[^>]*event="([a-z_]+)"/gs]

  return sourceFiles(WEB_ROOT).flatMap((path) => {
    const source = code(path)
    return patterns.flatMap((pattern) =>
      [...source.matchAll(pattern)].map((m) => ({ event: m[1]!, file: posix(path) })),
    )
  })
}

// The list the client approved. Adding an event means adding it here too,
// which is the point: GA4 accepts any name silently, so an unreviewed event
// would otherwise ship and start collecting data nobody agreed to.
const APPROVED = [
  'search',
  'view_listing',
  'view_dealer_store',
  'click_whatsapp_dealer',
  'click_call_dealer',
  'dealer_subscription_view',
  'payment_started',
  'payment_completed',
] as const

describe('the event layer sends only approved events', () => {
  it('every tracked event is on the approved list', () => {
    const unexpected = trackCalls()
      .filter(({ event }) => !APPROVED.includes(event as (typeof APPROVED)[number]))
      .map(({ event, file }) => `${event} (${file})`)

    expect(unexpected).toEqual([])
  })

  it('every approved event is actually wired up somewhere', () => {
    const wired = new Set(trackCalls().map(({ event }) => event))
    // Catches the reverse failure: an event agreed with the client, typed into
    // the union, and then never triggered. It reports zero forever and looks
    // like a feature nobody uses.
    const missing = APPROVED.filter((event) => !wired.has(event))

    expect(missing).toEqual([])
  })
})

describe('no personal data reaches GA4', () => {
  it('no track() call passes a parameter that names personal data', () => {
    // Scans the parameter object of each track() call. The dealer's phone and
    // WhatsApp numbers are in scope at both contact buttons, so passing one is
    // a single careless line — and it would breach both the client's
    // instruction and Google's terms, which can cost the property.
    const forbidden = /\b(phone|whatsapp|email|mobile|msisdn|full_?name|owner_?name|address)\s*:/i

    const offenders: string[] = []
    for (const path of sourceFiles(WEB_ROOT)) {
      for (const match of code(path).matchAll(/\btrack\(\s*'[a-z_]+'\s*,\s*\{([^}]*)\}/gs)) {
        if (forbidden.test(match[1]!)) offenders.push(posix(path))
      }
    }

    expect(offenders).toEqual([])
  })

  it('only known automotive vocabulary survives', () => {
    expect(sanitizeSearchTerm('Toyota Corolla 2015 brake pad').term).toBe(
      'toyota corolla 2015 brake pad',
    )
    expect(sanitizeSearchTerm('5W30 engine oil').term).toBe('5w30 engine oil')
    expect(sanitizeSearchTerm('tokunbo alternator').term).toBe('tokunbo alternator')
  })

  it('personal data cannot survive, whatever form it takes', () => {
    // A denylist catches the first two. Only an allowlist catches the rest —
    // which is the entire reason this is written the way it is.
    expect(sanitizeSearchTerm('08031234567').term).toBeUndefined()
    expect(sanitizeSearchTerm('seller@example.com').term).toBeUndefined()
    expect(sanitizeSearchTerm('call chidi at ladipo market').term).toBeUndefined()
    expect(sanitizeSearchTerm('adebayo okonkwo').term).toBeUndefined()
    expect(sanitizeSearchTerm('15 Bode Thomas Street Surulere').term).toBeUndefined()
    expect(sanitizeSearchTerm('   ').term).toBeUndefined()
  })

  it('mixed input keeps the parts and discards the rest', () => {
    const result = sanitizeSearchTerm('brake pad call me on 08031234567 chidi')
    expect(result.term).toBe('brake pad')
    // 'call', 'me', 'on', the number and the name — none reach GA4, but the
    // count does, so a vocabulary gap is visible without exposing the words.
    expect(result.dropped).toBe(5)
  })

  it('reports how many words were dropped', () => {
    expect(sanitizeSearchTerm('toyota corolla').dropped).toBe(0)
    expect(sanitizeSearchTerm('flux capacitor').dropped).toBe(2)
  })

  it('the reported term is bounded', () => {
    // Vocabulary words repeated 50 times would otherwise build an unbounded
    // string, and GA4 truncates parameters at 100 characters anyway.
    const long = Array.from({ length: 50 }, () => 'brake').join(' ')
    expect(sanitizeSearchTerm(long).term!.split(' ').length).toBe(8)
  })
})

describe('the cookie fallback parses rather than passing through', () => {
  it('extracts the client id from the _ga cookie', () => {
    expect(parseGaClientId('_ga=GA1.1.1234567890.1234567890')).toBe('1234567890.1234567890')
    expect(parseGaClientId('foo=bar; _ga=GA1.2.987.654; other=x')).toBe('987.654')
  })

  it('never returns a raw cookie value', () => {
    // The whole point of the capture group. Persisting a cookie verbatim would
    // tie stored data to a format Google changes without notice.
    const raw = '_ga=GA1.1.1234567890.1234567890'
    expect(parseGaClientId(raw)).not.toContain('GA1')
    expect(parseGaClientId(raw)).not.toBe(raw)
  })

  it('ignores the per-stream session cookie in every known format', () => {
    // session_id comes from gtag('get') alone. These are the older GS1 layout
    // and the newer $-delimited GS2 one — neither is read, so neither can
    // reach the validator, whatever separators a future format introduces.
    expect(parseGaClientId('_ga_FY4MWY0Z0V=GS1.1.1786761234.1.1.1786761300.0.0.0')).toBeNull()
    expect(parseGaClientId('_ga_FY4MWY0Z0V=GS2.1.s1786761234$o1$g1$t1786761300$j0$l0$h0')).toBeNull()
  })

  it('does not mistake a similarly named cookie for _ga', () => {
    expect(parseGaClientId('x_ga=GA1.1.111.222')).toBeNull()
    expect(parseGaClientId('_gat=1; _gid=GA1.1.9.9')).toBeNull()
  })

  it('returns null rather than a partial match on malformed input', () => {
    expect(parseGaClientId('')).toBeNull()
    expect(parseGaClientId('_ga=')).toBeNull()
    expect(parseGaClientId('_ga=GA1.1.notanid')).toBeNull()
  })
})

describe('page views and searches cannot be double counted', () => {
  it('no application code sends view_search_results', () => {
    // GA4 Enhanced Measurement's "Site search" fires view_search_results by
    // itself when a page URL carries a search parameter — and our browse URLs
    // use ?q=, which is in its default list. Sending our own copy would put
    // two events into the same built-in Search term dimension.
    //
    // The dashboard side of this is documented in docs/ANALYTICS.md: Site
    // search must be OFF, because the automatic version reads the RAW query
    // string and would bypass the allowlist sanitiser entirely.
    const offenders = sourceFiles(WEB_ROOT)
      .filter((path) => /view_search_results/.test(code(path)))
      .map(posix)

    expect(offenders).toEqual([])
  })

  it('no application code sends a page_view event', () => {
    // GA4 Enhanced Measurement reports SPA navigations itself when "page
    // changes based on browser history events" is on — a switch in the client's
    // dashboard that this repository cannot see. Sending our own page_view
    // would double every view whenever that switch is on, so we send none and
    // the duplication is structurally impossible rather than merely unlikely.
    const offenders = sourceFiles(WEB_ROOT)
      .filter((path) => /['"]page_view['"]|send_page_view/.test(code(path)))
      .map(posix)

    expect(offenders).toEqual([])
  })
})
