import { test, expect } from '@playwright/test';
import { login, TEST_USER, TEST_PASS } from './helpers';

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

  test('valid credentials land on the contacts page', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/contacts/);
    // Sidebar and contact list are present
    await expect(page.getByPlaceholder('Search contacts…')).toBeVisible();
  });

  test('sign-out returns to the login page', async ({ page }) => {
    await login(page);
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
