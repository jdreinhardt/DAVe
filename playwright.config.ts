import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // When running in CI, start the full test stack first.
  // Locally, reuse an already-running instance if available.
  webServer: process.env.CI
    ? {
        command: 'docker compose -f docker-compose.test.yml up --wait && node packages/backend/dist/server.js',
        url: 'http://localhost:3000/healthz',
        timeout: 120_000,
      }
    : undefined,
});
