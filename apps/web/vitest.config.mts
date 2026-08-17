import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Mirrors the '@/*' path in tsconfig.json. Vitest does not read tsconfig
  // paths, so without this any suite importing application code fails to
  // resolve the moment that code imports a sibling by alias — which is how
  // every module here refers to its neighbours.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, ''),
    },
  },
  test: {
    // Node, not jsdom: these suites exercise configuration, the token exchange
    // and bundle hygiene. Nothing here renders a component, so a DOM would be
    // dead weight and another dependency to keep current.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each file gets a fresh module registry. The client module memoises its
    // Firebase app and sets a flag on globalThis, so suites that share a
    // process would see each other's initialisation and pass for the wrong
    // reason.
    isolate: true,
  },
})
