import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Keyed fingerprints of BVN and NIN, with a rotation path.
 *
 * WHY A KEYRING RATHER THAN A KEY
 *
 * A fingerprint exists so one person cannot open several mechanic accounts.
 * It has to survive without the identifier that produced it — we deliberately
 * never store that — which means a compromised key CANNOT be fixed by
 * recomputing the old values. There is nothing to recompute from.
 *
 * The first version of this treated that as "so the key can never rotate",
 * which is not a security posture, it is an unmanaged risk with a comment
 * attached. If the key leaks, an attacker can test candidate identifiers
 * against stored fingerprints offline — an 11-digit space is small enough to
 * enumerate — and there would be no remedy at all.
 *
 * So: the secret holds a ring of keys and a current version. Each stored
 * fingerprint records the version that produced it.
 *
 *   - New writes always use the current key.
 *   - Duplicate lookups test the candidate against EVERY active version, so
 *     records written under an older key are still matched.
 *   - A compromised key is retired by adding a new one and marking the old
 *     `compromised: true` — it stays in the ring for lookup, and a warning is
 *     surfaced so records under it can be re-fingerprinted the next time that
 *     mechanic verifies.
 *
 * Compromise is therefore a controlled migration rather than an outage.
 */

/** The parsed contents of IDENTITY_FINGERPRINT_KEY. */
export interface Keyring {
  current: number;
  /** version -> secret. Every version listed is usable for lookups. */
  keys: Record<string, string>;
  /** Versions no longer trusted for new writes, still needed to match old rows. */
  compromised: number[];
}

/**
 * Parses the secret.
 *
 * Accepts a bare string for backward compatibility: the first deployment of
 * this feature may hold a single key with no envelope, and treating that as
 * version 1 avoids a flag day where the secret and the code must change
 * together.
 *
 * Format for a real ring:
 *   {"current":2,"keys":{"1":"<hex>","2":"<hex>"},"compromised":[1]}
 */
export function parseKeyring(raw: string): Keyring {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) {
    throw new Error('Identity fingerprint key is empty.');
  }

  if (!trimmed.startsWith('{')) {
    return { current: 1, keys: { '1': trimmed }, compromised: [] };
  }

  const parsed = JSON.parse(trimmed) as Partial<Keyring>;
  const keys = parsed.keys ?? {};
  const current = Number(parsed.current);

  if (!Number.isInteger(current) || !keys[String(current)]) {
    throw new Error('Identity fingerprint keyring names no usable current version.');
  }

  return { current, keys, compromised: parsed.compromised ?? [] };
}

/**
 * The fingerprint of one identifier under one key version.
 *
 * HMAC, not a bare hash: both identifiers are exactly eleven digits, so the
 * whole keyspace is 10^11 and an unkeyed SHA-256 is reversible by brute force
 * on a laptop in minutes.
 *
 * The `kind` prefix keeps the same eleven digits used as both a BVN and a NIN
 * from colliding in the duplicate check.
 */
export function fingerprintWith(key: string, kind: 'bvn' | 'nin', digits: string): string {
  return createHmac('sha256', key).update(`${kind}:${digits}`).digest('hex');
}

/** The fingerprint to store, and the version that produced it. */
export function currentFingerprint(
  ring: Keyring,
  kind: 'bvn' | 'nin',
  digits: string,
): { value: string; version: number } {
  const key = ring.keys[String(ring.current)]!;
  return { value: fingerprintWith(key, kind, digits), version: ring.current };
}

/**
 * Every fingerprint this identifier could have, across all live key versions.
 *
 * Duplicate detection queries each: a mechanic who registered under version 1
 * must still be found after the ring rotates to version 2, or rotation would
 * silently reopen the door this check exists to close.
 */
export function candidateFingerprints(
  ring: Keyring,
  kind: 'bvn' | 'nin',
  digits: string,
): string[] {
  return [...new Set(Object.values(ring.keys).map((key) => fingerprintWith(key, kind, digits)))];
}

/**
 * Whether a stored fingerprint should be re-issued under the current key.
 *
 * True for anything not written by the current key. Re-issuing happens on the
 * mechanic's next successful verification — the only moment the raw identifier
 * is legitimately in hand — so this is a housekeeping signal, not an alarm.
 */
export function needsReissue(ring: Keyring, version: number | null | undefined): boolean {
  if (!version) return true;
  return version !== ring.current || ring.compromised.includes(version);
}

/**
 * Whether a record's verification can still be trusted.
 *
 * COMPROMISE IS NOT THE SAME AS STALENESS.
 *
 * A fingerprint written under an older-but-sound key is merely out of date: it
 * still proves what it proved, and it is re-issued at leisure. A fingerprint
 * written under a COMPROMISED key is different, and the difference is the
 * reason this function exists separately from `needsReissue`.
 *
 * When a key leaks, anyone holding it can compute the fingerprint of any
 * candidate identifier and compare it against stored values — an 11-digit
 * space is small enough to enumerate exhaustively. So for records under that
 * key, an attacker can both recover the identifiers AND mint a fingerprint
 * that collides with a real one, which is precisely what the duplicate check
 * relies on being impossible. The verification those records carry can no
 * longer be treated as evidence.
 *
 * The client's requirement: a compromised key "must not silently remain
 * trusted forever". So:
 *
 *   - `adminReviewStore` refuses to approve or reactivate on such a record
 *   - `scripts/flag-compromised-identities.mjs` moves already-approved ones to
 *     manual_review, so the exposure is visible in the admin queue rather than
 *     dormant in the database
 *   - the mechanic re-verifies, which re-fingerprints under the current key
 *
 * Marking a version compromised is therefore an operational act with a defined
 * consequence, not a comment in a JSON blob.
 */
export function trustCompromised(ring: Keyring, version: number | null | undefined): boolean {
  // A record with no version predates versioning. It is stale, not exposed —
  // the key that wrote it is only compromised if it is listed as such, and an
  // unversioned record cannot be attributed to any particular key.
  if (!version) return false;
  return ring.compromised.includes(version);
}

/**
 * Whether a live mechanic record must be pushed back into re-verification.
 *
 * The selection rule for scripts/flag-compromised-identities.mjs, kept here so
 * the script and the approval gate cannot disagree about what "affected"
 * means. Three conditions, all necessary:
 *
 *   - it is a mechanic. Dealers carry no identity block and are never touched.
 *   - the record currently claims to be verified. An application already
 *     unverified, failed or in manual review is going through review anyway.
 *   - it was fingerprinted under a withdrawn key.
 *
 * Idempotence follows from the second condition: once flagged, the status is
 * no longer 'verified', so a second run selects nothing.
 */
export function shouldFlagForReverification(
  store: {
    businessType?: string;
    identity?: { status?: string; fingerprintKeyVersion?: number | null } | null;
  },
  ring: Keyring,
): boolean {
  if (store.businessType !== 'mechanic') return false;
  if (store.identity?.status !== 'verified') return false;
  return trustCompromised(ring, store.identity?.fingerprintKeyVersion);
}

/** Constant-time comparison, for anywhere a fingerprint is checked directly. */
export function fingerprintEquals(a: string, b: string): boolean {
  const left = Buffer.from(a ?? '', 'utf8');
  const right = Buffer.from(b ?? '', 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
