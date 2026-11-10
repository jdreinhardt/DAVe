import { test, expect } from '@playwright/test';

/**
 * OIDC sign-in end to end, through a real browser.
 *
 * The unit and route suites mock the provider; the integration suite covers the
 * DAV side. What only a browser can show is that the sign-in transaction cookie
 * survives the provider's cross-site redirect back to the callback — it is
 * `SameSite=Lax` and path-scoped, and if either were wrong the callback would
 * arrive without its state and nonce and every sign-in would fail.
 *
 * Needs the mock provider and header-trusting Radicale (npm run stack:oidc) plus
 * a DAVe started in OIDC mode on 3500 — see npm run test:e2e:oidc.
 */

// This spec signs in from scratch; it must not inherit the password session the
// rest of the suite shares.
test.use({ storageState: { cookies: [], origins: [] } });

const PROVIDER = /localhost:8443\/authorize/;

test.describe('OIDC sign-in', () => {
  test('redirects an anonymous visitor to the provider', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(PROVIDER);
    // The mock renders a chooser rather than auto-approving.
    await expect(page.getByRole('button', { name: 'Authorize' })).toBeVisible();
  });

  test('signs in and lands in the app with collections', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(PROVIDER);
    await page.getByRole('button', { name: 'Authorize' }).click();

    // Back on DAVe, signed in: no login page, and the contacts view rendered.
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await expect(page.getByPlaceholder('Search contacts…')).toBeVisible();

    // The display name comes from the ID token's `name` claim, which proves the
    // session was built from a verified token rather than a fallback.
    await expect(page.getByText('E2E OIDC User')).toBeVisible();

    // Collections resolve over the trusted user header — the DAV half working
    // through the browser rather than through app.inject.
    const abs = await page.request.get('/api/addressbooks');
    expect(abs.ok()).toBeTruthy();
    expect(((await abs.json()) as Array<{ id: string }>).map((a) => a.id)).toContain('contacts');
  });

  test('shows an error instead of looping when consent is denied', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(PROVIDER);
    await page.getByRole('button', { name: 'Deny' }).click();

    // A failed sign-in must land on a page offering a manual retry rather than
    // bouncing straight back to the provider, or a broken setup loops forever.
    await page.waitForURL(/\/login/);
    await expect(page).toHaveURL(/error=/);
    await expect(page.getByRole('alert')).toBeVisible();
    // A link, not a button — the retry is a plain navigation to the login route.
    await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible();
  });

  test('password sign-in stays refused while OIDC is on', async ({ page }) => {
    const res = await page.request.post('/api/auth/login', {
      data: { username: 'e2e-oidc-user', password: 'irrelevant' },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(403);
  });
});
