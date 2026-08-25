import {
  IdentityProviderSchemaError,
  type IdentityCheckInput,
  type IdentityCheckResult,
  type IdentityProvider,
} from './provider';

/**
 * Dojah — BVN and NIN lookups against NIBSS and NIMC.
 *
 * NOT YET EXERCISED AGAINST A REAL ENDPOINT. Lytod Motors' account is not
 * approved for production BVN/NIN, so `resolveProvider()` refuses before
 * reaching this code. test/dojah-contract.test.mjs must pass against the
 * sandbox before this is enabled — see the header there for why that gate
 * exists rather than trusting the documentation.
 *
 * WHAT CROSSES THIS BOUNDARY
 *
 * Four fields. The responses contain date of birth, residential address,
 * photograph, gender, marital status, employment status and religion; none of
 * it leaves this file, so no caller can persist it by accident and no thrown
 * error can carry it into a log.
 */

const BASE = 'https://api.dojah.io';
const ELEVEN_DIGITS = /^\d{11}$/;

/**
 * Distinguishes "no such record" from "we do not understand this response".
 *
 * A lookup that legitimately finds nothing is a verdict about the mechanic.
 * A response missing the field we read is a fault on our side or theirs, and
 * conflating the two is how a provider change turns into a queue of honest
 * people marked as failing verification.
 */
type Lookup =
  | { outcome: 'found'; entity: Record<string, unknown> }
  | { outcome: 'not_found' };

export function dojahProvider(credentials: { appId: string; secretKey: string }): IdentityProvider {
  async function lookup(endpoint: 'bvn' | 'nin', path: string, params: Record<string, string>): Promise<Lookup> {
    const url = `${BASE}${path}?${new URLSearchParams(params).toString()}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          // Dojah authenticates on two headers, not a bearer token.
          AppId: credentials.appId,
          Authorization: credentials.secretKey,
          Accept: 'application/json',
        },
        // A hung provider must not hold the callable open to the platform
        // timeout: a mechanic is watching a registration screen.
        signal: AbortSignal.timeout(20_000),
      });
    } catch (cause) {
      // Network faults are transport failures, not verdicts.
      throw new Error(`Dojah ${endpoint} request failed`, { cause: undefined });
    }

    // 404 is the documented "no record", and is a real answer about the
    // subject rather than a fault.
    if (response.status === 404) return { outcome: 'not_found' };

    if (!response.ok) {
      // The body is never included: it carries the subject's personal data,
      // and a thrown message is the most likely thing to reach Cloud Logging.
      throw new IdentityProviderSchemaError(endpoint, `HTTP ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new IdentityProviderSchemaError(endpoint, 'body was not JSON');
    }

    if (typeof body !== 'object' || body === null) {
      throw new IdentityProviderSchemaError(endpoint, 'body was not an object');
    }

    // Dojah wraps results in `entity`. Its absence is ambiguous — it can mean
    // "not found" or "we changed the envelope" — so it is only read as a
    // negative when the payload also says so explicitly. Anything else fails
    // closed.
    const record = body as Record<string, unknown>;
    if (!('entity' in record)) {
      const status = record['status'];
      const message = typeof record['message'] === 'string' ? record['message'] : '';
      if (status === false || /not\s*found|no\s*record|invalid/i.test(message)) {
        return { outcome: 'not_found' };
      }
      throw new IdentityProviderSchemaError(endpoint, 'response carried no "entity" and no recognisable negative');
    }

    const entity = record['entity'];
    if (entity === null || entity === undefined) return { outcome: 'not_found' };

    if (typeof entity !== 'object' || Array.isArray(entity)) {
      throw new IdentityProviderSchemaError(endpoint, '"entity" was not an object');
    }

    return { outcome: 'found', entity: entity as Record<string, unknown> };
  }

  /**
   * The legal name from a record.
   *
   * Raises rather than returning null when the record exists but carries no
   * name at all: a found identity with no name would score zero on the match
   * and send an honest mechanic to manual review for a schema change.
   */
  function requireName(endpoint: string, entity: Record<string, unknown>): string {
    const parts = ['first_name', 'middle_name', 'last_name', 'surname']
      .map((k) => entity[k])
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim());

    if (parts.length > 0) return [...new Set(parts)].join(' ');

    const full = entity['full_name'] ?? entity['fullName'];
    if (typeof full === 'string' && full.trim().length > 0) return full.trim();

    throw new IdentityProviderSchemaError(endpoint, 'record carried no name field');
  }

  return {
    name: 'dojah',

    async check(input: IdentityCheckInput): Promise<IdentityCheckResult> {
      // Belt and braces — the callable validates first, because a malformed
      // number would otherwise be a paid request that could only ever fail.
      if (!ELEVEN_DIGITS.test(input.bvn) || !ELEVEN_DIGITS.test(input.nin)) {
        throw new Error('Identifier failed format validation before lookup.');
      }

      // Sequential, BVN first: a failed BVN makes the NIN call wasted money,
      // and both are billed per request.
      const bvn = await lookup('bvn', '/api/v1/kyc/bvn/full', { bvn: input.bvn });
      if (bvn.outcome === 'not_found') {
        return { bvnValid: false, ninValid: false, verifiedName: null, reference: newReference() };
      }

      const nin = await lookup('nin', '/api/v1/kyc/nin', { nin: input.nin });
      if (nin.outcome === 'not_found') {
        return { bvnValid: true, ninValid: false, verifiedName: null, reference: newReference() };
      }

      // The NIN record is the naming authority when both exist: it is the
      // government's general identity register, where a BVN is a banking
      // record that can carry an older name.
      return {
        bvnValid: true,
        ninValid: true,
        verifiedName: requireName('nin', nin.entity),
        reference: newReference(),
      };
    },
  };
}

/**
 * Our own correlation id for this check.
 *
 * Dojah returns no stable per-request reference on these endpoints, and an
 * audit trail that cannot name the transaction it describes is not one.
 * Derived from the clock and randomness, never from either identifier: a
 * reference must not be a route back to the number it refers to.
 */
function newReference(): string {
  return `idv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
