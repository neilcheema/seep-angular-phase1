import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['projects/seep-engine/src/**/*.test.ts'],
    environment: 'node',
  },
});
