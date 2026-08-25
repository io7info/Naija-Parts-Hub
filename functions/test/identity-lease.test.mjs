import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { IN_FLIGHT_SECONDS, isLeaseHeld, leaseDeadlineMs } from '../lib/lib/identity/lease.js';
import {
  parseKeyring,
  trustCompromised,
  needsReissue,
  shouldFlagForReverification,
} from '../lib/lib/identity/fingerprint.js';

const NOW = 1_780_000_000_000;

/**
 * The single-flight lease, and what happens when nothing releases it.
 *
 * Every one of these cases is a real way a verification dies mid-call. If the
 * lease were a lock rather than a deadline, each would leave the mechanic
 * permanently unable to retry, fixable only by an administrator editing
 * Firestore by hand.
 */
describe('verification lease recovery', () => {
  it('is free when no verification has ever run', () => {
    assert.equal(isLeaseHeld(undefined, NOW), false);
    assert.equal(isLeaseHeld(null, NOW), false);
  });

  it('is held while a verification is genuinely running', () => {
    // The case it exists for: a second submit arriving while the first is
    // still talking to a billable endpoint.
    const deadline = { seconds: Math.floor((NOW + 30_000) / 1000), nanoseconds: 0 };
    assert.equal(isLeaseHeld(deadline, NOW), true);
  });

  it('recovers after a provider timeout', () => {
    // Two 20s lookups plus margin is the worst honest case; past the deadline
    // the previous attempt is gone whether or not it ever returned.
    const died = { seconds: Math.floor((NOW - 1000) / 1000), nanoseconds: 0 };
    assert.equal(isLeaseHeld(died, NOW), false);
  });

  it('recovers after a function crash that never released', () => {
    // An instance evicted mid-call writes nothing on the way out. The lease
    // still expires on schedule.
    const abandoned = { seconds: Math.floor((NOW - IN_FLIGHT_SECONDS * 1000) / 1000), nanoseconds: 0 };
    assert.equal(isLeaseHeld(abandoned, NOW), false);
  });

  it('recovers after a schema or platform failure exits early', () => {
    // A provider schema mismatch exits through a path that may not reach the
    // release. The mechanic must still be able to retry once it lapses.
    const stale = { seconds: Math.floor((NOW - 120_000) / 1000), nanoseconds: 0 };
    assert.equal(isLeaseHeld(stale, NOW), false);
  });

  it('is free exactly at the deadline, not a moment after', () => {
    // Strictly greater-than, so the boundary releases rather than lingering.
    const deadline = leaseDeadlineMs(NOW);
    const atDeadline = { seconds: Math.floor(deadline / 1000), nanoseconds: 0 };
    assert.equal(isLeaseHeld(atDeadline, deadline), false);
  });

  it('tolerates a malformed value rather than blocking forever', () => {
    // A corrupted field must not be readable as "held indefinitely" — that
    // would be an unrecoverable lockout written by a bad value.
    assert.equal(isLeaseHeld('nonsense', NOW), false);
    assert.equal(isLeaseHeld({}, NOW), false);
    assert.equal(isLeaseHeld(0, NOW), false);
  });

  it('claims a window long enough for two provider lookups', () => {
    // 20s per lookup, at most two, plus margin. Shorter and a slow but honest
    // call gets overtaken by a retry, billing the client twice.
    assert.ok(IN_FLIGHT_SECONDS >= 45, 'lease must outlast two 20s provider calls');
    assert.equal(leaseDeadlineMs(NOW) - NOW, IN_FLIGHT_SECONDS * 1000);
  });
});

/**
 * Compromised keys must have consequences, not just an entry in a list.
 */
