import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

/**
 * ESLint flat config.
 *
 * The `lint` script pointed at `next lint`, which Next 16 removed — it read
 * "lint" as a directory name and failed with "no such directory". So this app
 * had not actually been linted since the Next 16 upgrade; this restores it.
 *
 * eslint-config-next 16 exports flat config natively, so no FlatCompat wrapper.
 */
const config = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
  {
    // The emulator-connected-once flag is deliberately a global: a module-scoped
    // boolean is reset by fast refresh, which is the very bug it prevents.
    files: ['lib/firebase-client.ts'],
    rules: { 'no-var': 'off' },
  },
]

export default config
