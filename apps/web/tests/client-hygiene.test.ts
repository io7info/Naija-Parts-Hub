import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Static guards over the browser-reachable source.
 *
 * These exist because the failure they catch is silent: a service-account key
 * bundled into client JavaScript still builds, still passes typecheck, and
 * still renders the page correctly. Nothing complains until it is public.
 */

const WEB_ROOT = join(import.meta.dirname, '..')
const SKIP_DIRS = new Set(['node_modules', '.next', 'tests', '.turbo'])

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) sourceFiles(path, found)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) found.push(path)
  }
  return found
}

/**
 * Source with comments removed.
 *
 * These guards must read code, not prose. Several modules explain in a comment
 * precisely which thing they avoid — "the prototype's sessionStorage flag was
 * removed rather than migrated" — and a naive substring scan flags the
 * explanation as the offence, so the guard fails loudest on the files that are
 * most careful.
 *
 * `[^:]//` keeps the `//` in a URL from swallowing the rest of its line.
 */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Files that reach the browser: everything except server-only modules. */
function clientReachableFiles(): { path: string; source: string }[] {
  return sourceFiles(WEB_ROOT)
    .map((path) => ({ path, source: code(path) }))
    .filter(({ source }) => !/^import ['"]server-only['"]/m.test(source))
}

describe('no server credentials reachable from the browser', () => {
  it('no client-reachable file imports firebase-admin', () => {
    const offenders = clientReachableFiles()
      .filter(({ source }) => /from ['"]firebase-admin/.test(source))
      .map(({ path }) => relative(WEB_ROOT, path))

    // lib/firebase-admin.ts is exempt because it declares `import 'server-only'`,
    // which makes the build itself fail if a client component imports it.
    expect(offenders).toEqual([])
  })

  it('no secret-bearing variable is exposed through NEXT_PUBLIC_', () => {
    const forbidden = [
      'NEXT_PUBLIC_FIREBASE_SERVICE_ACCOUNT',
      'NEXT_PUBLIC_SERVICE_ACCOUNT',
      'NEXT_PUBLIC_PRIVATE_KEY',
      'NEXT_PUBLIC_PAYSTACK_SECRET',
      'NEXT_PUBLIC_WEBHOOK_SECRET',
      'NEXT_PUBLIC_ADMIN_PASSWORD',
    ]

    const offenders: string[] = []
    for (const { path, source } of sourceFiles(WEB_ROOT).map((p) => ({
      path: p, source: code(p),
    }))) {
      for (const name of forbidden) {
        if (source.includes(name)) offenders.push(`${relative(WEB_ROOT, path)}: ${name}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('no private key or service-account JSON is embedded in source', () => {
    const offenders = sourceFiles(WEB_ROOT)
      .filter((path) => {
        const source = code(path)
        return (
          source.includes('BEGIN PRIVATE KEY') ||
          source.includes('"type": "service_account"') ||
          source.includes("'type': 'service_account'")
        )
      })
      .map((path) => relative(WEB_ROOT, path))

    expect(offenders).toEqual([])
  })

  it('the service account is read server-side only', () => {
    const offenders = clientReachableFiles()
      .filter(({ source }) => source.includes('FIREBASE_SERVICE_ACCOUNT_JSON'))
      .map(({ path }) => relative(WEB_ROOT, path))

    expect(offenders).toEqual([])
  })
})

describe('analytics is GA4 via gtag, and nothing else', () => {
  // The two files allowed to know the measurement id. Anything else naming it
  // means a second, competing integration is being added.
  const GA_FILES = ['lib/analytics.ts', 'components/web/google-analytics.tsx']

  const posix = (path: string) => relative(WEB_ROOT, path).replace(/\\/g, '/')

  it('nothing imports or calls getAnalytics', () => {
    const offenders = sourceFiles(WEB_ROOT)
      .filter((path) => {
        const source = code(path)
        return /getAnalytics|firebase\/analytics/.test(source)
      })
      .map(posix)

    // Still banned even though GA4 is now wired up: the site measures through
    // gtag.js, loaded by <Script> in the client component below. Firebase
    // Analytics is a different SDK that would double-count every page, and
    // getAnalytics() throws during SSR, so adding it casually breaks every
    // server-rendered page.
    expect(offenders).toEqual([])
  })

  it('the measurement id appears only in the two analytics files', () => {
    // This used to forbid MEASUREMENT_ID outright, because analytics was
    // deferred for Phase 1. The client supplied a GA4 property, so the ban is
    // now an allowlist: the id is defined once and consumed once. A third file
    // naming it is the signal that someone is hand-rolling a second tag.
    const offenders = sourceFiles(WEB_ROOT)
      .filter((path) => code(path).includes('MEASUREMENT_ID'))
      .map(posix)
      .filter((path) => !GA_FILES.includes(path))

    expect(offenders).toEqual([])
  })

  it('the measurement id is a GA4 id, not a Firebase or Ads one', () => {
    const source = code(join(WEB_ROOT, 'lib/analytics.ts'))
    const id = source.match(/GA_MEASUREMENT_ID = '([^']+)'/)?.[1]

    // G- is GA4. AW- is Google Ads conversion tracking and ca-pub- is AdSense;
    // pasting either here loads the tag but records nothing, and the reports
    // stay empty for weeks before anyone works out why.
    expect(id).toMatch(/^G-[A-Z0-9]+$/)
  })
})

describe('no client-side authorisation remains', () => {
  // The one sanctioned use of web storage. The Paystack callback page is
  // reachable by URL and survives a reload, and verifyPayment reports an
  // already-applied payment as success by design — so without a marker every
  // reload would report another sale to GA4. It stores '1' against a payment
  // reference and grants nothing.
  const STORAGE_ALLOWED = ['app/(site)/dealer/subscription/callback/callback-client.tsx']

  it('no admin state is kept in sessionStorage or localStorage', () => {
    const offenders = sourceFiles(WEB_ROOT)
      .filter((path) => /sessionStorage|localStorage/.test(code(path)))
      .map((path) => relative(WEB_ROOT, path).replace(/\\/g, '/'))
      .filter((path) => !STORAGE_ALLOWED.includes(path))

    // Anything a client can write, a client can forge. Authorisation is the
    // httpOnly session cookie verified in lib/admin-session.ts, nothing else.
    expect(offenders).toEqual([])
  })

  it('the sanctioned storage use holds nothing that grants access', () => {
    // The allowlist above is a hole in the rule, so it is itself checked:
    // a credential must never be smuggled through the one permitted door.
    for (const rel of STORAGE_ALLOWED) {
      const source = code(join(WEB_ROOT, rel))
      expect(source).not.toMatch(
        /(sessionStorage|localStorage)[^\n]*\b(token|claim|role|admin|uid|session|auth|password)\b/i,
      )
    }
  })

  it('the login form has no direct link into the dashboard', () => {
    const form = code(join(WEB_ROOT, 'app/admin/login/login-form.tsx'))

    // An earlier revision shipped <Link href="/admin/overview">, which walked
    // straight past authentication.
    expect(form).not.toMatch(/<Link\s+href=["']\/admin\//)
    expect(form).toContain('signInAdmin')
  })

  it('the login form routes only after the session endpoint succeeds', () => {
    const source = code(join(WEB_ROOT, 'lib/admin-login.ts'))

    expect(source).toContain('/api/admin/session')
    expect(source).toContain('x-nph-csrf')
    // No mock/fake path back into the dashboard.
    expect(source).not.toMatch(/mock|fake|bypass/i)
  })
})

describe('built client bundle', () => {
  // Source scanning proves intent; this proves the artefact. Skipped when
  // .next/static is absent so the suite still runs without a prior build —
  // `npm run build && npm test` exercises it.
  const staticDir = join(WEB_ROOT, '.next', 'static')
  const built = existsSync(staticDir)

  function bundleFiles(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) bundleFiles(path, found)
      else if (entry.endsWith('.js')) found.push(path)
    }
    return found
  }

  it.skipIf(!built)('ships no service-account credential', () => {
    const offenders = bundleFiles(staticDir)
      .filter((path) => {
        const source = readFileSync(path, 'utf8')
        return (
          source.includes('FIREBASE_SERVICE_ACCOUNT_JSON') ||
          source.includes('BEGIN PRIVATE KEY') ||
          source.includes('service_account')
        )
      })
      .map((path) => relative(WEB_ROOT, path))

    expect(offenders).toEqual([])
  })

  it.skipIf(!built)('ships no Firebase Analytics', () => {
    const offenders = bundleFiles(staticDir)
      .filter((path) => readFileSync(path, 'utf8').includes('getAnalytics'))
      .map((path) => relative(WEB_ROOT, path))

    expect(offenders).toEqual([])
  })
})

describe('a single Firebase client module', () => {
  it('lib/firebase.ts is gone, so there is one initialisation path', () => {
    const remaining = sourceFiles(WEB_ROOT)
      .map((path) => relative(WEB_ROOT, path).replace(/\\/g, '/'))
      .filter((path) => path === 'lib/firebase.ts')

    // Two modules calling initializeApp race to own the [DEFAULT] app, and
    // whichever loses silently gets a different emulator wiring.
    expect(remaining).toEqual([])
  })
})
