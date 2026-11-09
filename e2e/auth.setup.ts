import fs from 'fs';
import { test as setup } from '@playwright/test';
import { AUTH_STATE_PATH, formLogin } from './helpers';

/**
 * Makes sure a usable session is parked at AUTH_STATE_PATH for every other spec.
 *
 * The login route is rate-limited to 10 attempts per 15 minutes per IP
 * (packages/backend/src/routes/auth.ts), and a per-test login would blow through
 * that a couple of spec files in, so the suite shares one session instead.
 *
 * Signing in *unconditionally* spends one of those ten attempts on every run,
 * on top of the three auth.spec.ts necessarily spends to exercise sign-in
 * itself. Reusing the parked session drops a run from four attempts to three,
 * so the budget covers three back-to-back local runs instead of two. It does
 * not remove the ceiling — auth.spec.ts dominates it. Relaxing the limit for
 * test stacks is the only way to do that.
 *
 * The failure past the ceiling is worth recognising: sign-in answers 429, the
 * form never navigates, and setup times out, which reads like a product bug
 * rather than a spent budget.
 */
setup('authenticate', async ({ page, playwright, baseURL }) => {
  if (fs.existsSync(AUTH_STATE_PATH)) {
    const api = await playwright.request.newContext({
      baseURL,
      storageState: AUTH_STATE_PATH,
    });
    // Probe /api/addressbooks, not /api/me: `me` only echoes the stored session
    // row, so it answers 200 even for a session whose principal and home URLs
    // point at the *other* test server — and test:e2e:all runs baikal then
    // radicale against the same baseURL. This probe does a real PROPFIND, so it
    // passes only when the parked session can still reach the configured server.
    const reusable = await api
      .get('/api/addressbooks')
      .then((r) => r.ok())
      .catch(() => false);
    await api.dispose();
    if (reusable) return;
  }

  await formLogin(page);
  await page.context().storageState({ path: AUTH_STATE_PATH });
});
