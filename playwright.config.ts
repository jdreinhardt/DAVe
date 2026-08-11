import { defineConfig, devices } from '@playwright/test';
import { AUTH_STATE_PATH } from './e2e/helpers';

// Which DAV server the stack under test runs. Both stacks seed the same user and
// the same collections, so no spec branches on this — it only selects the compose
// file and the DAV_BASE_URL the backend is started with.
const DAV_SERVER = process.env.DAV_SERVER === 'radicale' ? 'radicale' : 'baikal';

const STACKS = {
  baikal: {
    composeFile: 'docker-compose.test.baikal.yml',
    davBaseUrl: 'http://localhost:8801/dav.php',
  },
  radicale: {
    composeFile: 'docker-compose.test.radicale.yml',
    davBaseUrl: 'http://localhost:8802',
  },
} as const;

const stack = STACKS[DAV_SERVER];

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    // Signs in once; every other spec inherits that session via storageState so the
    // suite stays under the login route's rate limit. See e2e/auth.setup.ts.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: AUTH_STATE_PATH },
      dependencies: ['setup'],
    },
  ],
  // When running in CI, start the full test stack first.
  // Locally, reuse an already-running instance if available.
  webServer: process.env.CI
    ? {
        command: `docker compose -f ${stack.composeFile} up --wait && node packages/backend/dist/server.js`,
        url: 'http://localhost:3000/healthz',
        timeout: 120_000,
        env: { DAV_BASE_URL: stack.davBaseUrl },
      }
    : undefined,
});
