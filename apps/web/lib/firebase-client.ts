'use client'

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions'
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage'

import {
  EMULATOR_HOST,
  EMULATOR_PORTS,
  FUNCTIONS_REGION,
  firebaseClientConfig,
  useEmulators,
} from './firebase-config'

/**
 * Firebase browser SDK — the only client-side entry point.
 *
 * This is authentication and client reads, not authorisation. Every privileged
 * decision is made server-side against the session cookie in lib/admin-session.ts,
 * because anything this module can do, a user with devtools can do too.
 *
 * Analytics is deliberately absent. It is not needed for Phase 1, it would pull
 * a measurement id into the bundle, and getAnalytics() throws during SSR.
 */

// Next.js re-executes modules on fast refresh and keeps one module registry per
// server request. Reusing the existing app is what stops "Firebase App named
// '[DEFAULT]' already exists" on the second render.
const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseClientConfig())

export const auth: Auth = getAuth(app)
export const db: Firestore = getFirestore(app)
export const storage: FirebaseStorage = getStorage(app)
export const functions: Functions = getFunctions(app, FUNCTIONS_REGION)

/**
 * connect*Emulator throws if called twice on the same instance, and fast
 * refresh re-runs this module while the SDK singletons survive. A module-scoped
 * boolean is not enough — the module itself is re-evaluated — so the flag lives
 * on globalThis, which does persist.
 */
declare global {
  var __nphEmulatorsConnected: boolean | undefined
}

function connectEmulators() {
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`, {
    disableWarnings: true,
  })
  connectFirestoreEmulator(db, EMULATOR_HOST, EMULATOR_PORTS.firestore)
  connectStorageEmulator(storage, EMULATOR_HOST, EMULATOR_PORTS.storage)
  connectFunctionsEmulator(functions, EMULATOR_HOST, EMULATOR_PORTS.functions)
}

if (useEmulators && !globalThis.__nphEmulatorsConnected) {
  globalThis.__nphEmulatorsConnected = true
  connectEmulators()
}

export { useEmulators, FUNCTIONS_REGION }
export { activeProjectId } from './firebase-config'
