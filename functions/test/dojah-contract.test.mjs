import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dojahProvider } from '../lib/lib/identity/dojah.js';
import { IdentityProviderSchemaError } from '../lib/lib/identity/provider.js';

/**
 * Contract tests for the Dojah integration.
 *
 * TWO HALVES, AND BOTH MATTER.
 *
 * The parser tests below always run: they pin how we react to every response
 * shape, using fixtures, with no network and no credentials.
 *
 * The live sandbox tests run only when DOJAH_APP_ID and DOJAH_SECRET_KEY are
 * present in the environment. THEY MUST BE RUN AND PASS BEFORE PRODUCTION
 * VERIFICATION IS ENABLED. Fixtures prove we handle the shapes we imagined;
 * only a real call proves those are the shapes Dojah actually sends. Nigerian
 * KYC aggregators change field names between plan tiers, and the failure mode
 * is silent — a lookup that succeeds while we read the wrong key and record an
 * honest mechanic as failing verification.
 *
 *   DOJAH_APP_ID=... DOJAH_SECRET_KEY=... DOJAH_SANDBOX_BVN=... \
 *   DOJAH_SANDBOX_NIN=... npm --prefix functions test
 *
 * Dojah publishes test identifiers for the sandbox; use those, never a real
 * person's.
 */

const live = process.env.DOJAH_APP_ID && process.env.DOJAH_SECRET_KEY;

// --- Parser behaviour, from fixtures ---------------------------------------
// These pin the fail-closed rule: a shape we do not recognise must raise
// rather than resolve to "identity not found".

describe('Dojah response handling', () => {
  /** Builds a provider whose HTTP layer returns a canned response. */
  function providerReturning(status, body) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    const provider = dojahProvider({ appId: 'test', secretKey: 'test' });
    return {
      provider,
      restore: () => {
        globalThis.fetch = originalFetch;
      },
    };
  }

  const input = { bvn: '22222222222', nin: '11111111111', fullName: 'Rafiu Adeoye' };

  it('treats HTTP 404 as a genuine "no record"', async () => {
    const { provider, restore } = providerReturning(404, {});
    try {
      const result = await provider.check(input);
      assert.equal(result.bvnValid, false);
      assert.equal(result.verifiedName, null);
    } finally {
      restore();
    }
  });

  it('treats an explicit negative body as "no record"', async () => {
    const { provider, restore } = providerReturning(200, { status: false, message: 'Record not found' });
    try {
      const result = await provider.check(input);
      assert.equal(result.bvnValid, false);
    } finally {
      restore();
    }
  });

  it('FAILS CLOSED when the envelope is unrecognised', async () => {
    // The case that matters most. A renamed wrapper must not read as "this
    // person does not exist" — that would mark honest mechanics as failing
    // because the provider changed a key.
    const { provider, restore } = providerReturning(200, { data: { first_name: 'Rafiu' } });
    try {
      await assert.rejects(() => provider.check(input), IdentityProviderSchemaError);
    } finally {
      restore();
    }
  });

  it('FAILS CLOSED when entity is not an object', async () => {
    const { provider, restore } = providerReturning(200, { entity: 'unexpected' });
    try {
      await assert.rejects(() => provider.check(input), IdentityProviderSchemaError);
    } finally {
      restore();
    }
  });

  it('FAILS CLOSED when the body is not JSON', async () => {
    const { provider, restore } = providerReturning(200, '<html>gateway error</html>');
    try {
      await assert.rejects(() => provider.check(input), IdentityProviderSchemaError);
    } finally {
      restore();
    }
  });

  it('FAILS CLOSED when a found record carries no name', async () => {
    // A record with no name would score zero on the match and send an honest
    // mechanic to manual review for what is actually a schema problem.
    const { provider, restore } = providerReturning(200, { entity: { date_of_birth: '1990-01-01' } });
    try {
      await assert.rejects(() => provider.check(input), IdentityProviderSchemaError);
    } finally {
      restore();
    }
  });

  it('FAILS CLOSED on a 5xx', async () => {
    const { provider, restore } = providerReturning(503, { message: 'upstream unavailable' });
    try {
      await assert.rejects(() => provider.check(input), IdentityProviderSchemaError);
    } finally {
      restore();
    }
  });

  it('rejects a malformed identifier before making any request', async () => {
    let called = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      called = true;
      return new Response('{}', { status: 200 });
    };
    try {
      const provider = dojahProvider({ appId: 'test', secretKey: 'test' });
      await assert.rejects(() => provider.check({ ...input, bvn: '123' }));
      // The point: a request that could only ever fail must not be billed.
      assert.equal(called, false, 'a malformed identifier must not reach the provider');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// --- Live sandbox ------------------------------------------------------------

describe('Dojah sandbox (requires credentials)', { skip: live ? false : 'DOJAH_APP_ID not set' }, () => {
  const provider = () =>
    dojahProvider({
      appId: process.env.DOJAH_APP_ID,
      secretKey: process.env.DOJAH_SECRET_KEY,
    });

  it('resolves a known-good BVN and NIN', async () => {
    const result = await provider().check({
      bvn: process.env.DOJAH_SANDBOX_BVN,
      nin: process.env.DOJAH_SANDBOX_NIN,
      fullName: process.env.DOJAH_SANDBOX_NAME ?? '',
    });
    assert.equal(result.bvnValid, true);
    assert.equal(result.ninValid, true);
    assert.ok(result.verifiedName, 'sandbox must return a name, or the match cannot run');
    assert.ok(result.reference);
  });

  it('reports a not-found identifier as invalid rather than raising', async () => {
    const result = await provider().check({
      bvn: '00000000000',
      nin: '00000000000',
      fullName: 'Nobody At All',
    });
    assert.equal(result.bvnValid, false);
  });
});
