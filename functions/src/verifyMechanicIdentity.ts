import { onCall } from 'firebase-functions/v2/https';
import {
  ERROR_CODE,
  IDENTITY_LOCKOUT_MINUTES,
  IDENTITY_MAX_ATTEMPTS,
  IDENTITY_NAME_MATCH_THRESHOLD,
  isMechanic,
  type IdentityStatus,
  type Store,
  type VerifyMechanicIdentityRequest,
  type VerifyMechanicIdentityResponse,
} from '@nph/contracts';
import { COL, Timestamp, db, storeRef } from './lib/admin';
import { fail, requireAuth, requireString } from './lib/guards';
import { toInstant } from './lib/subscription';
import {
  IDENTITY_SECRETS,
  IdentityProviderSchemaError,
  IdentityProviderUnavailable,
  candidateFingerprints,
  currentFingerprint,
  isLeaseHeld,
  leaseDeadlineMs,
  nameMatchScore,
  resolveKeyring,
  resolveProvider,
} from './lib/identity';

/**
 * BVN and NIN verification for auto mechanics (client requirement).
 *
 * THE ONLY PLACE RAW IDENTIFIERS EXIST
 *
 * They arrive over HTTPS in this request, live as local variables for the
 * duration of one provider call, and end there. They are never written to
 * Firestore, never logged, never returned to the caller, never attached to an
 * error and never placed in a URL. What survives is the last four digits, a
 * keyed fingerprint, and the verdict.
 *
 * Every `fail()` below says nothing about the input. An error message is the
 * single most likely thing to reach Cloud Logging, and "BVN 22141234567 not
 * found" in a log is the same breach as storing it.
 *
 * ACCESS AND ABUSE CONTROLS
 *
 *   authenticated   requireAuth — no anonymous caller reaches the provider
 *   owner-only      operates on storeRef(uid) from the token; a caller cannot
 *                   name another store, so there is no id to tamper with
 *   mechanic-only   dealers are refused, keeping BVN/NIN out of their flow
 *   rate-limited    IDENTITY_MAX_ATTEMPTS then a timed lockout
 *   single-flight   a transactional claim, so two concurrent submits cannot
 *                   both reach a billable endpoint
 *   validated       format checked before anything chargeable happens
 *   App Check       enforced when APP_CHECK_ENFORCED is set — see below
 *
 * Every one of those exists because each provider call costs the client money.
 * An unprotected endpoint here is not merely a nuisance, it is a way to spend
 * someone else's balance.
 */

/**
 * App Check enforcement.
 *
 * Off by default and deliberately so: the Firebase App Check API is not yet
 * enabled on this project and the Flutter app carries no attestation provider,
 * so switching it on now would reject every legitimate call. It is wired as a
 * flag rather than omitted, so enabling it is a configuration change rather
 * than a code change once the app ships with App Check.
 *
 * To enable: turn on the App Check API, register the Android and iOS apps
 * (Play Integrity / DeviceCheck), add firebase_app_check to the Flutter app,
 * then set APP_CHECK_ENFORCED=true in the function's environment.
 */
const APP_CHECK_ENFORCED = process.env.APP_CHECK_ENFORCED === 'true';

export const verifyMechanicIdentity = onCall<
  VerifyMechanicIdentityRequest,
  Promise<VerifyMechanicIdentityResponse>
