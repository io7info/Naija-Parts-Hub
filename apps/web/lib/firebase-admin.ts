import 'server-only'

import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

import {
  EMULATOR_HOST,
  EMULATOR_PORTS,
  EMULATOR_PROJECT_ID,
  useEmulators,
} from './firebase-config'

/**
 * Firebase Admin SDK — server only.
 *
 * The `server-only` import is load-bearing: it makes the build fail if any
 * client component ever imports this module. Without it, a stray import would
 * bundle service-account credentials into browser JavaScript, which is the
 * single worst mistake available in this codebase.
 *
 * The Admin SDK bypasses security rules entirely, so everything reached
 * through it must do its own authorisation. See lib/admin-session.ts.
 */

/**
 * The emulator flag and ports come from lib/firebase-config so this cannot
 * drift from the browser SDK. A split — client on the live project, server on
 * the emulator — surfaces as "invalid session cookie" rather than as the
 * configuration error it actually is.
 */
const useEmulator = useEmulators

const PROJECT_ID = useEmulator
  ? EMULATOR_PROJECT_ID
  : (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? EMULATOR_PROJECT_ID)

/**
 * Emulator hosts must be set before the SDK initialises, and firebase-admin
 * reads them from the environment rather than from options.
 */
if (useEmulator) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`
  process.env.FIRESTORE_EMULATOR_HOST ??= `${EMULATOR_HOST}:${EMULATOR_PORTS.firestore}`
  process.env.GCLOUD_PROJECT ??= PROJECT_ID
  // google-auth-library otherwise probes GCP's metadata server on every cold
  // start, costing a multi-second timeout. Nothing needs real credentials here.
  process.env.METADATA_SERVER_DETECTION ??= 'none'
}

function createApp(): App {
  if (useEmulator) {
    // A demo-* project against the emulators needs no credentials at all.
    return initializeApp({ projectId: PROJECT_ID })
  }

  // Production. The service account arrives as a single JSON env var so it can
  // be held in a secret store rather than a file on disk.
  //
  // TODO(deploy): confirm the delivery mechanism with the client — a Vercel
  // environment variable holding this JSON, or Application Default Credentials
  // if deployed on Google infrastructure. Never commit the key.
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON is required when NEXT_PUBLIC_USE_FIREBASE_EMULATORS is not "true". ' +
        'It is a server-only secret: set it in the Vercel dashboard, never in a NEXT_PUBLIC_* variable.',
    )
  }
  return initializeApp({ credential: cert(JSON.parse(raw)), projectId: PROJECT_ID })
}

/**
 * Initialised on first use, not at import.
 *
 * `next build` evaluates this module while collecting page data for the admin
 * routes. Initialising at module scope therefore demanded the service account
 * at BUILD time — so the build failed on any machine without production
 * credentials, and CI would have needed a real secret to compile a page it
 * never renders. Deferring moves the requirement to the first actual request,
 * where it belongs.
 *
 * Memoised because Next.js re-evaluates modules per request in development;
 * getApps() is also checked so a hot reload reuses the existing app rather than
 * throwing "Firebase App named '[DEFAULT]' already exists".
 */
let cachedApp: App | undefined

function adminApp(): App {
  if (!cachedApp) cachedApp = getApps().length ? getApps()[0]! : createApp()
  return cachedApp
}

export function getAdminAuth() {
  return getAuth(adminApp())
}

export function getAdminDb() {
  return getFirestore(adminApp())
}

export const adminProjectId = PROJECT_ID
export const adminUsesEmulator = useEmulator
