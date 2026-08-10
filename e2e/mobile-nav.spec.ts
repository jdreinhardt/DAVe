import { test, expect } from '@playwright/test';
import { login } from './helpers';

// The playwright config only defines a Desktop Chrome project; override the
// viewport here rather than adding a whole second project.
test.use({ viewport: { width: 390, height: 844 } });

test.describe('mobile bottom navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('shows a bottom bar with the available views', async ({ page }) => {
    const bar = page.getByRole('navigation', { name: 'Views' });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Contacts' })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Calendar' })).toBeVisible();
  });

  test('switches views when a tab is tapped', async ({ page }) => {
    const bar = page.getByRole('navigation', { name: 'Views' });
    await bar.getByRole('link', { name: 'Calendar' }).click();
    await page.waitForURL('**/calendar');

    await bar.getByRole('link', { name: 'Contacts' }).click();
    await page.waitForURL('**/contacts');
  });

  test('the drawer holds collections only, no view links', async ({ page }) => {
    await page.getByRole('button', { name: 'Open menu' }).click();
    const drawer = page.locator('aside');
    await expect(drawer).toBeVisible();
    // View links live in the bottom bar on mobile; the drawer's copy is display:none.
    await expect(drawer.getByRole('link', { name: 'Calendar' })).toBeHidden();
    await expect(drawer.getByText('Address Books')).toBeVisible();
  });

  test('search is reachable from the header without opening the drawer', async ({ page }) => {
    // The sidebar has its own Search button, but it is desktop-only — scope to the header.
    await page.locator('header').getByRole('button', { name: 'Search' }).click();
    await expect(page.getByPlaceholder(/Search tasks, notes/i)).toBeVisible();
  });

  test('the sidebar drawer does not duplicate the header search button', async ({ page }) => {
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.locator('aside').getByRole('button', { name: 'Search' })).toBeHidden();
  });

  test('the bottom bar stays visible while a detail pane is open', async ({ page }) => {
    const bar = page.getByRole('navigation', { name: 'Views' });
    const firstContact = page.locator('[data-uid]').first();
    if ((await firstContact.count()) === 0) test.skip(true, 'no contacts in fixture data');
    await firstContact.click();
    await expect(bar).toBeVisible();
  });
});
