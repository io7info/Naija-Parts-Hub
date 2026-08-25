import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { businessTypeOf, isMechanic, isPartsDealer, identityVerified } from '@nph/contracts'

const WEB_ROOT = join(__dirname, '..')
const REPO_ROOT = join(WEB_ROOT, '..', '..')
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8')

/**
 * The guard that keeps mechanics out of dealer surfaces.
 *
 * A missed filter does not fail loudly. A mechanic simply appears in the
 * dealer directory with zero listings and a storefront selling nothing — a
 * bug a passing test suite would never notice and a buyer would.
 */
describe('public store queries are filtered by business type', () => {
  const source = read('apps/web/lib/repositories/marketplace.ts')
  const DEALERS = 'function publicDealers'
  const MECHANICS = 'function publicMechanics'

  it('stores is queried only from the two guarded helpers', () => {
    // Exactly two: publicDealers and publicMechanics. A third means someone
    // has hand-rolled a query that can skip the business-type filter, and the
    // symptom would be mechanics listed as dealers rather than an error.
    const queries = source.match(/\.collection\('stores'\)/g) ?? []
    expect(queries.length).toBe(2)

    for (const helper of [DEALERS, MECHANICS]) {
      const body = source.slice(source.indexOf(helper), source.indexOf(helper) + 400)
      expect(body, `${helper} must own its query`).toContain(".collection('stores')")
    }
  })

  it('each helper pins its own business type', () => {
    // Two helpers rather than one taking a parameter, deliberately: a caller
    // passing the wrong argument would render mechanics through a dealer
    // surface, which is exactly what the client ruled out.
    const dealers = source.slice(source.indexOf(DEALERS), source.indexOf(DEALERS) + 400)
    expect(dealers).toContain("'status', '==', 'approved'")
    expect(dealers).toContain("'visible', '==', true")
    expect(dealers).toContain("'businessType', '==', 'parts_dealer'")

    const mechanics = source.slice(source.indexOf(MECHANICS), source.indexOf(MECHANICS) + 400)
    expect(mechanics).toContain("'status', '==', 'approved'")
    expect(mechanics).toContain("'visible', '==', true")
    expect(mechanics).toContain("'businessType', '==', 'mechanic'")
  })

  it('the mechanic projection never reads the identity block', () => {
    // toMechanic is serialised into public HTML. Last-four digits,
    // fingerprints and the verified legal name are admin-only, and the surest
    // way to keep them out is for this function not to mention them.
    const projection = source.slice(
      source.indexOf('function toMechanic'),
      source.indexOf('export type MechanicQuery'),
    )
    expect(projection.length).toBeGreaterThan(0)
    for (const field of ['identity', 'bvn', 'nin', 'Fingerprint', 'verifiedName', 'cacNumber']) {
      expect(projection, `toMechanic exposes ${field}`).not.toContain(field)
    }
  })
})

describe('the composite indexes exist for those queries', () => {
  // A missing index does not degrade the query, it throws FAILED_PRECONDITION
  // — so the dealer directory would 500 rather than return fewer results.
  const indexes = JSON.parse(read('firebase/firestore.indexes.json')).indexes as Array<{
    collectionGroup: string
    fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }>
  }>

  const has = (fields: string[]) =>
    indexes.some(
      (i) =>
        i.collectionGroup === 'stores' &&
        i.fields.length === fields.length &&
        fields.every((f, n) => i.fields[n]?.fieldPath === f),
    )

  it('covers the dealer directory and state filter', () => {
    expect(has(['businessType', 'status', 'visible'])).toBe(true)
  })

  it('covers the storefront lookup by slug', () => {
    expect(has(['businessType', 'status', 'visible', 'slug'])).toBe(true)
  })

  it('covers mechanic discovery by state and by service', () => {
    expect(has(['businessType', 'status', 'visible', 'state'])).toBe(true)
    expect(has(['businessType', 'status', 'visible', 'mechanic.specialties'])).toBe(true)
  })
})

describe('legacy stores without businessType resolve as parts dealers', () => {
  it('treats a missing field as parts_dealer', () => {
    // Every store registered before this feature has no businessType. Reading
    // the property directly yields undefined, which matches neither member of
    // the union and would drop those dealers out of any branch.
    expect(businessTypeOf({})).toBe('parts_dealer')
    expect(businessTypeOf(undefined)).toBe('parts_dealer')
    expect(businessTypeOf(null)).toBe('parts_dealer')
    expect(isPartsDealer({})).toBe(true)
    expect(isMechanic({})).toBe(false)
  })

  it('respects an explicit type', () => {
    expect(businessTypeOf({ businessType: 'mechanic' })).toBe('mechanic')
    expect(isMechanic({ businessType: 'mechanic' })).toBe(true)
    expect(isPartsDealer({ businessType: 'mechanic' })).toBe(false)
  })

  it('treats an unrecognised value as a dealer rather than throwing', () => {
    // Defensive: a value written by a future version, or corrupted, must not
    // crash a page. Dealer is the safe default — it grants nothing a mechanic
    // would not already have.
    expect(businessTypeOf({ businessType: 'towing' as never })).toBe('parts_dealer')
  })
})

describe('identity gating', () => {
  it('only a verified status counts', () => {
    // The client requires BVN and NIN verification before a mechanic can be
    // approved. Every other state — including manual_review — is not verified.
    expect(identityVerified({ identity: { status: 'verified' } as never })).toBe(true)
    for (const status of ['unverified', 'pending', 'failed', 'manual_review']) {
      expect(identityVerified({ identity: { status } as never })).toBe(false)
    }
  })

  it('a dealer with no identity block is not "verified"', () => {
    // Dealers never carry one. This must not be read as a pass for a mechanic
    // whose block failed to write.
    expect(identityVerified({})).toBe(false)
    expect(identityVerified(undefined)).toBe(false)
  })
})

describe('identity fields are backend-controlled', () => {
  const rules = read('firebase/firestore.rules')

  it('businessType and identity are in the rules backend list', () => {
    const block = rules.slice(
      rules.indexOf('function storeBackendFields'),
      rules.indexOf('function storeDealerFields'),
    )
    expect(block).toContain("'businessType'")
    expect(block).toContain("'identity'")
  })

  it('the mechanic profile is owner-editable but capped', () => {
    expect(rules).toContain('validMechanicProfile')
    // MAX_WORKSHOP_PHOTOS. An uncapped array is a way to grow one document
    // past the 1MB limit until its owner can no longer read it.
    expect(rules).toMatch(/photos\.size\(\)\s*<=\s*10/)
  })

  it('CAC is required for dealers and optional for mechanics', () => {
    expect(rules).toContain('validStoreProfile(request.resource.data, !isMechanicDoc())')
    expect(rules).toContain('function isMechanicDoc')
  })
})
