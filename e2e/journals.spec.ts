import { test, expect } from '@playwright/test';
import { listRow, login } from './helpers';

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
    await expect(listRow(page, JOURNAL_TITLE)).toBeVisible();
  });

  test('view a journal entry', async ({ page }) => {
    await listRow(page, JOURNAL_TITLE).click();
    await expect(page.getByRole('heading', { name: JOURNAL_TITLE })).toBeVisible();
  });

  test('edit a journal entry', async ({ page }) => {
    await listRow(page, JOURNAL_TITLE).click();

    await page.locator('[title="Edit"]').first().click().catch(async () => {
      await page.getByRole('button', { name: /edit/i }).first().click();
    });

    const titleInput = page.getByPlaceholder('Title');
    await expect(titleInput).toBeVisible();
    await titleInput.fill(EDITED_TITLE);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(listRow(page, EDITED_TITLE)).toBeVisible();
  });

  test('delete a journal entry', async ({ page }) => {
    await listRow(page, EDITED_TITLE).click();

    await page.getByTitle('Delete').click();

    // Confirmation: "Delete this journal?"
    // Scoped to the dialog: the detail toolbar has its own Delete icon button.
    const confirm = page.getByRole('dialog', { name: /delete this journal/i });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete' }).click();

    await expect(listRow(page, EDITED_TITLE)).not.toBeVisible();
  });
});
