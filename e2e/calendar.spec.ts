import { test, expect } from '@playwright/test';
import { login } from './helpers';

const EVENT_TITLE = 'E2E Test Event';
const EDITED_TITLE = 'E2E Test Event Edited';

test.describe('Calendar events', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/calendar');
    // Wait for FullCalendar to render
    await expect(page.locator('.fc-view-harness')).toBeVisible();
  });

  test('today is inert while the view already shows today', async ({ page }) => {
    const today = page.getByRole('button', { name: 'Today' });
    await expect(today).toBeDisabled();
    await page.locator('.fc-next-button').click();
    await expect(today).toBeEnabled();
  });

  test('jump to date moves the calendar', async ({ page }) => {
    // The button opens the native picker, which we can't drive; setting the hidden
    // input directly exercises the same change handler.
    await expect(page.getByRole('button', { name: 'Jump to date' })).toBeVisible();
    await page.locator('input[type="date"]').fill('2027-03-15');

    await expect(page.locator('.fc-toolbar-title')).toHaveText(/March 2027/);
  });

  test('create an event via keyboard shortcut', async ({ page }) => {
    // Press n with focus on the calendar body (not an input)
    await page.locator('.fc-view-harness').click();
    await page.keyboard.press('n');

    const titleInput = page.getByPlaceholder('Event title');
    await expect(titleInput).toBeVisible();
    await titleInput.fill(EVENT_TITLE);
    await page.getByRole('button', { name: 'Create' }).click();

    // Event appears in the calendar
    await expect(page.locator('.fc-event-title').filter({ hasText: EVENT_TITLE })).toBeVisible();
  });

  test('edit an event', async ({ page }) => {
    // Open the event popup by clicking the event
    await page.locator('.fc-event-title').filter({ hasText: EVENT_TITLE }).first().click();
    await expect(page.getByTitle('Edit event')).toBeVisible();
    await page.getByTitle('Edit event').click();

    const titleInput = page.getByPlaceholder('Event title');
    await expect(titleInput).toBeVisible();
    await titleInput.fill(EDITED_TITLE);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.locator('.fc-event-title').filter({ hasText: EDITED_TITLE })).toBeVisible();
  });

  test('delete an event', async ({ page }) => {
    await page.locator('.fc-event-title').filter({ hasText: EDITED_TITLE }).first().click();
    await expect(page.getByTitle('Delete event')).toBeVisible();
    await page.getByTitle('Delete event').click();

    // Confirmation dialog
    await expect(page.getByText('Delete event?')).toBeVisible();
    // exact: the popup toolbar's icon button is named "Delete event".
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.locator('.fc-event-title').filter({ hasText: EDITED_TITLE })).not.toBeVisible();
  });
});
