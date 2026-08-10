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

  it('reports what it could not apply rather than pretending it did', () => {
    // Every unindexed combination has to be refined client-side; returning it
    // is what stops the visible list disagreeing with the checked boxes.
    expect(listing).toContain('unapplied')
    expect(planner).toContain('unapplied.state')
    expect(planner).toContain('unapplied.condition')
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
