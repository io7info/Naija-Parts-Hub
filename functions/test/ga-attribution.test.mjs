import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { gaAttribution } from '../lib/lib/gaAttribution.js';

/**
 * The trust boundary for GA4 attribution.
 *
 * Everything here arrives from a dealer's browser and is stored on a payment
 * document that admins read. It has no authority — nothing consults it to
 * decide access, entitlement, plan or amount — but an unbounded
 * client-controlled string reaching stored data is worth closing anyway.
 */
describe('GA4 attribution capture', () => {
  it('accepts GA4-shaped identifiers', () => {
    assert.deepEqual(gaAttribution({ clientId: '1234567890.1234567890', sessionId: '1786761234' }), {
      clientId: '1234567890.1234567890',
      sessionId: '1786761234',
    });
  });

  it('treats absence as null rather than failing', () => {
    // The normal case for the roughly one dealer in four running a content
    // blocker. Checkout must proceed regardless.
    assert.deepEqual(gaAttribution(undefined), { clientId: null, sessionId: null });
    assert.deepEqual(gaAttribution({}), { clientId: null, sessionId: null });
  });

  it('accepts identifier shapes this project does not currently produce', () => {
    // Google documents client_id as an opaque string. Stock gtag.js gives us
    // the dotted-integer form, but a custom or server-side tagging setup can
    // legitimately produce something else, and rejecting it would stop
    // attribution silently and unrecoverably.
    for (const clientId of [
      '550e8400-e29b-41d4-a716-446655440000', // UUID
      'GA1.2.1234567890.1234567890',
      'abc123',
      'a'.repeat(64), // exactly at the bound
    ]) {
      assert.equal(gaAttribution({ clientId }).clientId, clientId, `should accept ${clientId}`);
    }
  });

  it('rejects unbounded or unsafe strings', () => {
    // Validation bounds what reaches storage; it does not try to re-derive
    // Google's format. Whitespace, markup and control characters have no place
    // in an identifier and would be awkward in the admin payments dashboard.
    for (const clientId of [
      '',
      'a'.repeat(65), // one past the bound
      '<script>alert(1)</script>',
      '1234567890.1234567890 ', // trailing space
      'has space',
      'quote"inside',
      'semi;colon',
      'new\nline',
      '../../etc/passwd',
    ]) {
      assert.equal(gaAttribution({ clientId }).clientId, null, `should reject ${clientId}`);
    }
  });

  it('applies the same bound to session ids', () => {
    assert.equal(gaAttribution({ sessionId: '1786761234' }).sessionId, '1786761234');
    assert.equal(gaAttribution({ sessionId: 'a'.repeat(65) }).sessionId, null);
    assert.equal(gaAttribution({ sessionId: 'has space' }).sessionId, null);
  });

  it('ignores non-string input without throwing', () => {
    // Callable payloads are JSON from an untrusted client: any type can arrive.
    const hostile = { clientId: { toString: () => '1.1' }, sessionId: 123 };
    assert.deepEqual(gaAttribution(hostile), { clientId: null, sessionId: null });
  });

  it('keeps one field when only the other is invalid', () => {
    // A session id can expire or be missing while the client id is fine, and
    // the client id is the one that matters for attribution.
    assert.deepEqual(gaAttribution({ clientId: '1.2', sessionId: 'not valid' }), {
      clientId: '1.2',
      sessionId: null,
    });
  });
});
