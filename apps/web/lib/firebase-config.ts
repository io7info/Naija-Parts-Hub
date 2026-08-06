/**
 * Firebase configuration shared by the browser SDK and the Admin SDK.
 *
 * One module owns the environment contract so the two halves can never
 * disagree. A split — client live, server emulator — would authenticate against
 * the real project and then verify the token against an empty emulator, and the
 * failure reads as "invalid session cookie" rather than as a misconfiguration.
 *
 * Safe to import from a client component: it reads only NEXT_PUBLIC_* values,
 * which are public browser configuration by design. Nothing secret belongs
 * here — see lib/firebase-admin.ts for the credentialed half.
 */

/**
 * Emulator ports, mirrored from firebase.json.
 *
 * Duplicated rather than imported: firebase.json sits outside the Next.js root,
 * and bundling it into browser JavaScript to read four integers is worse than
 * restating them. tests/firebase-config.test.ts reads the real file and fails
 * on drift, the same guard the Firestore rules use against @nph/contracts.
 */
export const EMULATOR_PORTS = {
  auth: 9099,
  firestore: 8080,
  storage: 9199,
  functions: 5001,
} as const

/**
 * The web app always reaches the emulators over loopback.
 *
 * Deliberately not configurable to 10.0.2.2: that alias exists only inside the
 * Android emulator's network namespace and is meaningless to a browser. The
 * Flutter app owns that translation in apps/mobile/lib/core/env.dart.
 */
export const EMULATOR_HOST = '127.0.0.1'

/** The Emulator Suite treats any demo-* id as offline-only, with no credentials. */
export const EMULATOR_PROJECT_ID = 'demo-naija-parts-hub'

/**
 * Emulators are opt-in.
 *
 * The previous flag defaulted to ON unless explicitly 'false', which is the
 * wrong default for a deployed build: a missing variable on Vercel would have
 * silently pointed production at a loopback emulator that isn't there.
 */
export const useEmulators = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true'

/**
 * Re-exported rather than redeclared.
 *
 * A callable resolves to `https://<region>-<project>.cloudfunctions.net/<name>`,
 * so a client pointed at the wrong region gets a 404 that reads like a missing
 * function rather than a misconfiguration. Sharing the constant with
 * functions/src/index.ts is what makes that impossible.
 */
export { FUNCTIONS_REGION } from '@nph/contracts'

export type FirebaseClientConfig = {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
}

/**
 * Read literally, never through a computed key.
 *
 * Next.js inlines NEXT_PUBLIC_* at build time by static analysis. `env[name]`
 * is not statically analysable, so it resolves to undefined in the browser
 * while working fine in Node — a bug that only appears in the deployed bundle.
 */
function readEnv(): Record<keyof FirebaseClientConfig, string | undefined> {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  }
}

/** Variable name per config key, for error messages that name what to add. */
const ENV_NAMES: Record<keyof FirebaseClientConfig, string> = {
  apiKey: 'NEXT_PUBLIC_FIREBASE_API_KEY',
  authDomain: 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  projectId: 'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  storageBucket: 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'NEXT_PUBLIC_FIREBASE_APP_ID',
}

/**
 * Emulator-mode configuration.
 *
 * The Emulator Suite ignores these values, but the SDK still requires the
 * fields to be present and well-formed. The key is shaped like a real one
 * (`AIzaSy` + 33 chars) because the Android SDK rejects a malformed key before
 * it sends anything; keeping both platforms identical stops one working and
 * the other not.
 */
function emulatorConfig(): FirebaseClientConfig {
  return {
    apiKey: 'AIzaSyDemoEmulatorKeyNotRealNotUsed1234',
    authDomain: `${EMULATOR_PROJECT_ID}.firebaseapp.com`,
    projectId: EMULATOR_PROJECT_ID,
    storageBucket: `${EMULATOR_PROJECT_ID}.appspot.com`,
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:0000000000000000',
  }
}

export class FirebaseConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(
      `Firebase is not configured. Missing ${missing.join(', ')}.\n` +
        'Add the values from the Firebase console (Project settings → Your apps → NPH Web) ' +
        'to apps/web/.env.local — see apps/web/.env.local.example.\n' +
        'For local development against the Emulator Suite, set ' +
        'NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true instead.',
    )
    this.name = 'FirebaseConfigError'
  }
}

/**
 * Resolves the browser configuration, or throws naming exactly what is missing.
 *
 * Exported as a pure function of its inputs so the failure path can be tested
 * without mutating the real environment.
 */
export function resolveFirebaseConfig(
  raw: Record<keyof FirebaseClientConfig, string | undefined>,
  emulators: boolean,
): FirebaseClientConfig {
  if (emulators) return emulatorConfig()

  const missing = (Object.keys(ENV_NAMES) as (keyof FirebaseClientConfig)[])
    .filter((key) => !raw[key]?.trim())
    .map((key) => ENV_NAMES[key])

  // Fail loudly rather than initialising with undefined values, which surfaces
  // much later as an opaque auth/invalid-api-key at the first sign-in attempt.
  if (missing.length > 0) throw new FirebaseConfigError(missing)

  return raw as FirebaseClientConfig
}

export function firebaseClientConfig(): FirebaseClientConfig {
  return resolveFirebaseConfig(readEnv(), useEmulators)
}

/** The project actually in use, for diagnostics and the admin footer. */
export const activeProjectId = useEmulators
  ? EMULATOR_PROJECT_ID
  : (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '')
