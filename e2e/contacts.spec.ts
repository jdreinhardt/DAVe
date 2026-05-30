import { test, expect } from '@playwright/test';
import { login } from './helpers';

const FIRST = 'E2E';
const LAST = 'TestContact';
const FULL = `${FIRST} ${LAST}`;
const EDITED_LAST = 'TestContactEdited';
const EDITED_FULL = `${FIRST} ${EDITED_LAST}`;

test.describe('Contacts', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/contacts');
    await expect(page.getByPlaceholder('Search contacts…')).toBeVisible();
  });

  test('create a contact', async ({ page }) => {
    await page.getByRole('button', { name: 'New' }).click();
    await page.getByPlaceholder('First').fill(FIRST);
    await page.getByPlaceholder('Last').fill(LAST);
    await page.getByRole('button', { name: 'Save' }).click();

    // Contact appears in the list
    await expect(page.getByRole('button', { name: new RegExp(FULL) })).toBeVisible();
  });

  test('view contact details', async ({ page }) => {
    // Assumes the contact from the previous test (or re-creates)
    await page.getByRole('button', { name: new RegExp(FULL) }).click();
    await expect(page.getByRole('heading', { name: FULL })).toBeVisible();
  });

  test('edit a contact', async ({ page }) => {
    await page.getByRole('button', { name: new RegExp(FULL) }).click();
    await page.getByRole('button', { name: 'Edit' }).click();

    const lastField = page.getByPlaceholder('Last');
    await lastField.fill(EDITED_LAST);
    await page.getByRole('button', { name: 'Save' }).click();

    // Updated name visible in list
    await expect(page.getByRole('button', { name: new RegExp(EDITED_FULL) })).toBeVisible();
  });

  test('delete a contact', async ({ page }) => {
    await page.getByRole('button', { name: new RegExp(EDITED_FULL) }).click();
    await page.getByRole('button', { name: 'Delete' }).click();

    // Confirmation dialog
    await expect(page.getByRole('heading', { name: 'Delete contact' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete' }).last().click();

    // Contact is gone
    await expect(page.getByRole('button', { name: new RegExp(EDITED_FULL) })).not.toBeVisible();
  });
});
