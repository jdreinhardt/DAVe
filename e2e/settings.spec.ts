import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { login } from './helpers';

/**
 * Opens the settings modal from the sidebar, switches to the given tab and
 * returns the dialog. Scoping to the dialog matters on the Calendar tab, where
 * FullCalendar's own toolbar repeats the Month / Week / Day button labels.
 */
async function openSettings(page: Page, tab: string) {
  await page.getByTitle('Settings').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: tab, exact: true }).click();
  return dialog;
}

/**
 * Puts the two view settings back to their shipped defaults, server-side.
 *
 * Runs before as well as after each test: both settings live on the account, so
 * a test must not depend on what the previous one left behind, and must not leak
 * its own choice into every spec that logs in afterwards.
 */
async function resetViewSettings(page: Page): Promise<void> {
  const res = await page.request.get('/api/settings');
  if (!res.ok()) return;
  await page.request.put('/api/settings', {
    data: {
      ...(await res.json()),
      homeView: 'contacts',
      calendarDefaultView: 'dayGridMonth',
      updatedAt: Date.now(),
    },
  });
}

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => resetViewSettings(page));
  test.afterEach(async ({ page }) => resetViewSettings(page));

  test('"/" redirects to the configured home view', async ({ page }) => {
    await login(page);

    const dialog = await openSettings(page, 'General');
    await dialog.locator('#home-view').selectOption('calendar');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await page.goto('/');
    await expect(page).toHaveURL(/\/calendar/);
  });

  test('the calendar opens in the configured default view', async ({ page }) => {
    await login(page);

    const dialog = await openSettings(page, 'Calendar');
    // Saving a default also clears the remembered last-used view, so the choice
    // takes effect on the next visit rather than losing to the sticky value.
    await dialog.getByRole('button', { name: 'Week', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();

    await page.goto('/calendar');
    await expect(page.locator('.fc-timeGridWeek-view')).toBeVisible();
  });
});
