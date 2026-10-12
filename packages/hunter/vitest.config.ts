import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Test against the sources of the workspace packages so a stale build can never mask a change.
    alias: {
      '@terra-incognita/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@terra-incognita/sdk': fileURLToPath(new URL('../sdk/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
