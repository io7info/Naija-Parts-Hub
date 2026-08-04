import { signInWithEmailAndPassword, signOut, type Auth } from 'firebase/auth'

/**
 * The admin sign-in exchange, extracted from the form so it can be tested
 * without a DOM.
 *
 * Two steps, and the second is the one that matters:
 *
 *   1. Firebase signs the user in and issues an ID token. This proves identity
 *      only — every account in the project can get one.
 *   2. POST it to /api/admin/session, which independently verifies the token
 *      AND the super_admin claim before setting an httpOnly cookie.
 *
 * Authorisation is therefore entirely server-side. Nothing here is trusted, and
 * nothing is persisted in sessionStorage or localStorage: the session lives in
 * a cookie the browser cannot read.
 */

export type AdminLoginResult =
  | { ok: true }
  | { ok: false; message: string }

/** Injected in tests; defaults to the real browser fetch. */
type Fetcher = typeof fetch

export async function signInAdmin(
  auth: Auth,
  email: string,
  password: string,
  fetchImpl: Fetcher = fetch,
): Promise<AdminLoginResult> {
  let idToken: string
  try {
    const credential = await signInWithEmailAndPassword(auth, email.trim(), password)
    // forceRefresh: a token minted before the super_admin claim was granted
    // still carries the old claims until it is refreshed, so an admin promoted
    // mid-session would otherwise be rejected by the server.
    idToken = await credential.user.getIdToken(true)
  } catch (error) {
    // Firebase deliberately returns auth/invalid-credential for both a wrong
    // password and an unknown account so as not to reveal which. Preserve that.
    const code = (error as { code?: string })?.code ?? ''
    return {
      ok: false,
      message: code.startsWith('auth/')
        ? 'Incorrect email or password.'
        : 'Could not reach the authentication service.',
    }
  }

  try {
    // Double-submit CSRF: read the token from the readable cookie the GET sets,
    // then echo it in a header the POST validates. A cross-origin page can do
    // neither, because it can neither read the cookie nor set the header.
    const csrfResponse = await fetchImpl('/api/admin/session', { method: 'GET' })
    const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string }

    const response = await fetchImpl('/api/admin/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nph-csrf': csrfToken },
      body: JSON.stringify({ idToken }),
    })

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      // Drop the client-side sign-in too. Otherwise a non-admin is left holding
      // half a session: signed in to Firebase, but with no server cookie.
      await signOut(auth).catch(() => {})
      return { ok: false, message: body.error ?? 'Sign-in failed.' }
    }

    return { ok: true }
  } catch {
    await signOut(auth).catch(() => {})
    return { ok: false, message: 'Could not reach the authentication service.' }
  }
}
