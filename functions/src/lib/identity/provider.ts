/**
 * The identity-verification boundary.
 *
 * Everything above this interface — the callable, the rate limiter, the
 * fingerprints, the name matching, the admin gate — is provider-agnostic.
 * Swapping Dojah for Prembly, Smile ID or a manual back office should mean
 * writing one new implementation of `IdentityProvider` and changing which one
 * `resolveProvider()` returns, not touching the registration system.
 *
 * That indirection is not speculative. BVN and NIN endpoints are licensed and
 * gated: a provider can lose access, change pricing, or fail approval for this
 * particular business, and the answer to that cannot be a rewrite.
 */

/** What we ask a provider to check. Raw identifiers, never persisted. */
export interface IdentityCheckInput {
  /** 11 digits. Format-validated before this is called — providers charge. */
  bvn: string;
  nin: string;
  /** The name the mechanic submitted, to compare against the government record. */
  fullName: string;
}

/**
 * What a provider tells us.
 *
 * Deliberately narrow. A NIN lookup returns date of birth, address, photograph,
 * marital status and religion; none of that crosses this boundary, so no
 * caller can persist it by accident. If a future provider needs more, widen
 * this type on purpose rather than by passing the raw response through.
 */
export interface IdentityCheckResult {
  /** Did the provider find and confirm both identifiers? */
  bvnValid: boolean;
  ninValid: boolean;
  /**
   * The legal name on the government record, normalised to a single string.
   * Null when the provider confirms the number but returns no name.
   */
  verifiedName: string | null;
  /** The provider's own reference, for disputes and support escalation. */
  reference: string;
}

export interface IdentityProvider {
  /** Stable id stored alongside the result, so an old record stays auditable. */
  readonly name: string;
  check(input: IdentityCheckInput): Promise<IdentityCheckResult>;
}

/**
 * Raised when no provider is configured.
 *
 * A distinct error, not a generic failure, and emphatically not a pass. The
 * difference between "we could not check you" and "you failed the check"
 * matters to the mechanic reading the message and to the administrator
 * reviewing the queue — and a stub that quietly returned success would put
 * unverified mechanics in front of the public, which is the exact outcome the
 * client's requirement exists to prevent.
 */
export class IdentityProviderUnavailable extends Error {
  constructor(message = 'No identity verification provider is configured.') {
    super(message);
    this.name = 'IdentityProviderUnavailable';
  }
}

/**
 * Raised when the provider answered in a shape we do not recognise.
 *
 * Distinct from a failed check, and the distinction is the whole point. An
 * aggregator that renames a field between plan tiers — or returns an envelope
 * we did not anticipate — produces a response where the identity data is
 * simply absent. Reading that as "identity not found" would record an honest
 * mechanic as failing verification because of a change on the provider's side.
 *
 * So the parser fails CLOSED: unrecognised shape raises this, the callable
 * treats it as a platform fault rather than a verdict, the attempt is not
 * counted against the mechanic, and their status is left untouched.
 *
 * The message deliberately names the field that was missing and never the
 * value of anything — this error is the most likely thing to reach Cloud
 * Logging, and the payload it describes contains the subject's personal data.
 */
export class IdentityProviderSchemaError extends Error {
  constructor(
    /** Which endpoint disagreed, e.g. 'bvn' or 'nin'. */
    readonly endpoint: string,
    /** Which key was missing or wrongly typed. Never its value. */
    readonly detail: string,
  ) {
    super(`Unexpected ${endpoint} response shape: ${detail}`);
    this.name = 'IdentityProviderSchemaError';
  }
}
