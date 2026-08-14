import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LISTING_CATEGORIES } from '@nph/contracts'
import { describe, expect, it } from 'vitest'

import { categoryIcon } from '../lib/marketplace'

/**
 * Guards over the public storefront data path.
 *
 * `firestore.rules` deliberately forbids a client enumerating `stores`
 * (`allow list: if isAdmin()`), because dealer records carry CAC numbers,
 * addresses and phone numbers. The public directory therefore reads through the
 * Admin SDK on the server — which bypasses rules entirely. That trade is only
 * safe while the queries themselves carry the approval and visibility filters,
 * so those filters, not the rules, are what keeps a pending or suspended
 * dealer off the marketplace.
 *
 * These are source-level assertions rather than live queries, which is a real
 * limitation worth naming: they prove the filter is written, not that Firestore
 * honours it. What they catch is the regression that actually happens — someone
 * deleting a `.where` while refactoring, which typechecks, builds, renders
 * correctly, and quietly publishes every unapproved dealer. End-to-end
 * behaviour against real rules is covered in firebase/tests.
 */

const WEB_ROOT = join(import.meta.dirname, '..')

/**
 * Source with comments removed.
 *
 * These guards must read code, not prose. This file explains in comments
 * exactly which filters it applies and why — so a check against the raw text
 * would keep passing after the filter itself was deleted, as long as the
 * comment describing it survived.
 */