describe('compromised fingerprint keys', () => {
  const ring = parseKeyring(
    JSON.stringify({ current: 3, keys: { 1: 'leaked', 2: 'old', 3: 'live' }, compromised: [1] }),
  );

  it('distinguishes a leaked key from a merely old one', () => {
    // Both need re-issuing eventually; only the leaked one invalidates the
    // verification it produced. Conflating them would either ignore a breach
    // or force re-verification on every routine rotation.
    assert.equal(trustCompromised(ring, 1), true);
    assert.equal(trustCompromised(ring, 2), false);
    assert.equal(needsReissue(ring, 2), true);
  });

  it('leaves the current key trusted', () => {
    assert.equal(trustCompromised(ring, 3), false);
    assert.equal(needsReissue(ring, 3), false);
  });

  it('does not treat an unversioned record as compromised', () => {
    // Records predating versioning cannot be attributed to any key, so they
    // are stale rather than exposed. Treating them as breached would block
    // approvals for a reason nobody could act on.
    assert.equal(trustCompromised(ring, null), false);
    assert.equal(needsReissue(ring, null), true);
  });

  it('the approval gate consults it', () => {
    // The runtime consequence the client asked for: a compromised version
    // cannot silently remain trusted.
    const source = readFileSync(
      new URL('../src/adminReviewStore.ts', import.meta.url),
      'utf8',
    );
    assert.match(source, /trustCompromised/);
    assert.match(source, /IDENTITY_NOT_VERIFIED/);
  });

  it('an unreadable keyring fails closed for mechanics, not open', () => {
    // The earlier version allowed the approval when the keyring could not be
    // read, so a missing secret would not freeze the dealer queue. That is
    // fail-open on a security decision: the one moment the keyring is missing
    // is the moment nobody can tell whether a key was withdrawn.
    const source = readFileSync(new URL('../src/adminReviewStore.ts', import.meta.url), 'utf8');
    const block = source.slice(source.indexOf('if (approving && isMechanic(store))'));

    // The catch around resolveKeyring must raise, not swallow. An empty catch
    // — or one that only logs — would let an unreadable keyring approve a
    // mechanic whose key may since have been withdrawn.
    const guard = block.slice(block.indexOf('catch'), block.indexOf('if (trustCompromised'));
    assert.match(guard, /fail\(/, 'the keyring failure must raise rather than fall through');
    assert.match(guard, /IDENTITY_PROVIDER_UNAVAILABLE/);
    assert.ok(
      !/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(guard),
      'the keyring failure must not be swallowed by an empty catch',
    );
  });

  it('dealers never reach the keyring check', () => {
    // How the dealer queue is protected now: by not entering the branch at
    // all, rather than by weakening what happens inside it.
    const source = readFileSync(new URL('../src/adminReviewStore.ts', import.meta.url), 'utf8');
    const guard = source.indexOf('if (approving && isMechanic(store))');
    const call = source.indexOf('resolveKeyring()');
    assert.ok(guard > 0 && call > guard, 'resolveKeyring must sit inside the mechanic-only guard');
  });
});

/**
 * The sweep that fixes records already approved under a withdrawn key.
 *
 * The approval gate covers everything arriving from now on and nothing already
 * live — which is the exact "silently trusted forever" case it was meant to
 * close. This is the selection rule that sweep uses.
 */
describe('flagging live records after a key withdrawal', () => {
  const ring = parseKeyring(
    JSON.stringify({ current: 3, keys: { 1: 'leaked', 2: 'old', 3: 'live' }, compromised: [1] }),
  );
  const mechanic = (identity) => ({ businessType: 'mechanic', identity });

  it('selects a verified mechanic fingerprinted under a withdrawn key', () => {
    assert.equal(
      shouldFlagForReverification(mechanic({ status: 'verified', fingerprintKeyVersion: 1 }), ring),
      true,
    );
  });

  it('ignores parts dealers entirely', () => {
    // Dealers carry no identity block and must never be touched by a KYC sweep.
    assert.equal(
      shouldFlagForReverification({ businessType: 'parts_dealer', identity: { status: 'verified', fingerprintKeyVersion: 1 } }, ring),
      false,
    );
    assert.equal(shouldFlagForReverification({}, ring), false);
  });

  it('ignores records under a sound key, current or merely old', () => {
    assert.equal(
      shouldFlagForReverification(mechanic({ status: 'verified', fingerprintKeyVersion: 3 }), ring),
      false,
    );
    // v2 is stale but not leaked: it gets re-issued in the ordinary course,
    // and forcing re-verification on every routine rotation would be punitive.
    assert.equal(
      shouldFlagForReverification(mechanic({ status: 'verified', fingerprintKeyVersion: 2 }), ring),
      false,
    );
  });

  it('is idempotent — a flagged record is not selected again', () => {
    // The sweep sets status to 'unverified', which fails the second condition,
    // so re-running after a partial failure is safe.
    for (const status of ['unverified', 'failed', 'manual_review', 'pending']) {
      assert.equal(
        shouldFlagForReverification(mechanic({ status, fingerprintKeyVersion: 1 }), ring),
        false,
        `a record already at ${status} must not be swept twice`,
      );
    }
  });

  it('ignores a mechanic that never verified', () => {
    assert.equal(shouldFlagForReverification(mechanic(null), ring), false);
    assert.equal(shouldFlagForReverification(mechanic({ status: 'verified' }), ring), false);
  });
});
