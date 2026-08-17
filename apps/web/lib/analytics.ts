/**
 * Google Analytics 4 configuration.
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
