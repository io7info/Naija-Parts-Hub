import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';

import { verifyWebhookSignature } from '../lib/lib/paystack.js';

/**
 * Webhook signature verification.
 *
 * This function is the only thing standing between a public HTTPS endpoint and
 * the code that activates subscriptions. Anyone can POST to it; the signature
 * is what makes a request trustworthy. So the assertions worth writing are the
 * negative ones — a forged body, a stale signature, a truncated digest, an
 * absent header — because a check that accepts everything still passes the
 * happy-path test.
 *
 * No Paystack account is needed. The algorithm is HMAC-SHA512 over the raw
 * body, and their secret is just a different string from ours.
 */

const SECRET = 'sk_test_pretend_secret_key';

const sign = (body, secret = SECRET) =>
  createHmac('sha512', secret).update(body).digest('hex');

const event = (overrides = {}) =>
  JSON.stringify({
    event: 'charge.success',
    data: { reference: 'nph-abc-123', amount: 500000, status: 'success', ...overrides },
  });

describe('accepts what Paystack actually sent', () => {
  it('a body signed with our secret', () => {
    const body = event();
    assert.equal(verifyWebhookSignature(body, sign(body), SECRET), true);
  });

  it('the same body as a Buffer', () => {
    // onRequest hands over `rawBody` as a Buffer; strings are the test's
    // convenience. Both must produce the same digest.
    const body = event();
    assert.equal(verifyWebhookSignature(Buffer.from(body, 'utf8'), sign(body), SECRET), true);
  });

  it('a body containing non-ASCII characters', () => {
    // Naira signs and dealer names reach these payloads through metadata. A
    // byte-length mismatch between signing and verifying would break only for
    // those, which is the kind of bug that ships.
    const body = JSON.stringify({ event: 'charge.success', data: { name: 'Ládípọ̀ ₦5,000' } });
    assert.equal(verifyWebhookSignature(body, sign(body), SECRET), true);
  });
});

describe('rejects everything else', () => {
  it('a body altered after signing', () => {
    // The attack this exists for: take a real ₦5,000 webhook, change the
    // amount to ₦50,000, and get a year for the price of a month.
    const original = event({ amount: 500000 });
    const tampered = event({ amount: 5000000 });

    assert.equal(verifyWebhookSignature(tampered, sign(original), SECRET), false);
  });

  it('a signature made with a different secret', () => {
    const body = event();
    assert.equal(verifyWebhookSignature(body, sign(body, 'sk_test_someone_else'), SECRET), false);
  });

  it('a missing signature header', () => {
    assert.equal(verifyWebhookSignature(event(), undefined, SECRET), false);
  });

  it('an empty signature header', () => {
    assert.equal(verifyWebhookSignature(event(), '', SECRET), false);
  });

  it('a truncated signature', () => {
    // timingSafeEqual throws on a length mismatch. If that throw escaped, the
    // handler would 500 — and a 500 makes Paystack retry the same forged
    // request indefinitely.
    const body = event();
    assert.doesNotThrow(() => verifyWebhookSignature(body, sign(body).slice(0, 40), SECRET));
    assert.equal(verifyWebhookSignature(body, sign(body).slice(0, 40), SECRET), false);
  });

  it('a signature padded to the right length with the wrong content', () => {
    const body = event();
    const wrong = 'a'.repeat(sign(body).length);
    assert.equal(verifyWebhookSignature(body, wrong, SECRET), false);
  });

  it('a valid signature for a different body', () => {
    // Replaying yesterday's genuine webhook against today's payload.
    assert.equal(
      verifyWebhookSignature(event({ reference: 'today' }), sign(event({ reference: 'yesterday' })), SECRET),
      false,
    );
  });

  it('an unconfigured secret does not accidentally accept', () => {
    // If PAYSTACK_SECRET_KEY were ever missing, an empty-string key must fail
    // shut. Failing open here would make the endpoint entirely unauthenticated.
    const body = event();
    assert.equal(verifyWebhookSignature(body, sign(body), ''), false);
  });
});

describe('only the exact bytes verify', () => {
  // The reason the handler must be `onRequest` with `rawBody` rather than a
  // callable: the digest is over bytes, not over meaning. Two payloads that
  // parse to an identical object but differ by a single space produce
  // completely different signatures.
  //
  // Re-serialising a *compact* payload happens to round-trip unchanged, so the
  // danger is not that JSON.stringify always mangles it — it is that nothing
  // guarantees it will not. Whitespace is the case that actually reaches us:
  // any proxy, logger or middleware that reformats the body silently breaks
  // every legitimate webhook.
  const compact = '{"event":"charge.success","data":{"amount":500000}}';

  it('a signature is valid only for the byte sequence it was made from', () => {
    const signature = sign(compact);
    assert.equal(verifyWebhookSignature(compact, signature, SECRET), true);
  });

  it('the same object, formatted differently, fails', () => {
    const signature = sign(compact);
    const pretty = JSON.stringify(JSON.parse(compact), null, 2);

    assert.deepEqual(JSON.parse(pretty), JSON.parse(compact), 'same object');
    assert.notEqual(pretty, compact, 'different bytes');
    assert.equal(verifyWebhookSignature(pretty, signature, SECRET), false);
  });

  it('one extra space is enough to fail', () => {
    const signature = sign(compact);
    assert.equal(verifyWebhookSignature(`${compact} `, signature, SECRET), false);
  });
});
