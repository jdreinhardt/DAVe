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
    // Run the files one at a time so they don't race each other on DAV and
    // database state — they all drive the same seeded account.
    //
    // This was `poolOptions: { forks: { singleFork: true } }`, which Vitest 4
    // removed in favour of top-level options. An unknown key is only warned
    // about, so on the 3 -> 5 bump the suite silently went back to running
    // files in parallel and failed in a way that blamed the fixture ("No
    // address books found — is the DAV server seeded?") rather than the race.
    pool: 'forks',
    fileParallelism: false,
  },
});
