import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(async () => undefined),
}))

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: mocks.signInWithEmailAndPassword,
  signOut: mocks.signOut,
}))

import { signInAdmin } from '../lib/admin-login'

const auth = { __service: 'auth' } as never

/** Firebase credential whose ID token the exchange should forward. */
function credentialYielding(idToken: string) {
  return { user: { getIdToken: vi.fn(async () => idToken) } }
}

function fetcherThatSucceeds() {
  return vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (!init || init.method === 'GET') {
      return { ok: true, json: async () => ({ csrfToken: 'csrf-123' }) } as Response
    }
    return { ok: true, json: async () => ({ ok: true }) } as Response
  })
}

beforeEach(() => vi.clearAllMocks())

describe('signInAdmin', () => {
  it('exchanges the ID token through /api/admin/session with the CSRF header', async () => {
    mocks.signInWithEmailAndPassword.mockResolvedValue(credentialYielding('id-token-abc'))
    const fetchImpl = fetcherThatSucceeds()

    const result = await signInAdmin(auth, 'admin@lytodmotors.com', 'pw', fetchImpl)

    expect(result).toEqual({ ok: true })

    // The GET seeds the double-submit CSRF cookie.
    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/api/admin/session', { method: 'GET' })

    const [url, init] = fetchImpl.mock.calls[1]!
    expect(url).toBe('/api/admin/session')
    expect(init!.method).toBe('POST')
    expect((init!.headers as Record<string, string>)['x-nph-csrf']).toBe('csrf-123')
    expect(JSON.parse(init!.body as string)).toEqual({ idToken: 'id-token-abc' })
  })

  it('forces a token refresh so a newly granted admin claim is present', async () => {
    const credential = credentialYielding('fresh')
    mocks.signInWithEmailAndPassword.mockResolvedValue(credential)

    await signInAdmin(auth, 'a@b.c', 'pw', fetcherThatSucceeds())

    // A token minted before the claim was granted still carries the old claims,
    // so the server would reject an admin who was just promoted.
    expect(credential.user.getIdToken).toHaveBeenCalledWith(true)
  })

  it('trims the email, since a trailing space makes sign-in fail opaquely', async () => {
    mocks.signInWithEmailAndPassword.mockResolvedValue(credentialYielding('t'))

    await signInAdmin(auth, '  admin@lytodmotors.com  ', 'pw', fetcherThatSucceeds())

    expect(mocks.signInWithEmailAndPassword).toHaveBeenCalledWith(
      auth, 'admin@lytodmotors.com', 'pw',
    )
  })

  it('reports failure and signs out when the server rejects the token', async () => {
    mocks.signInWithEmailAndPassword.mockResolvedValue(credentialYielding('id-token'))
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (!init || init.method === 'GET') {
        return { ok: true, json: async () => ({ csrfToken: 'c' }) } as Response
      }
      return { ok: false, json: async () => ({ error: 'Not an administrator.' }) } as Response
    })

    const result = await signInAdmin(auth, 'user@example.com', 'pw', fetchImpl)

    expect(result).toEqual({ ok: false, message: 'Not an administrator.' })
    // Otherwise a non-admin is left signed in to Firebase with no server
    // cookie, and the UI behaves as though something half-worked.
    expect(mocks.signOut).toHaveBeenCalledWith(auth)
  })

  it('does not reveal whether the account exists', async () => {
    mocks.signInWithEmailAndPassword.mockRejectedValue({ code: 'auth/invalid-credential' })

    const result = await signInAdmin(auth, 'nobody@example.com', 'pw', fetcherThatSucceeds())

    expect(result).toEqual({ ok: false, message: 'Incorrect email or password.' })
  })

  it('never reaches the session endpoint when sign-in fails', async () => {
    mocks.signInWithEmailAndPassword.mockRejectedValue({ code: 'auth/wrong-password' })
    const fetchImpl = fetcherThatSucceeds()

    await signInAdmin(auth, 'a@b.c', 'pw', fetchImpl)

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports a transport failure distinctly from bad credentials', async () => {
    mocks.signInWithEmailAndPassword.mockResolvedValue(credentialYielding('id-token'))
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })

    const result = await signInAdmin(auth, 'a@b.c', 'pw', fetchImpl as never)

    expect(result).toEqual({
      ok: false,
      message: 'Could not reach the authentication service.',
    })
  })
})
