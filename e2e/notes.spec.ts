import { test, expect } from '@playwright/test';
import { listRow, login } from './helpers';

const NOTE_TITLE = 'E2E Test Note';
const EDITED_TITLE = 'E2E Test Note Edited';
const NOTE_BODY = 'This note was created by the E2E test suite.';

test.describe('Notes', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/notes');
    await expect(page.getByRole('button', { name: 'New note' })).toBeVisible();
  });

  test('create a note', async ({ page }) => {
    await page.getByRole('button', { name: 'New note' }).click();

    const titleInput = page.getByPlaceholder('Title');
    await expect(titleInput).toBeVisible();
    await titleInput.fill(NOTE_TITLE);

    // Type body content into the textarea
    await page.getByPlaceholder(/write.*markdown|body|content/i).fill(NOTE_BODY).catch(() => {
      // Fallback: find the description textarea by its position after the title input
      return page.locator('textarea').last().fill(NOTE_BODY);
    });

    await page.getByRole('button', { name: 'Create' }).click();

    // Note appears in the list
    await expect(listRow(page, NOTE_TITLE)).toBeVisible();
  });

  test('view note content', async ({ page }) => {
    await listRow(page, NOTE_TITLE).click();
    // Detail panel shows the note title
    await expect(page.getByRole('heading', { name: NOTE_TITLE })).toBeVisible();
  });

  test('edit a note title', async ({ page }) => {
    await listRow(page, NOTE_TITLE).click();

    // In the detail panel, click the edit icon (pencil) to open the editor
    await page.locator('[title="Edit"]').first().click().catch(async () => {
      // Fallback: look for Edit button in the detail toolbar
      await page.getByRole('button', { name: /edit/i }).first().click();
    });

    const titleInput = page.getByPlaceholder('Title');
    await expect(titleInput).toBeVisible();
    await titleInput.fill(EDITED_TITLE);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(listRow(page, EDITED_TITLE)).toBeVisible();
  });

  test('delete a note', async ({ page }) => {
    await listRow(page, EDITED_TITLE).click();

    // Delete button in detail panel toolbar
    await page.getByTitle('Delete').click();

    // Confirmation dialog: "Delete this note?"
    // Scoped to the dialog: the detail toolbar has its own Delete icon button.
    const confirm = page.getByRole('dialog', { name: /delete this note/i });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete' }).click();

    await expect(listRow(page, EDITED_TITLE)).not.toBeVisible();
  });
});
