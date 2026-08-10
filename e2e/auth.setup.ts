import { test as setup } from '@playwright/test';
import { AUTH_STATE_PATH, formLogin } from './helpers';

/**
 * Signs in once and saves the session cookie for every other spec to reuse.
 *
 * The login route is rate-limited to 10 attempts per 15 minutes per IP
 * (packages/backend/src/routes/auth.ts), and a per-test login would blow through
 * that a couple of spec files in, so the suite shares one session instead.
 */
setup('authenticate', async ({ page }) => {
  await formLogin(page);
  await page.context().storageState({ path: AUTH_STATE_PATH });
});
