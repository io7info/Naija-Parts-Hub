import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * These suites import lib/firebase-client repeatedly under different
 * environments, so every Firebase entry point is mocked. Nothing here talks to
 * a real project or a running emulator.
 */
const mocks = vi.hoisted(() => ({
  apps: [] as unknown[],
  initializeApp: vi.fn(),
  getApp: vi.fn(),
  connectAuthEmulator: vi.fn(),
  connectFirestoreEmulator: vi.fn(),
  connectStorageEmulator: vi.fn(),
  connectFunctionsEmulator: vi.fn(),
}))

vi.mock('firebase/app', () => ({
  initializeApp: (...args: unknown[]) => {
    mocks.initializeApp(...args)
    mocks.apps.push({ name: '[DEFAULT]' })
    return { name: '[DEFAULT]' }
  },
  getApp: () => {
    mocks.getApp()
    return { name: '[DEFAULT]' }
  },
  getApps: () => mocks.apps,
}))

vi.mock('firebase/auth', () => ({
  getAuth: () => ({ __service: 'auth' }),
  connectAuthEmulator: mocks.connectAuthEmulator,
}))
vi.mock('firebase/firestore', () => ({
  getFirestore: () => ({ __service: 'firestore' }),
  connectFirestoreEmulator: mocks.connectFirestoreEmulator,
}))
vi.mock('firebase/storage', () => ({
  getStorage: () => ({ __service: 'storage' }),
  connectStorageEmulator: mocks.connectStorageEmulator,
}))
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({ __service: 'functions' }),
  connectFunctionsEmulator: mocks.connectFunctionsEmulator,
}))

const LIVE_ENV = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'AIzaSyLiveKeyxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'naijapartshub.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'naijapartshub',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'naijapartshub.firebasestorage.app',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '813389632700',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:813389632700:web:abc123',
}

function reset() {
  mocks.apps.length = 0
  vi.clearAllMocks()
  vi.resetModules()
  // The connect-once flag lives on globalThis precisely so it survives module
  // re-evaluation, which means a test must clear it explicitly.
  delete (globalThis as { __nphEmulatorsConnected?: boolean }).__nphEmulatorsConnected
}

beforeEach(reset)
afterEach(() => vi.unstubAllEnvs())

describe('emulator mode', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_USE_FIREBASE_EMULATORS', 'true'))

  it('connects all four emulators on the ports from firebase.json', async () => {
    const { EMULATOR_PORTS, EMULATOR_HOST } = await import('../lib/firebase-config')
    await import('../lib/firebase-client')

    expect(mocks.connectAuthEmulator).toHaveBeenCalledWith(
      expect.anything(),
      `http://${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`,
      { disableWarnings: true },
    )
    expect(mocks.connectFirestoreEmulator).toHaveBeenCalledWith(
      expect.anything(), EMULATOR_HOST, EMULATOR_PORTS.firestore,
    )
    expect(mocks.connectStorageEmulator).toHaveBeenCalledWith(
      expect.anything(), EMULATOR_HOST, EMULATOR_PORTS.storage,
    )
    expect(mocks.connectFunctionsEmulator).toHaveBeenCalledWith(
      expect.anything(), EMULATOR_HOST, EMULATOR_PORTS.functions,
    )
  })

  it('initialises against the demo project, never the live one', async () => {
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'naijapartshub')
    await import('../lib/firebase-client')

    const config = mocks.initializeApp.mock.calls[0]![0] as { projectId: string }
    expect(config.projectId).toBe('demo-naija-parts-hub')
    expect(config.projectId).not.toBe('naijapartshub')
  })

  it('connects the emulators only once across a hot reload', async () => {
    await import('../lib/firebase-client')
    // Fast refresh re-evaluates the module while the SDK singletons survive.
    // connect*Emulator throws on a second call, so this must not re-run.
    vi.resetModules()
    await import('../lib/firebase-client')

    expect(mocks.connectAuthEmulator).toHaveBeenCalledTimes(1)
    expect(mocks.connectFirestoreEmulator).toHaveBeenCalledTimes(1)
    expect(mocks.connectStorageEmulator).toHaveBeenCalledTimes(1)
    expect(mocks.connectFunctionsEmulator).toHaveBeenCalledTimes(1)
  })
})

describe('live mode', () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(LIVE_ENV)) vi.stubEnv(key, value)
  })

  it('never contacts an emulator host', async () => {
    // The flag is absent entirely — the deployed-to-Vercel case.
    await import('../lib/firebase-client')

    expect(mocks.connectAuthEmulator).not.toHaveBeenCalled()
    expect(mocks.connectFirestoreEmulator).not.toHaveBeenCalled()
    expect(mocks.connectStorageEmulator).not.toHaveBeenCalled()
    expect(mocks.connectFunctionsEmulator).not.toHaveBeenCalled()
  })

  it.each(['false', 'TRUE', '1', 'yes', ''])(
    'treats %o as live, since only the exact string "true" enables emulators',
    async (value) => {
      vi.stubEnv('NEXT_PUBLIC_USE_FIREBASE_EMULATORS', value)
      await import('../lib/firebase-client')

      expect(mocks.connectAuthEmulator).not.toHaveBeenCalled()
    },
  )

  it('uses the live project configuration', async () => {
    await import('../lib/firebase-client')

    expect(mocks.initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'naijapartshub',
        apiKey: LIVE_ENV.NEXT_PUBLIC_FIREBASE_API_KEY,
        storageBucket: 'naijapartshub.firebasestorage.app',
      }),
    )
  })

  it('refuses to initialise when configuration is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', '')

    // Importing must throw rather than construct an app with undefined values,
    // which would fail much later as an opaque auth/invalid-api-key.
    await expect(import('../lib/firebase-client')).rejects.toThrow(
      /NEXT_PUBLIC_FIREBASE_API_KEY/,
    )
    expect(mocks.initializeApp).not.toHaveBeenCalled()
  })
})

describe('app initialisation', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_USE_FIREBASE_EMULATORS', 'true'))

  it('creates the Firebase app exactly once and reuses it afterwards', async () => {
    await import('../lib/firebase-client')
    expect(mocks.initializeApp).toHaveBeenCalledTimes(1)

    vi.resetModules()
    await import('../lib/firebase-client')

    // Second evaluation must take the getApps().length branch. Calling
    // initializeApp again throws "Firebase App named '[DEFAULT]' already exists".
    expect(mocks.initializeApp).toHaveBeenCalledTimes(1)
    expect(mocks.getApp).toHaveBeenCalledTimes(1)
  })

  it('exports auth, firestore, storage and functions', async () => {
    const client = await import('../lib/firebase-client')

    expect(client.auth).toBeDefined()
    expect(client.db).toBeDefined()
    expect(client.storage).toBeDefined()
    expect(client.functions).toBeDefined()
  })
})
