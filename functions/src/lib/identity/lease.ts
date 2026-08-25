import { toInstant } from '../subscription';

/**
 * The single-flight lease on a verification.
 *
 * Two concurrent submissions must not both reach a billable endpoint, so the
 * first writes `identity.inFlightUntil` inside a transaction and the second is
 * refused. The subtlety is what happens when the first one never finishes.
 *
 * A lease is a DEADLINE, not a lock. Nothing is guaranteed to release it:
 *
 *   - the provider hangs and the function is killed at the platform timeout
 *   - the instance crashes or is evicted mid-call
 *   - a schema failure exits through a path that cannot write
 *   - the release write itself fails
 *
 * A lock would leave the mechanic permanently unable to retry, and the only
 * remedy would be an administrator editing Firestore by hand. Because it is a
 * deadline, every one of those cases recovers on its own: once the clock
 * passes, the lease is simply gone.
 *
 * IN_FLIGHT_SECONDS is therefore chosen against the worst honest case — two
 * sequential provider lookups at 20s each — with enough margin that a slow
 * call is never overtaken, and short enough that a crash costs the mechanic a
 * wait rather than a support ticket.
 */

/** Comfortably longer than two 20s provider lookups; short enough to recover. */
export const IN_FLIGHT_SECONDS = 90;

/**
 * Whether a verification is currently claimed.
 *
 * False for absent, null, malformed, and — critically — expired. Expired means
 * the previous attempt died without releasing, and refusing the retry would
 * punish the mechanic for our crash.
 */
export function isLeaseHeld(inFlightUntil: unknown, nowMs: number): boolean {
  const deadline = toInstant(inFlightUntil);
  return deadline !== null && deadline > nowMs;
}

/** The deadline to write when claiming. */
export function leaseDeadlineMs(nowMs: number): number {
  return nowMs + IN_FLIGHT_SECONDS * 1000;
}
