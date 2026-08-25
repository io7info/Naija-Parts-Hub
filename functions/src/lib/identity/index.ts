import { defineSecret } from 'firebase-functions/params';

import { IdentityProviderUnavailable, type IdentityProvider } from './provider';
import { dojahProvider } from './dojah';
import { parseKeyring, type Keyring } from './fingerprint';

/**
 * Provider credentials, bound to Secret Manager.
 *
 * Never in source, never in an environment file, never in the repository —
 * the same treatment as PAYSTACK_SECRET_KEY and for a stronger reason: these
 * unlock lookups against national identity databases, and every call is
 * billable.
 */
export const DOJAH_APP_ID = defineSecret('DOJAH_APP_ID');
export const DOJAH_SECRET_KEY = defineSecret('DOJAH_SECRET_KEY');

/**
 * Which Dojah environment the credentials belong to.
 *
 * 'sandbox' or 'production'. Required, with no default, because the two are
 * indistinguishable from the key alone and the difference is whether real
 * money is spent against real national databases. An absent value means the
 * provider stays disabled.
 */
export const DOJAH_ENVIRONMENT = defineSecret('DOJAH_ENVIRONMENT');

/**
 * The fingerprint keyring. See fingerprint.ts for the rotation design.
 *
 * A ring rather than a single key, so a compromised key is a controlled
 * migration rather than a permanent unmanaged risk.
 */
export const IDENTITY_FINGERPRINT_KEY = defineSecret('IDENTITY_FINGERPRINT_KEY');

/** Every secret the verification callable needs bound to it. */
export const IDENTITY_SECRETS = [
  DOJAH_APP_ID,
  DOJAH_SECRET_KEY,
  DOJAH_ENVIRONMENT,
  IDENTITY_FINGERPRINT_KEY,
];

/**
 * The configured provider, or a refusal.
 *
 * There is deliberately no fallback, no stub and no development bypass. A
 * simulated verifier would let unverified mechanics reach the public behind a
 * badge saying otherwise — precisely what the client's requirement exists to
 * prevent — and the first person to notice would be a customer.
 *
 * PRODUCTION GATE: `DOJAH_ENVIRONMENT` must be set explicitly. It is not
 * inferred, and there is no default, because the contract tests in
 * test/dojah-contract.test.mjs have to have been run against the sandbox
 * before anyone turns this on. Requiring a deliberate value makes "we never
 * validated the response shapes" impossible to reach by omission.
 */
export function resolveProvider(): IdentityProvider {
  const appId = safeValue(DOJAH_APP_ID);
  const secret = safeValue(DOJAH_SECRET_KEY);
  const environment = safeValue(DOJAH_ENVIRONMENT);

  if (!appId || !secret) {
    throw new IdentityProviderUnavailable(
      'Identity verification is not yet configured for this environment.',
    );
  }

  if (environment !== 'sandbox' && environment !== 'production') {
    throw new IdentityProviderUnavailable(
      'DOJAH_ENVIRONMENT must be set to "sandbox" or "production" before verification is enabled.',
    );
  }

  return dojahProvider({ appId, secretKey: secret });
}

/** The fingerprint keyring, parsed. Throws if the secret is absent or unusable. */
export function resolveKeyring(): Keyring {
  const raw = safeValue(IDENTITY_FINGERPRINT_KEY);
  if (!raw) {
    throw new IdentityProviderUnavailable('Identity fingerprint key is not configured.');
  }
  return parseKeyring(raw);
}

/**
 * Reads a secret without throwing when it is absent.
 *
 * `.value()` raises if the secret was never created, and the point here is to
 * answer "is this configured" without crashing the function that asks.
 */
function safeValue(param: { value(): string }): string | null {
  try {
    const v = param.value();
    return v && v.trim().length > 0 ? v.trim() : null;
  } catch {
    return null;
  }
}

export { IdentityProviderUnavailable, IdentityProviderSchemaError } from './provider';
export type { IdentityProvider, IdentityCheckInput, IdentityCheckResult } from './provider';
export { nameMatchScore, nameTokens } from './nameMatch';
export {
  candidateFingerprints,
  currentFingerprint,
  needsReissue,
  trustCompromised,
  parseKeyring,
  type Keyring,
} from './fingerprint';
export { IN_FLIGHT_SECONDS, isLeaseHeld, leaseDeadlineMs } from './lease';
