import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // Whole games (40 quarters) run in a few seconds, slower when the files run in parallel.
    testTimeout: 20_000,
  },
});
