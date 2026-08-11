import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Pin the root to this package. `include` is resolved relative to the vitest
  // root, which otherwise defaults to the working directory — so running the
  // suite from the repo root (as the npm scripts do) matched nothing and exited
  // "No test files found" rather than failing usefully.
  root: dirname(fileURLToPath(import.meta.url)),
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Force a single fork so integration tests share one Fastify+DAV instance
    // and don't race on database state.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
