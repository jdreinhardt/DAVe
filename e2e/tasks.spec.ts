import { test, expect } from '@playwright/test';
import { login } from './helpers';

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
    await expect(page.getByText(TASK_TITLE)).toBeVisible();
  });

  test('mark a task complete', async ({ page }) => {
    // Find the complete button for our specific task
    const taskRow = page.locator('text=' + TASK_TITLE).locator('../..');
    await taskRow.getByLabel('Mark complete').click();

    // The task title should gain a strikethrough / completed styling
    // (We verify the button label flipped, which means the mutation went through)
    await expect(taskRow.getByLabel('Mark incomplete')).toBeVisible();

    // Restore to active for subsequent tests
    await taskRow.getByLabel('Mark incomplete').click();
    await expect(taskRow.getByLabel('Mark complete')).toBeVisible();
  });

  test('edit a task', async ({ page }) => {
    // Click task title to open detail, then click Edit
    await page.getByText(TASK_TITLE).first().click();
    await expect(page.getByLabel('Edit task')).toBeVisible();
    await page.getByLabel('Edit task').click();

    const titleInput = page.getByPlaceholder('Task title');
    await expect(titleInput).toBeVisible();
    await titleInput.fill(EDITED_TITLE);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText(EDITED_TITLE)).toBeVisible();
  });

  test('delete a task', async ({ page }) => {
    await page.getByText(EDITED_TITLE).first().click();
    await expect(page.getByLabel('Delete task')).toBeVisible();
    await page.getByLabel('Delete task').click();

    // Confirmation dialog
    await expect(page.getByText('Delete task?')).toBeVisible();
    // No children, so button says "Delete"
    await page.getByRole('button', { name: 'Delete' }).last().click();

    await expect(page.getByText(EDITED_TITLE)).not.toBeVisible();
  });
});