>({ secrets: IDENTITY_SECRETS, enforceAppCheck: APP_CHECK_ENFORCED }, async (request) => {
  const uid = requireAuth(request);

  // --- Input validation, before anything billable ----------------------------
  // A malformed number is a request that could only ever fail, so it must not
  // become a paid one — and it must not consume the caller's attempt budget.

  const bvn = digitsOnly(request.data?.bvn);
  const nin = digitsOnly(request.data?.nin);
  const fullName = requireString(request.data?.fullName, 'fullName', { max: 200 });

  if (bvn.length !== 11 || nin.length !== 11) {
    // Deliberately does not echo what was sent.
    fail('invalid-argument', ERROR_CODE.IDENTITY_CHECK_FAILED, 'BVN and NIN must each be 11 digits.');
  }

  // --- Claim the attempt -----------------------------------------------------
  // One transaction reads the store, checks every precondition, and marks the
  // attempt in flight. Two concurrent submissions contend on the same document,
  // so Firestore serialises them and the loser is refused before it can reach
  // a chargeable endpoint. Doing these checks outside a transaction would let
  // a double-tap bill the client twice.

  const nowMs = Date.now();
  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(storeRef(uid));
    if (!snap.exists) {
      fail('not-found', ERROR_CODE.STORE_NOT_APPROVED, 'Register your business first.');
    }
    const store = snap.data() as Store;

    // Dealers have no identity block and the client asked for none. Refusing
    // here keeps BVN and NIN out of the parts dealer flow entirely rather than
    // trusting the dealer app never to call this.
    if (!isMechanic(store)) {
      fail(
        'failed-precondition',
        ERROR_CODE.WRONG_BUSINESS_TYPE,
        'Identity verification applies to mechanic accounts only.',
      );
    }

    const identity = store.identity;

    // Idempotent for a client that retries: already verified returns the
    // stored result rather than paying for the same answer again.
    if (identity?.status === 'verified') {
      return { alreadyVerified: true as const, identity };
    }

    const lockedUntilMs = toInstant(identity?.lockedUntil);
    if (lockedUntilMs && lockedUntilMs > nowMs) {
      const minutes = Math.ceil((lockedUntilMs - nowMs) / 60_000);
      fail(
        'resource-exhausted',
        ERROR_CODE.IDENTITY_ATTEMPTS_EXCEEDED,
        `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      );
    }

    // A verification already running for this store. The lease is a deadline
    // rather than a lock, so a crashed or timed-out attempt recovers on its
    // own once it expires — see lib/identity/lease.ts.
    if (isLeaseHeld((identity as { inFlightUntil?: unknown } | undefined)?.inFlightUntil, nowMs)) {
      fail(
        'already-exists',
        ERROR_CODE.IDENTITY_CHECK_FAILED,
        'A verification is already in progress. Please wait for it to finish.',
      );
    }

    const attempts = identity?.attempts ?? 0;
    if (attempts >= IDENTITY_MAX_ATTEMPTS) {
      tx.update(storeRef(uid), {
        'identity.lockedUntil': Timestamp.fromMillis(nowMs + IDENTITY_LOCKOUT_MINUTES * 60_000),
      });
      fail(
        'resource-exhausted',
        ERROR_CODE.IDENTITY_ATTEMPTS_EXCEEDED,
        `Too many attempts. Try again in ${IDENTITY_LOCKOUT_MINUTES} minutes.`,
      );
    }

    // The claim itself. `attempts` is NOT incremented here — a provider that
    // is unconfigured or answers in a shape we cannot read is our fault, and
    // must not consume the mechanic's budget. It is incremented only once a
    // real verdict has been reached.
    tx.update(storeRef(uid), {
      'identity.inFlightUntil': Timestamp.fromMillis(leaseDeadlineMs(nowMs)),
    });

    return { alreadyVerified: false as const, attempts };
  });

  if (claim.alreadyVerified) {
    const identity = claim.identity!;
    return {
      status: 'verified',
      reference: identity.reference,
      nameMatch: identity.nameMatch,
      attemptsRemaining: Math.max(0, IDENTITY_MAX_ATTEMPTS - (identity.attempts ?? 0)),
    };
  }

  // From here every exit must release the claim, or a failed attempt would
  // lock the mechanic out for IN_FLIGHT_SECONDS with no way to retry.
  try {
    return await runCheck(uid, claim.attempts, { bvn, nin, fullName });
  } finally {
    await storeRef(uid)
      .update({ 'identity.inFlightUntil': null })
      // A release failure must not mask the real outcome; the lease expires
      // on its own regardless.
      .catch(() => undefined);
  }
});

async function runCheck(
  uid: string,
  attempts: number,
  input: { bvn: string; nin: string; fullName: string },
): Promise<VerifyMechanicIdentityResponse> {
  const keyring = resolveKeyringOrFail();

  // --- Duplicate identity ----------------------------------------------------
  // One person, one mechanic account. Matched on fingerprints so the raw
  // identifiers are never queried, stored or compared in the clear.
  //
  // Every live key version is tested, not just the current one: a mechanic who
  // registered before a key rotation must still be found, or rotating would
  // silently reopen the door this check exists to close.

  for (const [field, kind] of [
    ['identity.bvnFingerprint', 'bvn'],
    ['identity.ninFingerprint', 'nin'],
  ] as const) {
    for (const candidate of candidateFingerprints(keyring, kind, input[kind])) {
      const clash = await db.collection(COL.stores).where(field, '==', candidate).limit(1).get();
      const owner = clash.docs[0];
      if (owner && owner.id !== uid) {
        fail(
          'already-exists',
          ERROR_CODE.IDENTITY_ALREADY_USED,
          'These identity details are already registered to another account.',
        );
      }
    }
  }

  // --- The provider call -----------------------------------------------------

  let provider;
  try {
    provider = resolveProvider();
  } catch (error) {
    if (error instanceof IdentityProviderUnavailable) {
      // Not a failure of this person's identity, and it must never be recorded
      // as one: no attempt is counted, and the status stays as it was rather
      // than moving to 'failed'.
      // Provably never attempted: resolveProvider() throws before a provider
      // object exists, so nothing was ever sent. This is the only class of
      // failure where the stronger assurance below is true.
      fail(
        'unavailable',
        ERROR_CODE.IDENTITY_PROVIDER_UNAVAILABLE,
        'Identity verification is temporarily unavailable and your details were not sent ' +
          'to the verification provider. Your registration has been saved. Please try ' +
          'again later.',
      );
    }
    throw error;
  }

  let result;
  try {
    result = await provider.check(input);
  } catch (error) {
    // A response we cannot parse is a platform fault, not a verdict. Recording
    // it as a failed identity would mark honest mechanics as failing because a
    // provider renamed a field.
    if (error instanceof IdentityProviderSchemaError) {
      // Names the endpoint and the missing key, never a value.
      console.error('identity: provider schema mismatch', {
        endpoint: error.endpoint,
        detail: error.detail,
      });
      // The request DID reach the provider — this error comes out of
      // provider.check() — so the identifiers may already be on Dojah's side.
      // Claiming they were not sent would be a privacy assurance we cannot
      // stand behind. All we can honestly say is that we do not keep them.
      fail(
        'internal',
        ERROR_CODE.IDENTITY_PROVIDER_UNAVAILABLE,
        'Identity verification could not be completed right now. Your registration has ' +
          'been saved, and we do not store your full BVN or NIN. Please try again later.',
      );
    }

    // Any other provider error is swallowed on purpose: it can quote the
    // identifier or the subject's personal data, and rethrowing would put that
    // in Cloud Logging. This one does count as an attempt — the request
    // reached the provider and was billed.
    await recordAttempt(uid, attempts + 1, 'failed', {});
    fail(
      'unavailable',
      ERROR_CODE.IDENTITY_CHECK_FAILED,
      'We could not complete the identity check. Please try again shortly.',
    );
  }

  // --- Verdict ---------------------------------------------------------------

  const attemptNumber = attempts + 1;
  const score = result.verifiedName ? nameMatchScore(input.fullName, result.verifiedName) : 0;
  const nameMatch = score >= IDENTITY_NAME_MATCH_THRESHOLD;

  let status: IdentityStatus;
  if (!result.bvnValid || !result.ninValid) {
    status = 'failed';
  } else if (nameMatch) {
    status = 'verified';
  } else {
    // Both numbers are real but the name disagrees. Not automatically fraud —
    // a marriage, a dropped middle name, a NIMC typo — so an administrator
    // decides rather than a threshold.
    status = 'manual_review';
  }

  const bvnPrint = currentFingerprint(keyring, 'bvn', input.bvn);
  const ninPrint = currentFingerprint(keyring, 'nin', input.nin);

  await recordAttempt(uid, attemptNumber, status, {
    provider: provider.name,
    reference: result.reference,
    verifiedAt: status === 'verified' ? Timestamp.now() : null,
    // Last four only: enough for a mechanic to recognise which number they
    // used, useless to anyone who obtains the database.
    bvnLast4: input.bvn.slice(-4),
    ninLast4: input.nin.slice(-4),
    bvnFingerprint: bvnPrint.value,
    ninFingerprint: ninPrint.value,
    // Which key produced them, so a future rotation can tell what still needs
    // re-issuing. See fingerprint.ts.
    fingerprintKeyVersion: bvnPrint.version,
    nameMatch,
    // Admin-readable so a human can resolve manual_review; never public.
    verifiedName: result.verifiedName,
  });

  return {
    status,
    reference: result.reference,
    nameMatch,
    attemptsRemaining: Math.max(0, IDENTITY_MAX_ATTEMPTS - attemptNumber),
  };
}

/**
 * The keyring, or a refusal that is never mistaken for a failed identity.
 *
 * Resolved first, before the duplicate check and long before the provider
 * call, so a failure here provably sent nothing anywhere.
 */
function resolveKeyringOrFail() {
  try {
    return resolveKeyring();
  } catch {
    fail(
      'unavailable',
      ERROR_CODE.IDENTITY_PROVIDER_UNAVAILABLE,
      'Identity verification is temporarily unavailable and your details were not sent ' +
        'to the verification provider. Your registration has been saved. Please try ' +
        'again later.',
    );
    throw new Error('unreachable');
  }
}

/** Strips everything that is not a digit. Spaces and dashes are common. */
function digitsOnly(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

/** Writes the outcome. Never receives, and so cannot write, a raw identifier. */
async function recordAttempt(
  uid: string,
  attempts: number,
  status: IdentityStatus,
  fields: Record<string, unknown>,
): Promise<void> {
  const patch: Record<string, unknown> = {
    updatedAt: Timestamp.now(),
    'identity.status': status,
    'identity.attempts': attempts,
  };
  for (const [k, v] of Object.entries(fields)) patch[`identity.${k}`] = v;
  await storeRef(uid).update(patch);
}
