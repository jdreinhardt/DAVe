import { test, expect } from '@playwright/test';
import { formLogin } from './helpers';

// This file exercises sign-in itself, so it opts out of the shared session that
// every other spec inherits from the setup project.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Authentication', () => {
  test('shows an error for bad credentials', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#username', 'not-a-real-user');
    await page.fill('#password', 'wrong-password');
    await page.click('button[type="submit"]');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(/incorrect|invalid|unauthorized/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test('valid credentials land on the default home view', async ({ page }) => {
    await formLogin(page);
    // Contacts is the shipped default for homeView; see the settings spec for
    // the case where the account has configured something else.
    await expect(page).toHaveURL(/\/contacts/);
    // Sidebar and contact list are present
    await expect(page.getByPlaceholder('Search contacts…')).toBeVisible();
  });

  test('sign-out returns to the login page', async ({ page }) => {
    await formLogin(page);
    await page.getByTitle('Sign out').click();
    await page.waitForURL('**/login');
    await expect(page).toHaveURL(/\/login/);
  });

  test('unauthenticated visit to a protected route redirects to login', async ({ page }) => {
    await page.goto('/contacts');
    await page.waitForURL('**/login');
    await expect(page).toHaveURL(/\/login/);
  });
});
