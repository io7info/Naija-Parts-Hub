import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type Auth,
  type ConfirmationResult,
} from 'firebase/auth'

/**
 * Dealer sign-in for the website, by phone OTP.
 *
 * The same identity the mobile app uses — one dealer, one Firebase account,
 * whichever surface they are on. That matters beyond convenience: `stores/{id}`
 * is keyed by the dealer's uid, so a separate web identity would see a
 * different store.
 *
 * This exists because subscriptions are bought on the web. Apple's Guideline
 * 3.1.1 forbids an iOS app directing users to an external purchase flow, so the
 * iOS build carries no upgrade link at all — leaving the website as the only
 * route to a paid plan, and therefore requiring dealers to be able to sign in
 * to it.
 *
 * Deliberately no session cookie, unlike the admin portal. An administrator
 * needs server-side gating because the pages they open read other people's
 * data through the Admin SDK. A dealer reads only their own store, listings and
 * payments, all of which firestore.rules already scopes to `request.auth.uid` —
 * so the client SDK's own session is both sufficient and the thing already
 * proven by the emulator rules tests.
 */

export type OtpRequest =
  | { ok: true; confirmation: ConfirmationResult }
  | { ok: false; message: string }

export type OtpConfirm = { ok: true; uid: string } | { ok: false; message: string }

/** E.164, which is the only form Firebase accepts. */
export function toE164(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '')

  // Nigerian dealers type 0803…; the country code replaces the trunk zero.
  if (/^0\d{10}$/.test(digits)) return `+234${digits.slice(1)}`
  if (/^234\d{10}$/.test(digits)) return `+${digits}`
  if (/^\+234\d{10}$/.test(digits)) return digits
  // Anything already international and plausible is passed through rather than
  // rejected — the dealer base is Nigerian but the rule need not be.
  if (/^\+\d{8,15}$/.test(digits)) return digits
  return null
}

/**
 * Turns a Firebase auth error into something a dealer can act on.
 *
 * Kept narrow on purpose: `auth/invalid-phone-number` and
 * `auth/invalid-verification-code` are the two a dealer can fix themselves.
 * Everything else is a configuration or network problem they cannot, so it says
 * so rather than blaming their input.
 */
function explain(error: unknown, fallback: string): string {
  const code = (error as { code?: string })?.code ?? ''
  switch (code) {
    case 'auth/invalid-phone-number':
      return 'That does not look like a valid phone number.'
    case 'auth/invalid-verification-code':
      return 'That code is not correct. Check it and try again.'
    case 'auth/code-expired':
      return 'That code has expired. Request a new one.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.'
    case 'auth/captcha-check-failed':
    case 'auth/invalid-app-credential':
      // Almost always the deployment domain missing from Firebase Console →
      // Authentication → Settings → Authorised domains. Naming it saves an hour
      // of looking at the wrong thing.
      return 'Phone sign-in is not configured for this site yet. Please contact support.'
    default:
      return fallback
  }
}

/**
 * Sends the OTP.
 *
 * [verifier] is a RecaptchaVerifier the caller owns. Firebase requires one for
 * every phone sign-in on the web — invisible in practice, but it must be bound
 * to a real DOM element, which is why it is passed in rather than built here:
 * this module stays testable without a document.
 */
export async function requestOtp(
  auth: Auth,
  phone: string,
  verifier: RecaptchaVerifier,
): Promise<OtpRequest> {
  const e164 = toE164(phone)
  if (!e164) {
    return { ok: false, message: 'Enter your phone number, for example 0803 123 4567.' }
  }

  try {
    const confirmation = await signInWithPhoneNumber(auth, e164, verifier)
    return { ok: true, confirmation }
  } catch (error) {
    return { ok: false, message: explain(error, 'Could not send the code. Please try again.') }
  }
}

export async function confirmOtp(
  confirmation: ConfirmationResult,
  code: string,
): Promise<OtpConfirm> {
  const digits = code.replace(/\D/g, '')
  if (digits.length !== 6) {
    return { ok: false, message: 'Enter the six-digit code sent to your phone.' }
  }

  try {
    const credential = await confirmation.confirm(digits)
    return { ok: true, uid: credential.user.uid }
  } catch (error) {
    return { ok: false, message: explain(error, 'Could not verify that code. Please try again.') }
  }
}

export { RecaptchaVerifier }
