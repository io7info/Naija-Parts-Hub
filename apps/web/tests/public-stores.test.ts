import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LISTING_CATEGORIES } from '@nph/contracts'
import { describe, expect, it } from 'vitest'

import { categories } from '../lib/marketplace'

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

describe('every homepage category tile can match a real listing', () => {
  const HOME = readFileSync(join(WEB_ROOT, 'app/(site)/page.tsx'), 'utf8')
  const SEED = readFileSync(
    join(WEB_ROOT, '../../functions/scripts/seed-production-categories.mjs'),
    'utf8',
  )
  const ids = categories.map((c) => c.id)

  it('the nav is not empty', () => {
    expect(ids.length).toBe(LISTING_CATEGORIES.length)
  })

  for (const id of LISTING_CATEGORIES.map((c) => c.id)) {
    it(`${id} is offered on the homepage`, () => {
      expect(ids).toContain(id)
    })
  }

  it('every tile id is one the production seed creates', () => {
    // The seed derives its documents from the same constant, so this asserts
    // the wiring rather than a copied list — a tile can only exist for an id
    // that will have a `categories/{id}` document.
    expect(SEED).toContain("from '@nph/contracts'")
    expect(SEED).toContain('LISTING_CATEGORIES')
  })

  it('every tile id is one a dealer can actually file a part under', () => {
    // The regression this replaces: the tiles rendered AUTOMOTIVE_CATEGORIES,
    // which is the vertical a *store* declares, and linked them to a
    // categoryId filter. Five of six could never match anything.
    const dealerSelectable = new Set(LISTING_CATEGORIES.map((c) => c.id))
    for (const id of ids) {
      expect(dealerSelectable.has(id as (typeof LISTING_CATEGORIES)[number]['id'])).toBe(true)
    }
  })

  it('no store-vertical id survives in the nav', () => {
    for (const stale of ['car', 'motorcycle', 'truck', 'tractor', 'heavy']) {
      expect(ids).not.toContain(stale)
    }
  })

  it('the homepage links each tile to the category query the marketplace reads', () => {
    expect(HOME).toContain('/parts?category=${c.id}')
    expect(REPO).toContain("where('categoryId', '==', options.categoryId)")
  })

  it('every tile has an icon the card can resolve', () => {
    const UI = readFileSync(join(WEB_ROOT, 'components/brand/ui-bits.tsx'), 'utf8')
    // A missing entry silently falls back to the Car icon, so every category
    // would render identically rather than failing.
    for (const c of categories) {
      expect(UI, `iconMap has no ${c.icon} for ${c.id}`).toContain(`\n  ${c.icon},`)
    }
  })
})

describe('public listings are gated on the backend-maintained flag', () => {
  it('listPublicListings filters on publiclyVisible', () => {
    expect(body('listPublicListings')).toContain("where('publiclyVisible', '==', true)")
  })

  it('getPublicListing rejects a listing that is not publicly visible', () => {
    // A direct id lookup has no query filter, so the check has to be explicit —
    // otherwise anyone with a listing id could read an unpublished draft.
    expect(body('getPublicListing')).toContain('publiclyVisible')
  })
})
