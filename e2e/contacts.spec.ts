import { test, expect } from '@playwright/test';
import { login } from './helpers';

const FIRST = 'E2E';
const LAST = 'TestContact';
const FULL = `${FIRST} ${LAST}`;
const EDITED_LAST = 'TestContactEdited';
const EDITED_FULL = `${FIRST} ${EDITED_LAST}`;

/**
 * First matching row. The list renders an optimistic placeholder alongside the
 * saved contact for a beat after a write, so a bare locator is briefly ambiguous.
 */
const contactRow = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('button', { name: new RegExp(name) }).first();

test.describe('Contacts', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/contacts');
    await expect(page.getByPlaceholder('Search contacts…')).toBeVisible();
  });

  test('create a contact', async ({ page }) => {
    // exact: the sidebar also has a "New address book" button.
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByPlaceholder('First').fill(FIRST);
    await page.getByPlaceholder('Last').fill(LAST);
    await page.getByRole('button', { name: 'Save' }).click();

    // Contact appears in the list
    await expect(contactRow(page, FULL)).toBeVisible();
  });

  test('view contact details', async ({ page }) => {
    // Assumes the contact from the previous test (or re-creates)
    await contactRow(page, FULL).click();
    await expect(page.getByRole('heading', { name: FULL })).toBeVisible();
  });

  test('edit a contact', async ({ page }) => {
    await contactRow(page, FULL).click();
    // exact: the sidebar's address-book row has an "Edit Contacts" button.
    await page.getByRole('button', { name: 'Edit', exact: true }).click();

    const lastField = page.getByPlaceholder('Last');
    await lastField.fill(EDITED_LAST);
    await page.getByRole('button', { name: 'Save' }).click();

    // Updated name visible in list
    await expect(contactRow(page, EDITED_FULL)).toBeVisible();
  });

  test('delete a contact', async ({ page }) => {
    await contactRow(page, EDITED_FULL).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    // Confirmation dialog
    await expect(page.getByRole('heading', { name: 'Delete contact' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).last().click();

    // Contact is gone
    await expect(contactRow(page, EDITED_FULL)).not.toBeVisible();
  });
});
