import { describe, expect, it } from 'vitest'

import {
  formatNaira,
  formatNigerianPhone,
  koboToNaira,
  toE164Digits,
} from '../lib/marketplace'

describe('koboToNaira', () => {
  it('converts integer kobo to naira', () => {
    // A factor-of-100 slip here misprices every listing on the marketplace, so
    // the boundary is pinned rather than assumed.
    expect(koboToNaira(4_500_000)).toBe(45_000)
    expect(koboToNaira(100)).toBe(1)
    expect(koboToNaira(0)).toBe(0)
  })

  it('treats missing or malformed values as zero, never NaN', () => {
    // NaN reaches the page as "₦NaN", which looks like a broken site rather
    // than a listing with no price.
    expect(koboToNaira(undefined as unknown as number)).toBe(0)
    expect(koboToNaira(null as unknown as number)).toBe(0)
    expect(koboToNaira('nonsense' as unknown as number)).toBe(0)
  })
})

describe('formatNaira', () => {
  it('groups thousands and prefixes the naira sign', () => {
    expect(formatNaira(45_000)).toBe('₦45,000')
    expect(formatNaira(1_450_000)).toBe('₦1,450,000')
  })
})

describe('toE164Digits', () => {
  it('replaces the Nigerian trunk zero with the country code', () => {
    // Dealers type 0803…; wa.me needs 234803…. Passing "2340803…" opens a chat
    // with nobody, silently.
    expect(toE164Digits('08036726262')).toBe('2348036726262')
  })

  it('accepts numbers already in international form', () => {
    expect(toE164Digits('+234 903 672 6262')).toBe('2349036726262')
    expect(toE164Digits('2349036726262')).toBe('2349036726262')
  })

  it('strips spaces, dashes and parentheses', () => {
    expect(toE164Digits('+234 (0)903-672-6262')).toBe('2349036726262')
  })

  it('returns empty for a missing number so the caller can disable the action', () => {
    expect(toE164Digits('')).toBe('')
    expect(toE164Digits(undefined as unknown as string)).toBe('')
  })
})

describe('formatNigerianPhone', () => {
  it('renders a readable international number', () => {
    expect(formatNigerianPhone('08036726262')).toBe('+234 803 672 6262')
    expect(formatNigerianPhone('+2349036726262')).toBe('+234 903 672 6262')
  })

  it('passes through anything it cannot parse rather than mangling it', () => {
    expect(formatNigerianPhone('123')).toBe('123')
  })
})
