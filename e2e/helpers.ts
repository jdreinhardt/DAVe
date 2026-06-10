import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const TEST_USER = process.env.TEST_USER ?? 'testuser';
export const TEST_PASS = process.env.TEST_PASS ?? 'testpass';

export async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.fill('#username', TEST_USER);
  await page.fill('#password', TEST_PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/contacts');
}

/** Wait for a toast message matching the given text to appear and then disappear. */
export async function waitForToast(page: Page, text: string | RegExp): Promise<void> {
  const toast = page.locator('text=' + (typeof text === 'string' ? text : text.source)).first();
  await expect(toast).toBeVisible({ timeout: 8_000 });
}

/** Navigate to a tab using the sidebar link. */
export async function goToTab(page: Page, name: 'Contacts' | 'Calendar' | 'Tasks' | 'Notes' | 'Journals'): Promise<void> {
  const routes: Record<string, string> = {
    Contacts: '/contacts',
    Calendar: '/calendar',
    Tasks: '/tasks',
    Notes: '/notes',
    Journals: '/journals',
  };
  await page.goto(routes[name]!);
}
