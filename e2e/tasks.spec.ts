import { test, expect } from '@playwright/test';
import { listRow, login } from './helpers';

const TASK_TITLE = 'E2E Test Task';
const EDITED_TITLE = 'E2E Test Task Edited';

test.describe('Tasks', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/tasks');
    // Wait for the task toolbar to be visible (confirms the page loaded with collections)
    await expect(page.getByRole('button', { name: 'New task' })).toBeVisible();
  });

  test('create a task', async ({ page }) => {
    await page.getByRole('button', { name: 'New task' }).click();

    const titleInput = page.getByPlaceholder('Task title');
    await expect(titleInput).toBeVisible();
    await titleInput.fill(TASK_TITLE);
    await page.getByRole('button', { name: 'Create task' }).click();

    // Task appears in the list
    await expect(listRow(page, TASK_TITLE)).toBeVisible();
  });

  test('mark a task complete', async ({ page }) => {
    await listRow(page, TASK_TITLE).getByLabel('Mark complete').click();

    // Completing a task moves it out of the active list into the collapsed
    // "Show N completed" disclosure, which is closed by default.
    await expect(listRow(page, TASK_TITLE)).not.toBeVisible();
    await page.getByRole('button', { name: /Show \d+ completed/ }).click();

    const completedRow = listRow(page, TASK_TITLE);
    await expect(completedRow.getByLabel('Mark incomplete')).toBeVisible();

    // Restore to active for subsequent tests
    await completedRow.getByLabel('Mark incomplete').click();
    await expect(listRow(page, TASK_TITLE).getByLabel('Mark complete')).toBeVisible();
  });

  test('edit a task', async ({ page }) => {
    // Click task title to open detail, then click Edit
    await listRow(page, TASK_TITLE).click();
    await expect(page.getByLabel('Edit task')).toBeVisible();
    await page.getByLabel('Edit task').click();

    const titleInput = page.getByPlaceholder('Task title');
    await expect(titleInput).toBeVisible();
    await titleInput.fill(EDITED_TITLE);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(listRow(page, EDITED_TITLE)).toBeVisible();
  });

  test('delete a task', async ({ page }) => {
    await listRow(page, EDITED_TITLE).click();
    await expect(page.getByLabel('Delete task')).toBeVisible();
    await page.getByLabel('Delete task').click();

    // Confirmation dialog
    await expect(page.getByText('Delete task?')).toBeVisible();
    // No children, so button says "Delete"
    await page.getByRole('button', { name: 'Delete' }).last().click();

    await expect(listRow(page, EDITED_TITLE)).not.toBeVisible();
  });
});
