import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

import { parseKeyring, currentFingerprint, candidateFingerprints, needsReissue } from '../lib/lib/identity/fingerprint.js';

const SRC = join(import.meta.dirname, '..', 'src');

function sources(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, acc);
    else if (entry.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => relative(SRC, p).replace(/\\/g, '/');

/**
 * BVN and NIN must not be able to reach anywhere they can be read later.
 *
 * These are static checks over the source rather than runtime assertions,
 * because the failure they guard against is a line someone adds in six months
 * — a console.log while debugging, a field added to the document, an error
 * message that quotes the input to be helpful. None of those would fail a
 * behavioural test; all of them would be a breach.
 */
describe('raw identifiers cannot escape', () => {
  const files = sources(SRC);
  const identityFiles = files.filter((f) => /identity/i.test(rel(f)));

  it('the verification callable exists and is the only holder', () => {
    // If a second file starts handling raw identifiers, these guards need to
    // cover it too — so notice when that happens.
    const holders = files.filter((f) => /request\.data\?\.(bvn|nin)/.test(read(f))).map(rel);
    assert.deepEqual(holders, ['verifyMechanicIdentity.ts']);
  });

  it('nothing logs a raw identifier', () => {
    // Any console call whose arguments mention a bare bvn/nin variable.
    const offenders = [];
    for (const file of files) {
      for (const match of read(file).matchAll(/console\.\w+\(([^)]*)\)/gs)) {
        const args = match[1];
        if (/\b(bvn|nin)\b(?!Last4|Fingerprint|Valid)/.test(args)) offenders.push(rel(file));
      }
    }
    assert.deepEqual(offenders, [], 'a console call references a raw identifier');
  });

  it('nothing persists a raw identifier to Firestore', () => {
    // Writes name their fields explicitly. `identity.bvn` would be the raw
    // value; `identity.bvnLast4` and `identity.bvnFingerprint` are the
    // derived forms and are fine.
    const offenders = [];
    for (const file of files) {
      const source = read(file);
      if (/['"]identity\.(bvn|nin)['"]/.test(source)) offenders.push(rel(file));
      if (/\b(bvn|nin):\s*(bvn|nin)\b/.test(source)) offenders.push(rel(file));
    }
    assert.deepEqual(offenders, [], 'a Firestore write references a raw identifier');
  });

  it('no client-facing message interpolates the input', () => {
    // fail() messages reach the app and the logs. None may quote what was
    // submitted — "BVN 22141234567 not found" in a log is the same breach as
    // storing it.
    const source = read(join(SRC, 'verifyMechanicIdentity.ts'));
    for (const match of source.matchAll(/fail\(\s*'[^']*',\s*[^,]+,\s*([\s\S]*?)\)\s*;/g)) {
      const message = match[1];
      assert.ok(
        !/\$\{\s*(bvn|nin|input\.(bvn|nin))\s*\}/.test(message),
        `a failure message interpolates an identifier: ${message.slice(0, 60)}`,
      );
    }
  });

  it('the provider boundary returns only the four agreed fields', () => {
    // The provider sees date of birth, address, photograph and religion. The
    // interface is what stops any of it travelling further.
    const provider = read(join(SRC, 'lib', 'identity', 'provider.ts'));
    const result = provider.slice(
      provider.indexOf('interface IdentityCheckResult'),
      provider.indexOf('export interface IdentityProvider'),
    );
    for (const banned of ['dateOfBirth', 'date_of_birth', 'address', 'photo', 'image', 'gender', 'religion', 'phone']) {
      assert.ok(!result.includes(banned), `IdentityCheckResult exposes ${banned}`);
    }
  });

  it('identity source never touches analytics or crash reporting', () => {
    for (const file of identityFiles) {
      const source = read(file);
      for (const banned of ['gtag', 'analytics', 'Crashlytics', 'recordError']) {
        assert.ok(!source.includes(banned), `${rel(file)} references ${banned}`);
      }
    }
  });
});

/**
 * The fingerprint keyring.
 *
 * Fingerprints cannot be recomputed — the identifier that produced them is
 * deliberately not stored — so rotation depends entirely on keeping old keys
 * usable for lookup. If that breaks, a rotation silently reopens the duplicate
 * account hole it exists to close.
 */
describe('fingerprint keyring', () => {
  const ring = parseKeyring(JSON.stringify({ current: 2, keys: { 1: 'old-key', 2: 'new-key' }, compromised: [1] }));

  it('accepts a bare key as version 1, for the first deployment', () => {
    const single = parseKeyring('a-single-secret');
    assert.equal(single.current, 1);
    assert.equal(Object.keys(single.keys).length, 1);
  });

  it('refuses a ring whose current version has no key', () => {
    assert.throws(() => parseKeyring(JSON.stringify({ current: 3, keys: { 1: 'x' } })));
    assert.throws(() => parseKeyring(''));
  });

  it('writes under the current key and records its version', () => {
    const print = currentFingerprint(ring, 'bvn', '22222222222');
    assert.equal(print.version, 2);
    assert.match(print.value, /^[0-9a-f]{64}$/);
  });

  it('looks up under every live version, so rotation finds old records', () => {
    const candidates = candidateFingerprints(ring, 'bvn', '22222222222');
    assert.equal(candidates.length, 2, 'a rotated ring must still match records written under the old key');
    assert.ok(candidates.includes(currentFingerprint(ring, 'bvn', '22222222222').value));
  });

  it('separates the same digits used as a BVN and as a NIN', () => {
    // Without the kind prefix these collide and one person's BVN would look
    // like another's NIN in the duplicate check.
    assert.notEqual(
      currentFingerprint(ring, 'bvn', '12345678901').value,
      currentFingerprint(ring, 'nin', '12345678901').value,
    );
  });

  it('flags records written under an old or compromised key', () => {
    assert.equal(needsReissue(ring, 1), true);
    assert.equal(needsReissue(ring, 2), false);
    assert.equal(needsReissue(ring, null), true);
  });
});