const REPO = readFileSync(join(WEB_ROOT, 'lib/repositories/marketplace.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

/** The body of a top-level exported function, up to the next export. */
function body(name: string): string {
  const start = REPO.indexOf(`export async function ${name}(`)
  expect(start, `${name} not found — was it renamed?`).toBeGreaterThan(-1)
  const rest = REPO.slice(start + 1)
  const end = rest.indexOf('\nexport ')
  return end === -1 ? rest : rest.slice(0, end)
}

/** Every reader that returns store records to an unauthenticated visitor. */
const PUBLIC_STORE_READERS = ['listPublicStores', 'getPublicStore']

describe('the public store directory runs server-side', () => {
  it('the repository is server-only, so importing it from a client component fails the build', () => {
    expect(REPO.startsWith("import 'server-only'")).toBe(true)
  })

  it('reads go through the Admin SDK, never the browser SDK', () => {
    expect(REPO).toContain("from '../firebase-admin'")
    expect(REPO).not.toContain('firebase/firestore')
  })
})

describe('only approved, visible stores are public', () => {
  for (const fn of PUBLIC_STORE_READERS) {
    it(`${fn} filters on status == 'approved'`, () => {
      expect(body(fn)).toContain("where('status', '==', 'approved')")
    })

    it(`${fn} filters on visible == true`, () => {
      expect(body(fn)).toContain("where('visible', '==', true)")
    })
  }

  it('every stores query in this file carries both filters', () => {
    // Catches a new public reader added without them, which the per-function
    // assertions above would not see.
    const queries = REPO.split("collection('stores')").slice(1)
    expect(queries.length).toBeGreaterThan(0)

    for (const q of queries) {
      const window = q.slice(0, 400)
      // `.doc(` is a single-document lookup by id, not an enumeration; the
      // callers of those are admin-only paths in repositories/stores.ts.
      if (window.trimStart().startsWith('.doc(')) continue
      expect(window, 'a stores query without the approval filter').toContain(
        "where('status', '==', 'approved')",
      )
      expect(window, 'a stores query without the visibility filter').toContain(
        "where('visible', '==', true)",
      )
    }
  })

  it('pending, rejected and suspended are not reachable through an equality filter', () => {
    // status is a single field with one value per document, so an equality
    // filter on 'approved' excludes every other state by construction. Named
    // here so the guarantee is written down rather than assumed.
    for (const state of ['pending', 'rejected', 'suspended']) {
      expect(REPO).not.toContain(`where('status', '==', '${state}')`)
    }
  })
})

describe('the public projection carries no private dealer data', () => {
  const projection = body('listPublicStores').includes('toStore')
    ? REPO.slice(REPO.indexOf('function toStore('), REPO.indexOf('function toStore(') + 900)
    : ''

  // Registration data a buyer has no business seeing. CAC numbers in
  // particular are corporate-registry identifiers, not marketplace content.
  for (const field of ['cacNumber', 'rejectionReason', 'reviewedBy', 'subscription', 'email']) {
    it(`toStore does not expose ${field}`, () => {
      expect(projection).not.toContain(field)
    })
  }
})

describe('marketplace filters run in Firestore, not over a downloaded page', () => {
  const listing = body('listPublicListings')
  const planner = REPO.slice(REPO.indexOf('function planFilters('), REPO.indexOf('function planFilters(') + 1400)

  it('search uses the tokens the trigger generates', () => {
    // searchTokens is written server-side and indexed. Matching a string
    // haystack in the browser instead meant a part past the fetch limit was
    // reported as not existing — the opposite of what SOW §7 asks for.
    expect(listing).toContain("where('searchTokens', 'array-contains'")
  })

  for (const [name, clause] of [
    ['category', "where('categoryId', '==', applied.categoryId)"],
    ['state', "where('storeState', '==', applied.state)"],
    ['condition', "where('condition', '=='"],
  ] as const) {
    it(`${name} is applied by the query`, () => {
      expect(listing).toContain(clause)
    })
  }

  it('results are ordered by the database, not by a formatted label', () => {
    // The old sort compared postedLabel strings — "Today", "Yesterday",
    // "3 days ago" — alphabetically, so "newest first" was neither.
    expect(listing).toContain("orderBy('createdAt', 'desc')")
    expect(REPO).not.toContain('b.postedLabel.localeCompare')
  })

  it('applies every URL filter in the query, leaving nothing to the client', () => {
    // Applying only a subset was correct while a result set fitted in one page
    // and wrong past it: the leftover filter ran over the listings that had
    // been fetched and silently not over the ones that had not, so a buyer
    // could be told a part did not exist when it did.
    for (const f of ['q.search', 'q.categoryId', 'q.state', 'q.condition']) {
      expect(planner, `${f} must reach the query`).toContain(f)
    }
    expect(planner).not.toContain('unapplied.state')
    expect(planner).not.toContain('unapplied.condition')
  })

  it('every combination the UI can produce has a composite index', () => {
    // Firestore fails an unindexed ordered query outright rather than
    // degrading, so a filter pairing with no index is a 500 on a page a buyer
    // reached by ticking two boxes. This asserts the declared indexes cover all
    // sixteen subsets, which is what lets planFilters apply everything.
    const indexes = JSON.parse(
      readFileSync(join(WEB_ROOT, '../../firebase/firestore.indexes.json'), 'utf8'),
    ) as { indexes: { collectionGroup: string; fields: { fieldPath: string }[] }[] }

    const declared = new Set(
      indexes.indexes
        .filter((i) => i.collectionGroup === 'listings')
        .map((i) => i.fields.map((f) => f.fieldPath).join('+')),
    )

    const filters = ['searchTokens', 'categoryId', 'storeState', 'condition']

    for (let mask = 0; mask < 16; mask++) {
      const combo = filters.filter((_, bit) => mask & (1 << bit))
      const key = ['publiclyVisible', ...combo, 'createdAt'].join('+')
      expect(declared, `no index for ${combo.join(' + ') || 'no filters'}`).toContain(key)
    }
  })

  it('reports truncation, so a partial page is not read as the whole market', () => {
    expect(listing).toContain('truncated')
  })
})

describe('the browse page filters through the URL', () => {
  const BROWSE = readFileSync(join(WEB_ROOT, 'app/(site)/parts/browse-client.tsx'), 'utf8')
  const PAGE = readFileSync(join(WEB_ROOT, 'app/(site)/parts/page.tsx'), 'utf8')

  it('the category parameter reaches the query', () => {
    // The regression: `category` was destructured from searchParams and then
    // never used, so every homepage tile led to the unfiltered grid.
    expect(PAGE).toContain('categoryId: params.category')
  })

  for (const param of ['q', 'category', 'state', 'condition']) {
    it(`${param} is read from the URL`, () => {
      expect(PAGE).toContain(`params.${param}`)
    })
  }

  it('changing a server-backed filter navigates instead of filtering locally', () => {
    expect(BROWSE).toContain('router.push')
    expect(BROWSE).toContain("setParam('category'")
    expect(BROWSE).toContain("setParam('state'")
    expect(BROWSE).toContain("setParam('condition'")
  })

  it('no state list is hardcoded', () => {
    // Nigeria has 36 states plus the FCT; the four that used to be listed were
    // a design placeholder, and 33 of the rest would return nothing anyway.
    for (const stale of ['Anambra', 'Kaduna']) {
      expect(BROWSE).not.toContain(`'${stale}'`)
    }
    expect(PAGE).toContain('listMarketplaceStates')
  })
})

describe('the taxonomy is whatever Firestore says it is', () => {
  const HOME = readFileSync(join(WEB_ROOT, 'app/(site)/page.tsx'), 'utf8')
  const PAGE = readFileSync(join(WEB_ROOT, 'app/(site)/parts/page.tsx'), 'utf8')
  const SEED = readFileSync(
    join(WEB_ROOT, '../../functions/scripts/seed-production-categories.mjs'),
    'utf8',
  )

  it('the homepage tiles come from the collection, not a constant', () => {
    // Once an administrator can add a category from the portal, a list baked
    // into the web bundle means it appears in the dealer app immediately and
    // on the marketplace only after a deploy.
    expect(HOME).toContain('listCategories()')
    expect(HOME).not.toContain("categories } from '@/lib/marketplace'")
  })

  it('the browse filter offers the same collection', () => {
    expect(PAGE).toContain('listCategories()')
  })

  it('the seed still derives from the shared contract', () => {
    expect(SEED).toContain("from '@nph/contracts'")
    expect(SEED).toContain('LISTING_CATEGORIES')
  })

  it('every seeded category resolves to an icon the card can render', () => {
    const UI = readFileSync(join(WEB_ROOT, 'components/brand/ui-bits.tsx'), 'utf8')
    for (const c of LISTING_CATEGORIES) {
      expect(UI, `iconMap has no ${categoryIcon(c.id)} for ${c.id}`).toContain(
        `\n  ${categoryIcon(c.id)},`,
      )
    }
  })

  it('a category added after this build still renders', () => {
    // No icon picker exists in the portal, so an unknown id must fall back
    // rather than render a tile with no icon at all.
    expect(categoryIcon('a-category-invented-later')).toBe('Wrench')
  })

  it('no store-vertical id survives anywhere in the nav', () => {
    for (const stale of ['car', 'motorcycle', 'tractor']) {
      expect(HOME).not.toContain(`category=${stale}`)
    }
  })
})

describe('the documented environment matches the consumed environment', () => {
  // A variable named wrongly in the example is worse than one left out. It
  // looks set, the deployment looks configured, and the code quietly falls back
  // to a default — which is exactly how production ended up rejecting every
  // admin sign-in from its own domain.
  const EXAMPLE = readFileSync(join(WEB_ROOT, '.env.local.example'), 'utf8')
  const SESSION = readFileSync(join(WEB_ROOT, 'lib/admin-session.ts'), 'utf8')
  const CONFIG = readFileSync(join(WEB_ROOT, 'lib/firebase-config.ts'), 'utf8')

  it('the admin origin variable is named the same in both places', () => {
    expect(SESSION).toContain('process.env.ADMIN_ALLOWED_ORIGINS')
    expect(EXAMPLE).toContain('ADMIN_ALLOWED_ORIGINS')
  })

  it('the name no code reads is not offered as if it worked', () => {
    // Kept only inside the explanatory comment, never as a settable line.
    const settable = EXAMPLE.split('\n').filter((l) => /^#?\s*NPH_ALLOWED_ORIGINS\s*=/.test(l))
    expect(settable).toEqual([])
    expect(SESSION).not.toContain('NPH_ALLOWED_ORIGINS')
  })

  it('the emulator switch is named the same in both places', () => {
    // Set to "true" on a deployed site, this makes the app ignore every real
    // Firebase value and dial 127.0.0.1 — which on Vercel is Vercel.
    expect(CONFIG).toContain("process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true'")
    expect(EXAMPLE).toContain('NEXT_PUBLIC_USE_FIREBASE_EMULATORS')
  })

  it('production is opt-in to emulators, never opt-out', () => {
    // A missing variable must mean "live", so an unconfigured deployment fails
    // loudly on credentials rather than silently pointing at a loopback that
    // is not there.
    expect(CONFIG).toContain("=== 'true'")
    expect(CONFIG).not.toMatch(/NEXT_PUBLIC_USE_FIREBASE_EMULATORS\s*!==\s*'false'/)
  })
})

describe('one canonical domain', () => {
  // Three spellings existed and only the .com was registered. The .ng reached
  // the Paystack return URL, so a dealer completed a real payment and landed on
  // a domain that does not resolve. These pin the survivor.
  const LAYOUT = readFileSync(join(WEB_ROOT, 'app/layout.tsx'), 'utf8')
  const LEGAL = readFileSync(join(WEB_ROOT, 'components/web/legal-page.tsx'), 'utf8')
  const SESSION = readFileSync(join(WEB_ROOT, 'lib/admin-session.ts'), 'utf8')

  it('the contract names the registered domain', async () => {
    const { SITE_ORIGIN, SITE_DOMAIN } = await import('@nph/contracts')
    expect(SITE_ORIGIN).toBe('https://naijapartshub.com')
    expect(SITE_DOMAIN).toBe('naijapartshub.com')
  })

  it('billing points at the dealer page, never the public price list', async () => {
    const { BILLING_PATH } = await import('@nph/contracts')
    expect(BILLING_PATH).toBe('/dealer/subscription')
  })

  for (const [name, source] of [
    ['SEO canonicals', LAYOUT],
    ['legal pages', LEGAL],
    ['the admin origin allowlist', SESSION],
  ] as const) {
    it(`${name} resolve against the shared constant`, () => {
      expect(source).toMatch(/SITE_(ORIGIN|DOMAIN)/)
    })
  }

  it('no unregistered domain survives in the web source', () => {
    const files = [LAYOUT, LEGAL, SESSION]
    for (const source of files) {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      expect(code).not.toMatch(/naijapartshub\.ng|naijahubparts/)
    }
  })
})
