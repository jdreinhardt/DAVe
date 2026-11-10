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

/**
 * Opt-in for the OIDC project. Its specs need a second DAVe running in OIDC mode
 * plus the mock provider, so registering the project unconditionally would break
 * `npm run test:e2e` for everyone else.
 */
const OIDC_BASE_URL = process.env.E2E_OIDC_BASE_URL;

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
    // `teardown` runs the fixture sweep once the dependent projects finish.
    { name: 'setup', testMatch: /auth\.setup\.ts/, teardown: 'cleanup' },
    // Deletes everything the specs created. The suite shares one account, so
    // leftovers from a failed run poison the next. See e2e/cleanup.teardown.ts.
    { name: 'cleanup', testMatch: /cleanup\.teardown\.ts/ },
    {
      name: 'chromium',
      // oidc.spec.ts is excluded: it needs a second app instance running in OIDC
      // mode, where password sign-in is refused and the shared session from
      // `setup` cannot exist.
      testIgnore: /oidc\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: AUTH_STATE_PATH },
      dependencies: ['setup'],
    },
    // The OIDC sign-in flow, against the mock provider in
    // docker-compose.test.radicale-oidc.yml and a DAVe started with
    // OIDC_ISSUER_URL. Separate project rather than another spec because OIDC
    // mode is all-or-nothing: it disables password login, so it cannot share an
    // app instance with the suite above. See e2e/oidc.spec.ts.
    //
    // Registered only when E2E_OIDC_BASE_URL is set (npm run test:e2e:oidc), so
    // a bare `playwright test` still needs just one app and one stack. Without
    // the opt-in these four specs would fail for anyone who has not started the
    // second instance.
    ...(OIDC_BASE_URL
      ? [
          {
            name: 'oidc',
            testMatch: /oidc\.spec\.ts/,
            use: {
              ...devices['Desktop Chrome'],
              baseURL: OIDC_BASE_URL,
              // The mock provider serves a self-signed cert — openid-client
              // refuses a plain-http issuer, so there is no HTTP alternative.
              // DAVe trusts it via NODE_EXTRA_CA_CERTS; the browser needs
              // telling separately.
              ignoreHTTPSErrors: true,
            },
          },
        ]
      : []),
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
