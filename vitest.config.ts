import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors the "seep-engine" path mapping in tsconfig.json. Vitest
      // (unlike the Angular CLI/tsc) doesn't read tsconfig paths on its
      // own, so without this, any test importing from 'seep-engine'
      // resolves fine under `ng build`/`ng serve` but fails here.
      'seep-engine': fileURLToPath(new URL('./projects/seep-engine/src/public-api.ts', import.meta.url)),
    },
  },
  test: {
    include: [
      'projects/seep-engine/src/**/*.test.ts',
      'projects/seep-web/src/**/*.test.ts',
    ],
    environment: 'node',
  },
});
