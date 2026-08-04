import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  EMULATOR_HOST,
  EMULATOR_PORTS,
  EMULATOR_PROJECT_ID,
  FirebaseConfigError,
  resolveFirebaseConfig,
  type FirebaseClientConfig,
} from '../lib/firebase-config'

const LIVE: Record<keyof FirebaseClientConfig, string | undefined> = {
  apiKey: 'AIzaSyLiveKeyxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  authDomain: 'naijapartshub.firebaseapp.com',
  projectId: 'naijapartshub',
  storageBucket: 'naijapartshub.firebasestorage.app',
  messagingSenderId: '813389632700',
  appId: '1:813389632700:web:abc123',
}

describe('emulator ports', () => {
  // The ports are restated in TypeScript because firebase.json sits outside the
  // Next.js root. This is the guard that keeps the copy honest — the same
  // approach the Firestore rules use against @nph/contracts.
  it('match firebase.json exactly', () => {
    const root = join(import.meta.dirname, '..', '..', '..')
    const firebaseJson = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'))
    const emulators = firebaseJson.emulators

    expect(emulators.auth.port).toBe(EMULATOR_PORTS.auth)
    expect(emulators.firestore.port).toBe(EMULATOR_PORTS.firestore)
    expect(emulators.storage.port).toBe(EMULATOR_PORTS.storage)
    expect(emulators.functions.port).toBe(EMULATOR_PORTS.functions)
  })

  it('target loopback, never the Android emulator alias', () => {
    // 10.0.2.2 resolves only inside the Android emulator's network namespace.
    // A browser asking for it gets nothing; that translation belongs to the
    // Flutter app alone.
    expect(EMULATOR_HOST).toBe('127.0.0.1')
    expect(EMULATOR_HOST).not.toBe('10.0.2.2')
  })
})

describe('resolveFirebaseConfig — emulator mode', () => {
  it('needs no environment variables at all', () => {
    const config = resolveFirebaseConfig(
      { apiKey: undefined, authDomain: undefined, projectId: undefined,
        storageBucket: undefined, messagingSenderId: undefined, appId: undefined },
      true,
    )

    expect(config.projectId).toBe(EMULATOR_PROJECT_ID)
    // The demo- prefix is what makes the Emulator Suite refuse to reach a real
    // project, so it is a security property, not a naming convention.
    expect(config.projectId.startsWith('demo-')).toBe(true)
  })

  it('never adopts live values even when they are present', () => {
    const config = resolveFirebaseConfig(LIVE, true)

    expect(config.projectId).toBe(EMULATOR_PROJECT_ID)
    expect(config.projectId).not.toBe('naijapartshub')
    expect(config.apiKey).not.toBe(LIVE.apiKey)
  })
})

describe('resolveFirebaseConfig — live mode', () => {
  it('passes a complete configuration through unchanged', () => {
    expect(resolveFirebaseConfig(LIVE, false)).toEqual(LIVE)
  })

  it('throws naming every missing variable rather than initialising with undefined', () => {
    const partial = { ...LIVE, apiKey: undefined, appId: undefined }

    expect(() => resolveFirebaseConfig(partial, false)).toThrow(FirebaseConfigError)

    try {
      resolveFirebaseConfig(partial, false)
      expect.unreachable('should have thrown')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('NEXT_PUBLIC_FIREBASE_API_KEY')
      expect(message).toContain('NEXT_PUBLIC_FIREBASE_APP_ID')
      // Must point at the fix, not merely state that something is wrong.
      expect(message).toContain('.env.local')
      expect((error as FirebaseConfigError).missing).toHaveLength(2)
    }
  })

  it('treats blank and whitespace-only values as missing', () => {
    // A variable declared but left empty in .env.local is the common mistake,
    // and `!raw[key]` alone would accept '   '.
    expect(() => resolveFirebaseConfig({ ...LIVE, projectId: '' }, false)).toThrow(
      /NEXT_PUBLIC_FIREBASE_PROJECT_ID/,
    )
    expect(() => resolveFirebaseConfig({ ...LIVE, projectId: '   ' }, false)).toThrow(
      /NEXT_PUBLIC_FIREBASE_PROJECT_ID/,
    )
  })
})
