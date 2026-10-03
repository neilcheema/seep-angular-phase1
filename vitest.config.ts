import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'seep-engine': fileURLToPath(new URL('./projects/seep-engine/src/public-api.ts', import.meta.url)),
    },
  },
  test: {
    include: [
      'projects/seep-engine/src/**/*.test.ts',
      'projects/seep-web/src/**/*.test.ts',
      'projects/seep-api/src/**/*.test.ts',
    ],
    environment: 'node',
    // seep-api's tests start a real (WASM) Postgres, and the root run executes every
    // project's test files in parallel; the 5s default is too tight for that.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
