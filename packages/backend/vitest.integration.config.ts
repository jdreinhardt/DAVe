import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Force a single fork so integration tests share one Fastify+Baikal instance
    // and don't race on database state.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
