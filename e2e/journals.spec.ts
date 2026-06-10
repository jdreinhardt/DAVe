import { test, expect } from '@playwright/test';
import { login } from './helpers';

const JOURNAL_TITLE = 'E2E Test Journal';
const EDITED_TITLE = 'E2E Test Journal Edited';

test.describe('Journals', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/journals');
    await expect(page.getByRole('button', { name: 'New journal' })).toBeVisible();
  });

  test('create a journal entry', async ({ page }) => {
    await page.getByRole('button', { name: 'New journal' }).click();

    const titleInput = page.getByPlaceholder('Title');
    await expect(titleInput).toBeVisible();
    await titleInput.fill(JOURNAL_TITLE);

    // Date is pre-filled with today — no action needed
    await page.getByRole('button', { name: 'Create' }).click();

    // Journal appears in the list / timeline
    await expect(page.getByText(JOURNAL_TITLE)).toBeVisible();
  });

  test('view a journal entry', async ({ page }) => {
    await page.getByText(JOURNAL_TITLE).first().click();
    await expect(page.getByText(JOURNAL_TITLE)).toBeVisible();
  });

  test('edit a journal entry', async ({ page }) => {
    await page.getByText(JOURNAL_TITLE).first().click();

    await page.locator('[title="Edit"]').first().click().catch(async () => {
      await page.getByRole('button', { name: /edit/i }).first().click();
    });

    const titleInput = page.getByPlaceholder('Title');
    await expect(titleInput).toBeVisible();
    await titleInput.fill(EDITED_TITLE);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText(EDITED_TITLE)).toBeVisible();
  });

  test('delete a journal entry', async ({ page }) => {
    await page.getByText(EDITED_TITLE).first().click();

    await page.getByTitle('Delete').click();

    // Confirmation: "Delete this journal?"
    await expect(page.getByText(/delete this journal/i)).toBeVisible();
    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText(EDITED_TITLE)).not.toBeVisible();
  });
});
