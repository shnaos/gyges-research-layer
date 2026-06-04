import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    // Transport tests open real sockets to localhost; keep them serial-friendly.
    testTimeout: 20_000
  }
});
