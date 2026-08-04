import {
  HttpsError,
  type CallableRequest,
  type FunctionsErrorCode,
} from 'firebase-functions/v2/https';
import { ADMIN_CLAIM, ADMIN_CLAIM_VALUE, type ErrorCode } from '@nph/contracts';

/**
 * Auth and input guards shared by every callable.
 *
 * `details.code` carries a machine-readable ErrorCode so clients can branch —
 * LIMIT_REACHED in particular is what drives the upgrade prompt (SOW section 5).
 */

export function fail(
  httpsCode: FunctionsErrorCode,
  code: ErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): never {
  throw new HttpsError(httpsCode, message, { code, ...extra });
}

/** Returns the caller's uid, or throws unauthenticated. */
export function requireAuth(request: CallableRequest): string {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  return uid;
}

/**
 * Admin identity comes from a custom claim set via the Admin SDK only. It is
 * deliberately never read from a Firestore document — a document a dealer could
 * reach would make privilege escalation one write away.
 */
export function requireAdmin(request: CallableRequest): string {
  const uid = requireAuth(request);
  const claims = request.auth?.token as Record<string, unknown> | undefined;
  if (claims?.[ADMIN_CLAIM] !== ADMIN_CLAIM_VALUE) {
    throw new HttpsError('permission-denied', 'Administrator access required.');
  }
  return uid;
}

export function requireString(
  value: unknown,
  field: string,
  { min = 1, max = 500 }: { min?: number; max?: number } = {},
): string {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new HttpsError(
      'invalid-argument',
      `${field} must be between ${min} and ${max} characters.`,
    );
  }
  return trimmed;
}

export function requireOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new HttpsError('invalid-argument', `${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}
