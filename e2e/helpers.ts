import path from 'path';
import { fileURLToPath } from 'url';
import type { Page } from '@playwright/test';

export const TEST_USER = process.env.TEST_USER ?? 'testuser';
export const TEST_PASS = process.env.TEST_PASS ?? 'testpass';

/** Where the setup project parks the shared signed-in session. Gitignored. */
export const AUTH_STATE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '.auth',
  'user.json',
);

/**
 * Drives the login form. Only for specs that are actually testing sign-in.
 *
 * Sign-in lands on "/", which resolves to the account's configured home view —
 * so wait for any route but /login rather than a specific one.
 */
export async function formLogin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('#username', TEST_USER);
  await page.fill('#password', TEST_PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login') && url.pathname !== '/');
}

/**
 * Ensures the page is signed in and sitting on /contacts.
 *
 * Normally a no-op beyond the navigation: specs inherit a session from the setup
 * project (e2e/auth.setup.ts), so we only fall back to the form when that state
 * is missing or expired. Logging in per test would trip the login route's
 * rate limit — 10 attempts per 15 minutes per IP.
 */
export async function login(page: Page): Promise<void> {
  // Shares the context's cookies, so this reflects the inherited session.
  if ((await page.request.get('/api/me')).ok()) {
    await page.goto('/contacts');
    return;
  }
  await formLogin(page);
}

/**
 * A row in one of the list views. Every task/note/journal row carries a data-uid,
 * so scoping to that keeps us clear of the detail pane, which repeats the title in
 * its heading. The inner match is exact so "Foo" doesn't also select "Foo Edited".
 */
export function listRow(page: Page, title: string) {
  return page
    .locator('[data-uid]')
    .filter({ has: page.getByText(title, { exact: true }) })
    .first();
}
