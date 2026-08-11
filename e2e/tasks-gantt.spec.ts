import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { login } from './helpers';

// Fixtures are created through the API rather than the UI: the Gantt is about
// dates, and the create form would need several interactions per task to set
// them. The uids are fixed so a rerun overwrites rather than accumulates.
const SPAN_UID = 'e2e-gantt-span';
const MILESTONE_UID = 'e2e-gantt-milestone';
const UNSCHEDULED_UID = 'e2e-gantt-unscheduled';
const SWEEP_UID = 'e2e-gantt-sweep';
// Its own fixture because the specs in this file share state, and every other
// undated task gets scheduled by an earlier test.
const CLICK_UID = 'e2e-gantt-click';
const PARENT_UID = 'e2e-gantt-parent';
const CHILD_UID = 'e2e-gantt-child';
const ALL_UIDS = [SPAN_UID, MILESTONE_UID, UNSCHEDULED_UID, SWEEP_UID, CLICK_UID, CHILD_UID, PARENT_UID];

/** Whole days from today as 'YYYY-MM-DD', matching the chart's local-date anchor. */
function dayOffset(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole days between two 'YYYY-MM-DD' strings, in UTC so DST can't shift it. */
function daysApart(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const PX_PER_DAY = 32; // ZOOM_CONFIG.day.pxPerDay

async function seed(page: Page): Promise<void> {
  const cals = await (await page.request.get('/api/calendars')).json();
  const list = Array.isArray(cals) ? cals : (cals.calendars ?? []);
  const cal = list.find((c: { components?: string[] }) => (c.components ?? []).includes('VTODO')) ?? list[0];

  const base = {
    description: '', status: 'NEEDS-ACTION', priority: null, dtstart: null, due: null,
    completed: null, percentComplete: null, lastModified: null, categories: [],
    relations: [], collectionUrl: cal.url, alarms: [], rrule: null,
  };

  const specs = [
    { uid: SPAN_UID, summary: 'E2E Gantt Span', dtstart: dayOffset(0), due: dayOffset(4) },
    { uid: MILESTONE_UID, summary: 'E2E Gantt Milestone', due: dayOffset(2) },
    { uid: UNSCHEDULED_UID, summary: 'E2E Gantt Unscheduled' },
    { uid: SWEEP_UID, summary: 'E2E Gantt Sweep' },
    { uid: CLICK_UID, summary: 'E2E Gantt Click' },
    { uid: PARENT_UID, summary: 'E2E Gantt Parent', dtstart: dayOffset(1), due: dayOffset(6) },
    {
      uid: CHILD_UID, summary: 'E2E Gantt Child', dtstart: dayOffset(1), due: dayOffset(3),
      relations: [{ relatedUid: PARENT_UID, reltype: 'PARENT' }],
    },
  ];

  for (const spec of specs) {
    await page.request.post('/api/tasks', { data: { data: { ...base, ...spec } } });
  }
}

async function openGantt(page: Page): Promise<void> {
  await page.goto('/tasks');
  await expect(page.getByRole('button', { name: 'New task' })).toBeVisible();
  await page.getByTitle('Gantt').click();
  await expect(page.locator('[data-testid="gantt-chart"]')).toBeVisible();
  await expect(bar(page, SPAN_UID)).toBeVisible();
}

const bar = (page: Page, uid: string) => page.locator(`[data-gantt-shape][data-uid="${uid}"]`);

/** Press, move in steps, release. Steps matter: a single jump can be coalesced away. */
async function dragBy(page: Page, box: { x: number; y: number; width: number; height: number }, fromX: number, dx: number) {
  const y = box.y + box.height / 2;
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(fromX + (dx * i) / 6, y, { steps: 2 });
  await page.mouse.up();
}

test.describe('Tasks — Gantt', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await login(page);
    await seed(page);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await login(page);
    for (const uid of ALL_UIDS) {
      const res = await page.request.get(`/api/tasks/${uid}`);
      if (!res.ok()) continue;
      const task = await res.json();
      await page.request.delete(`/api/tasks/${uid}?etag=${encodeURIComponent(task.etag)}`);
    }
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('switches to the Gantt layout and remembers the zoom', async ({ page }) => {
    await openGantt(page);
    for (const label of ['Day', 'Week', 'Month']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    }

    await page.getByRole('button', { name: 'Month', exact: true }).click();
    await page.reload();
    await expect(page.locator('[data-testid="gantt-chart"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Month', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Day', exact: true }).click();
  });

  test('draws spans as bars and single-dated tasks as milestones', async ({ page }) => {
    await openGantt(page);
    await expect(bar(page, SPAN_UID)).toHaveAttribute('data-gantt-shape', 'span');
    await expect(bar(page, SPAN_UID)).toHaveAttribute('data-gantt-start', dayOffset(0));
    await expect(bar(page, SPAN_UID)).toHaveAttribute('data-gantt-end', dayOffset(4));

    await expect(bar(page, MILESTONE_UID)).toHaveAttribute('data-gantt-shape', 'milestone');
    await expect(bar(page, MILESTONE_UID)).toHaveAttribute('data-gantt-date', dayOffset(2));

    // An undated task gets a row and a drag handle, but no mark.
    await expect(page.locator(`[data-uid="${UNSCHEDULED_UID}"][data-gantt-unscheduled="true"]`)).toBeVisible();
    await expect(bar(page, UNSCHEDULED_UID)).toHaveCount(0);
  });

  test('pages away from today and back', async ({ page }) => {
    await openGantt(page);
    await expect(page.locator('[data-testid="gantt-today-line"]')).toHaveCount(1);

    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('[data-testid="gantt-today-line"]')).toHaveCount(0);

    await page.getByRole('button', { name: 'Today' }).click();
    await expect(page.locator('[data-testid="gantt-today-line"]')).toHaveCount(1);
  });

  test('dragging a bar shifts both dates', async ({ page }) => {
    await openGantt(page);
    const target = bar(page, SPAN_UID);
    const box = (await target.boundingBox())!;
    await dragBy(page, box, box.x + box.width / 2, 3 * PX_PER_DAY);

    await expect(target).toHaveAttribute('data-gantt-start', dayOffset(3));
    await expect(target).toHaveAttribute('data-gantt-end', dayOffset(7));
  });

  test('dragging the end handle changes only the due date', async ({ page }) => {
    await openGantt(page);
    const target = bar(page, SPAN_UID);
    const start = await target.getAttribute('data-gantt-start');
    const end = await target.getAttribute('data-gantt-end');

    await target.hover(); // the handles only appear on hover
    const box = (await target.boundingBox())!;
    await dragBy(page, box, box.x + box.width - 3, 2 * PX_PER_DAY);

    await expect(target).toHaveAttribute('data-gantt-start', start!);
    await expect(target).not.toHaveAttribute('data-gantt-end', end!);
  });

  test('dropping an unscheduled task onto the chart schedules it', async ({ page }) => {
    await openGantt(page);
    const source = page.locator(`[data-uid="${UNSCHEDULED_UID}"][data-gantt-unscheduled="true"]`);
    const chart = page.locator('[data-testid="gantt-chart"]');
    const chartBox = (await chart.boundingBox())!;

    await source.dragTo(chart, { targetPosition: { x: chartBox.width / 2, y: 200 } });

    // The exact day depends on the scroll offset, so assert it became a span at all.
    await expect(bar(page, UNSCHEDULED_UID)).toHaveAttribute('data-gantt-shape', 'span');
  });

  test('sweeping across an unscheduled row sets a start and due date', async ({ page }) => {
    await openGantt(page);
    const row = page.locator(`[data-uid="${SWEEP_UID}"][data-gantt-unscheduled="true"]`);
    await expect(row).toBeVisible();
    await expect(bar(page, SWEEP_UID)).toHaveCount(0);

    // The sweep happens on the chart track, at the same vertical offset as the
    // task's row in the frozen column.
    const rowBox = (await row.boundingBox())!;
    const chartBox = (await page.locator('[data-testid="gantt-chart"]').boundingBox())!;
    const y = rowBox.y + rowBox.height / 2;
    const fromX = chartBox.x + chartBox.width / 2;

    await page.mouse.move(fromX, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(fromX + (3 * PX_PER_DAY * i) / 6, y, { steps: 2 });
    }
    await expect(page.locator('[data-testid="gantt-range-preview"]')).toBeVisible();
    await page.mouse.up();

    const target = bar(page, SWEEP_UID);
    await expect(target).toHaveAttribute('data-gantt-shape', 'span');
    const start = await target.getAttribute('data-gantt-start');
    const end = await target.getAttribute('data-gantt-end');
    // Three day-columns of travel, and DUE is inclusive, so the span covers 4 days.
    expect(daysApart(start!, end!)).toBe(3);
  });

  test('a click on an unscheduled row selects rather than scheduling', async ({ page }) => {
    await openGantt(page);
    await expect(bar(page, CLICK_UID)).toHaveCount(0);

    const row = page.locator(`[data-uid="${CLICK_UID}"][data-gantt-unscheduled="true"]`);
    const rowBox = (await row.boundingBox())!;
    const chartBox = (await page.locator('[data-testid="gantt-chart"]').boundingBox())!;
    await page.mouse.click(chartBox.x + chartBox.width / 2, rowBox.y + rowBox.height / 2);

    await expect(bar(page, CLICK_UID)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'E2E Gantt Click' })).toBeVisible();
  });

  test('the row button unschedules without deleting the task', async ({ page }) => {
    await openGantt(page);
    const row = page.locator(`[data-uid="${PARENT_UID}"]`).first();
    await expect(bar(page, PARENT_UID)).toHaveAttribute('data-gantt-shape', 'span');

    await row.getByTestId('gantt-unschedule').click();

    await expect(bar(page, PARENT_UID)).toHaveCount(0);
    // The task itself must survive — the control clears dates, it is not a delete.
    await expect(row).toBeVisible();
    await expect(
      page.locator(`[data-uid="${PARENT_UID}"][data-gantt-unscheduled="true"]`),
    ).toBeVisible();
    const server = await page.request.get(`/api/tasks/${PARENT_UID}`);
    expect(server.ok()).toBe(true);
    expect((await server.json()).data.summary).toBe('E2E Gantt Parent');
  });

  test('the unschedule button is offered only on dated rows', async ({ page }) => {
    await openGantt(page);
    // PARENT_UID was cleared by the previous test, so it now shows the tag instead.
    const cleared = page.locator(`[data-uid="${PARENT_UID}"]`).first();
    await expect(cleared.getByTestId('gantt-unschedule')).toHaveCount(0);
    await expect(cleared.getByText('Unscheduled')).toBeVisible();

    const dated = page.locator(`[data-uid="${SPAN_UID}"]`).first();
    await expect(dated.getByTestId('gantt-unschedule')).toHaveCount(1);
  });

  test('backspace clears the dates of the selected task', async ({ page }) => {
    await openGantt(page);
    await expect(bar(page, MILESTONE_UID)).toHaveAttribute('data-gantt-shape', 'milestone');

    await bar(page, MILESTONE_UID).click();
    await expect(page.getByRole('heading', { name: 'E2E Gantt Milestone' })).toBeVisible();
    await page.keyboard.press('Backspace');

    await expect(bar(page, MILESTONE_UID)).toHaveCount(0);
    await expect(
      page.locator(`[data-uid="${MILESTONE_UID}"][data-gantt-unscheduled="true"]`),
    ).toBeVisible();
  });

  test('backspace does not clear dates while typing in the search box', async ({ page }) => {
    await openGantt(page);
    await bar(page, SPAN_UID).click();
    const start = await bar(page, SPAN_UID).getAttribute('data-gantt-start');

    // useHotkey is supposed to stand down whenever focus is in an editable
    // element; without that guard, editing a search term would wipe the schedule.
    const search = page.getByPlaceholder('Search tasks…');
    await search.fill('abc');
    await search.press('Backspace');
    await expect(search).toHaveValue('ab');

    await search.clear();
    await expect(bar(page, SPAN_UID)).toHaveAttribute('data-gantt-start', start!);
  });

  test('collapsing a parent hides its subtask row', async ({ page }) => {
    await openGantt(page);
    await expect(bar(page, CHILD_UID)).toBeVisible();

    const parentRow = page.locator(`[data-uid="${PARENT_UID}"]`).first();
    await parentRow.getByRole('button', { name: 'Collapse subtasks' }).click();

    await expect(bar(page, CHILD_UID)).toHaveCount(0);
    await parentRow.getByRole('button', { name: 'Expand subtasks' }).click();
    await expect(bar(page, CHILD_UID)).toBeVisible();
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('renders without drag affordances and opens the detail panel on tap', async ({ page }) => {
      await page.goto('/tasks');
      // The layout toggles live in the collapsible filter group on mobile.
      await page.getByRole('button', { name: /Show filters/ }).click();
      await page.getByTitle('Gantt').click();

      await expect(page.locator('[data-testid="gantt-chart"]')).toBeVisible();
      await expect(page.locator('[data-testid="gantt-resize-end"]')).toHaveCount(0);
      await expect(page.locator('[data-uid][draggable="true"]')).toHaveCount(0);

      await bar(page, SPAN_UID).click();
      await expect(page.getByRole('heading', { name: 'E2E Gantt Span' })).toBeVisible();
    });
  });
});
