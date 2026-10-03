import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Same mapping as tsconfig.json's "paths" (and the root vitest config):
      // vitest, like esbuild's bundler, needs it spelled out separately.
      'seep-engine': fileURLToPath(new URL('../seep-engine/src/public-api.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Tests that start a real (WASM) Postgres need a little more than the 5s default.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
