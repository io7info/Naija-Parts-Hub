import { BILLING_PATH, SITE_ORIGIN } from '@nph/contracts';

/**
 * The public origin every dealer-facing URL is built from.
 *
 * `SITE_ORIGIN` from the contracts is the canonical answer and the default.
 * `MARKETPLACE_ORIGIN` overrides it, which exists for exactly two situations:
 *
 *   - the emulator, where checkout must return to http://localhost:3000 (or
 *     http://10.0.2.2:3000 from the Android emulator) rather than the live site;
 *   - a preview deployment on a temporary host.
 *
 * Read through this rather than inline, because the failure mode of a wrong
 * origin is not a broken link — it is a dealer completing a Paystack payment
 * and landing on a domain that does not resolve. That happened in testing
 * against the old `.ng` literal: money taken, no confirmation, and nothing on
 * screen to say whether it had worked.
 *
 * A trailing slash is stripped so `${siteOrigin()}${path}` never doubles it.
 */
export function siteOrigin(): string {
  const configured = process.env.MARKETPLACE_ORIGIN?.trim();
  return (configured || SITE_ORIGIN).replace(/\/+$/, '');
}

/** Where a dealer buys or renews a plan. */
export function billingUrl(): string {
  return `${siteOrigin()}${BILLING_PATH}`;
}

export { BILLING_PATH };
