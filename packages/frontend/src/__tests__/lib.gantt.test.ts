import { describe, it, expect } from 'vitest';
import type { Task, TaskJson } from '@dave/shared';
import {
  GANTT_ZOOMS,
  ZOOM_CONFIG,
  MIN_BAR_PX,
  MILESTONE_PX,
  localTodayStr,
  snapBackToBoundary,
  computeWindow,
  dateToX,
  xToDayIndex,
  xToDateStr,
  pxToDayDelta,
  todayX,
  taskGanttShape,
  layoutBar,
  buildHeaderBands,
  computeBarDrag,
  computeScheduleDrop,
  computeRangeSchedule,
  computeUnschedule,
  flattenGanttRows,
} from '../lib/gantt';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTaskData(partial: Partial<TaskJson> = {}): TaskJson {
  return {
    uid: 'task-1',
    summary: 'Task',
    description: '',
    status: 'NEEDS-ACTION',
    priority: null,
    dtstart: null,
    due: null,
    completed: null,
    percentComplete: null,
    lastModified: null,
    categories: [],
    relations: [],
    collectionUrl: 'https://dav.test/cal/work/',
    alarms: [],
    rrule: null,
    ...partial,
  };
}

function makeTask(uid: string, partial: Partial<TaskJson> = {}): Task {
  return {
    uid,
    etag: `"${uid}"`,
    collectionUrl: 'https://dav.test/cal/work/',
    collectionId: 'work',
    data: makeTaskData({ uid, ...partial }),
  };
}

const TODAY = '2026-06-15'; // a Monday

// ── localTodayStr ─────────────────────────────────────────────────────────────

describe('localTodayStr', () => {
  it('uses the local calendar date, not the UTC one', () => {
    // 03:00 UTC on July 1st is still 23:00 on June 30th in New York. The Gantt
    // anchors on the date the *user* sees, so toISOString().slice(0,10) — which
    // would say July 1st — is the wrong answer.
    const tz = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      const instant = new Date('2026-07-01T03:00:00Z');
      expect(instant.toISOString().substring(0, 10)).toBe('2026-07-01');
      expect(localTodayStr(instant)).toBe('2026-06-30');
    } finally {
      process.env.TZ = tz;
    }
  });

  it('uses the local calendar date east of UTC too', () => {
    const tz = process.env.TZ;
    try {
      process.env.TZ = 'Australia/Sydney';
      // 22:00 UTC on June 30th is already 08:00 on July 1st in Sydney.
      expect(localTodayStr(new Date('2026-06-30T22:00:00Z'))).toBe('2026-07-01');
    } finally {
      process.env.TZ = tz;
    }
  });

  it('zero-pads month and day', () => {
    expect(localTodayStr(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

// ── snapBackToBoundary ────────────────────────────────────────────────────────

describe('snapBackToBoundary', () => {
  it('is the identity when there is no snap', () => {
    expect(snapBackToBoundary('2026-06-17', 'none')).toBe('2026-06-17');
  });

  it('floors to the preceding Monday', () => {
    expect(snapBackToBoundary('2026-06-17', 'week')).toBe('2026-06-15'); // Wed → Mon
    expect(snapBackToBoundary('2026-06-15', 'week')).toBe('2026-06-15'); // Mon → itself
    expect(snapBackToBoundary('2026-06-14', 'week')).toBe('2026-06-08'); // Sun → prior Mon
  });

  it('floors to the first of the month', () => {
    expect(snapBackToBoundary('2026-06-17', 'month')).toBe('2026-06-01');
    expect(snapBackToBoundary('2026-06-01', 'month')).toBe('2026-06-01');
  });
});

// ── computeWindow ─────────────────────────────────────────────────────────────

describe('computeWindow', () => {
  it.each(GANTT_ZOOMS)('page 0 contains today at %s zoom', (zoom) => {
    const win = computeWindow(TODAY, zoom, 0);
    expect(win.startStr <= TODAY).toBe(true);
    expect(win.endStr >= TODAY).toBe(true);
  });

  it.each(GANTT_ZOOMS)('totalWidth is totalDays * pxPerDay at %s zoom', (zoom) => {
    const win = computeWindow(TODAY, zoom, 0);
    expect(win.totalWidth).toBe(win.totalDays * win.pxPerDay);
    expect(win.totalDays).toBe(ZOOM_CONFIG[zoom].beforeDays + ZOOM_CONFIG[zoom].afterDays + 1);
  });

  it.each(GANTT_ZOOMS)('keeps a constant span across pages at %s zoom', (zoom) => {
    const days = [-2, -1, 0, 1, 2].map((p) => computeWindow(TODAY, zoom, p).totalDays);
    expect(new Set(days).size).toBe(1);
  });

  it('snaps the window start to a Monday at week zoom', () => {
    for (let i = 0; i < 7; i++) {
      const win = computeWindow(`2026-06-${String(15 + i).padStart(2, '0')}`, 'week', 0);
      expect(new Date(`${win.startStr}T00:00:00Z`).getUTCDay()).toBe(1);
    }
  });

  it('snaps the window start to the 1st at month zoom', () => {
    expect(computeWindow(TODAY, 'month', 0).startStr.endsWith('-01')).toBe(true);
  });

  it('shifts the start by exactly one page step where snapping allows', () => {
    for (const zoom of ['day', 'week'] as const) {
      const a = computeWindow(TODAY, zoom, 0).startStr;
      const b = computeWindow(TODAY, zoom, 1).startStr;
      const delta = (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
      expect(delta).toBe(ZOOM_CONFIG[zoom].pageStepDays);
    }
  });
});

// ── Geometry ──────────────────────────────────────────────────────────────────

describe('geometry round-trip', () => {
  it.each(GANTT_ZOOMS)('maps every day to x and back at %s zoom', (zoom) => {
    const win = computeWindow(TODAY, zoom, 0);
    for (let i = 0; i < 40; i++) {
      const dateStr = xToDateStr(win, i * win.pxPerDay);
      // Probe the middle of the column so the inverse can't land on a boundary.
      expect(xToDateStr(win, dateToX(win, dateStr) + win.pxPerDay / 2)).toBe(dateStr);
    }
  });

  it('clamps x to the window bounds', () => {
    const win = computeWindow(TODAY, 'day', 0);
    expect(xToDayIndex(win, -100)).toBe(0);
    expect(xToDayIndex(win, win.totalWidth + 100)).toBe(win.totalDays - 1);
  });

  it('strips the time component before positioning', () => {
    const win = computeWindow(TODAY, 'day', 0);
    expect(dateToX(win, `${TODAY}T17:30:00Z`)).toBe(dateToX(win, TODAY));
  });
});

describe('pxToDayDelta', () => {
  it('rounds to whole days', () => {
    expect(pxToDayDelta(0, 32)).toBe(0);
    expect(pxToDayDelta(31, 32)).toBe(1);
    expect(pxToDayDelta(16, 32)).toBe(1);
    expect(pxToDayDelta(2, 4)).toBe(1); // month zoom
  });

  it('rounds symmetrically about zero', () => {
    // Math.round alone would give -1 here, making a left drag feel stickier than a right one.
    expect(pxToDayDelta(-48, 32)).toBe(-2);
    expect(pxToDayDelta(48, 32)).toBe(2);
    expect(pxToDayDelta(-16, 32)).toBe(-1);
  });
});

describe('todayX', () => {
  it('returns the offset when today is in the window', () => {
    const win = computeWindow(TODAY, 'day', 0);
    expect(todayX(win, TODAY)).toBe(ZOOM_CONFIG.day.beforeDays * win.pxPerDay);
  });

  it('returns null when today is off the page', () => {
    const win = computeWindow(TODAY, 'day', 3);
    expect(todayX(win, TODAY)).toBeNull();
  });
});

// ── taskGanttShape ────────────────────────────────────────────────────────────

describe('taskGanttShape', () => {
  it('spans from start to due, inclusive of the due day', () => {
    const shape = taskGanttShape(makeTaskData({ dtstart: '2026-06-15', due: '2026-06-17' }));
    expect(shape).toEqual({ kind: 'span', startStr: '2026-06-15', endStr: '2026-06-17', inverted: false });
  });

  it('collapses an inverted span to a single day', () => {
    const shape = taskGanttShape(makeTaskData({ dtstart: '2026-06-17', due: '2026-06-15' }));
    expect(shape).toEqual({ kind: 'span', startStr: '2026-06-17', endStr: '2026-06-17', inverted: true });
  });

  it('reports which date a milestone came from', () => {
    expect(taskGanttShape(makeTaskData({ due: '2026-06-15' }))).toEqual({
      kind: 'milestone', dateStr: '2026-06-15', anchor: 'due',
    });
    expect(taskGanttShape(makeTaskData({ dtstart: '2026-06-15' }))).toEqual({
      kind: 'milestone', dateStr: '2026-06-15', anchor: 'dtstart',
    });
  });

  it('returns none for an undated task', () => {
    expect(taskGanttShape(makeTaskData())).toEqual({ kind: 'none' });
  });

  it('still shapes CANCELLED tasks', () => {
    // Deliberately unlike taskToFcEvent, which drops them: removing a Gantt row
    // would break the indentation of every descendant.
    const shape = taskGanttShape(makeTaskData({ status: 'CANCELLED', due: '2026-06-15' }));
    expect(shape.kind).toBe('milestone');
  });

  it('reduces datetimes to their date', () => {
    const shape = taskGanttShape(
      makeTaskData({ dtstart: '2026-06-15T09:00:00Z', due: '2026-06-17T17:00:00Z' }),
    );
    expect(shape).toMatchObject({ startStr: '2026-06-15', endStr: '2026-06-17' });
  });
});

// ── layoutBar ─────────────────────────────────────────────────────────────────

describe('layoutBar', () => {
  const win = computeWindow(TODAY, 'day', 0);

  it('places a span fully inside the window', () => {
    const bar = layoutBar(win, taskGanttShape(makeTaskData({ dtstart: TODAY, due: '2026-06-17' })))!;
    expect(bar).toMatchObject({ x: dateToX(win, TODAY), width: 3 * win.pxPerDay, offWindow: null });
    expect(bar.clippedLeft).toBe(false);
    expect(bar.clippedRight).toBe(false);
  });

  it('gives a one-day span one column of width', () => {
    const bar = layoutBar(win, taskGanttShape(makeTaskData({ dtstart: TODAY, due: TODAY })))!;
    expect(bar.width).toBe(win.pxPerDay);
  });

  it('clips a span that starts before the window', () => {
    const shape = taskGanttShape(makeTaskData({ dtstart: '2026-01-01', due: TODAY }));
    const bar = layoutBar(win, shape)!;
    expect(bar.x).toBe(0);
    expect(bar.clippedLeft).toBe(true);
    expect(bar.clippedRight).toBe(false);
    expect(bar.width).toBe(dateToX(win, TODAY) + win.pxPerDay);
  });

  it('clips a span that ends after the window', () => {
    const bar = layoutBar(win, taskGanttShape(makeTaskData({ dtstart: TODAY, due: '2027-12-31' })))!;
    expect(bar.clippedRight).toBe(true);
    expect(bar.x + bar.width).toBe(win.totalWidth);
  });

  it('reports a span entirely before the window', () => {
    const shape = taskGanttShape(makeTaskData({ dtstart: '2020-01-01', due: '2020-01-05' }));
    expect(layoutBar(win, shape)).toMatchObject({ offWindow: 'before', width: 0 });
  });

  it('reports a span entirely after the window', () => {
    const shape = taskGanttShape(makeTaskData({ dtstart: '2030-01-01', due: '2030-01-05' }));
    expect(layoutBar(win, shape)).toMatchObject({ offWindow: 'after', width: 0 });
  });

  it('floors a sub-pixel span at MIN_BAR_PX', () => {
    const monthWin = computeWindow(TODAY, 'month', 0);
    const bar = layoutBar(monthWin, taskGanttShape(makeTaskData({ dtstart: TODAY, due: TODAY })))!;
    expect(monthWin.pxPerDay).toBeLessThan(MIN_BAR_PX);
    expect(bar.width).toBe(MIN_BAR_PX);
  });

  it('centres a milestone on its day', () => {
    const bar = layoutBar(win, taskGanttShape(makeTaskData({ due: TODAY })))!;
    expect(bar.width).toBe(MILESTONE_PX);
    expect(bar.x + MILESTONE_PX / 2).toBe(dateToX(win, TODAY) + win.pxPerDay / 2);
  });

  it('never gives a milestone a negative x', () => {
    // At month zoom the diamond is wider than a day column, so day 0 would
    // otherwise centre to a negative offset.
    const monthWin = computeWindow(TODAY, 'month', 0);
    const bar = layoutBar(monthWin, taskGanttShape(makeTaskData({ due: monthWin.startStr })))!;
    expect(bar.x).toBeGreaterThanOrEqual(0);
  });

  it('returns null for an undated task', () => {
    expect(layoutBar(win, { kind: 'none' })).toBeNull();
  });
});

// ── buildHeaderBands ──────────────────────────────────────────────────────────

describe('buildHeaderBands', () => {
  it.each(GANTT_ZOOMS)('tiles both bands across the full width at %s zoom', (zoom) => {
    const win = computeWindow(TODAY, zoom, 0);
    const { top, bottom } = buildHeaderBands(win, TODAY, 'en-US');
    for (const band of [top, bottom]) {
      expect(band.reduce((sum, c) => sum + c.width, 0)).toBe(win.totalWidth);
      // Cells must partition the axis with no gaps or overlaps.
      let x = 0;
      for (const cell of band) {
        expect(cell.x).toBe(x);
        x += cell.width;
      }
    }
  });

  it('gives day zoom one cell per day, flagging today and weekends', () => {
    const win = computeWindow(TODAY, 'day', 0);
    const { bottom } = buildHeaderBands(win, TODAY, 'en-US');
    expect(bottom).toHaveLength(win.totalDays);
    expect(bottom.filter((c) => c.isToday)).toHaveLength(1);
    const weekend = bottom.filter((c) => c.isWeekend);
    expect(weekend.length).toBeGreaterThan(0);
    for (const cell of weekend) {
      const dow = new Date(`${cell.key}T00:00:00Z`).getUTCDay();
      expect(dow === 0 || dow === 6).toBe(true);
    }
  });

  it('gives week zoom full seven-day cells', () => {
    const win = computeWindow(TODAY, 'week', 0);
    const { bottom } = buildHeaderBands(win, TODAY, 'en-US');
    expect(bottom[0]!.width).toBe(7 * win.pxPerDay);
    expect(bottom.filter((c) => c.isToday)).toHaveLength(1);
  });

  it('sizes each month cell by its real length, including leap days', () => {
    // February 2028 has 29 days; a fixed 30-day cell would drift the whole band.
    const win = computeWindow('2028-02-15', 'month', 0);
    const { top, bottom } = buildHeaderBands(win, '2028-02-15', 'en-US');
    const feb = bottom.find((c) => c.key === '2028-02')!;
    expect(feb.width).toBe(29 * win.pxPerDay);
    expect(top.every((c) => /^\d{4}$/.test(c.label))).toBe(true);
  });

  it('formats labels in UTC', () => {
    // A local-timezone format would render the previous day west of UTC.
    const win = computeWindow('2026-03-01', 'day', 0);
    const { bottom } = buildHeaderBands(win, '2026-03-01', 'en-US');
    const first = bottom.find((c) => c.key === '2026-03-01')!;
    expect(first.label).toBe('1');
  });
});

// ── computeBarDrag ────────────────────────────────────────────────────────────

describe('computeBarDrag', () => {
  it('moves both dates, preserving duration', () => {
    const data = makeTaskData({ dtstart: '2026-06-15', due: '2026-06-18' });
    expect(computeBarDrag(data, 'move', 3)).toMatchObject({
      dtstart: '2026-06-18', due: '2026-06-21',
    });
  });

  it('preserves the time of day on a timed date', () => {
    // The backend writes a DATE when the string has no time and a DATE-TIME when it
    // does, so dropping the time here would silently convert the task to all-day.
    const data = makeTaskData({ dtstart: '2026-06-15', due: '2026-06-18T17:00:00Z' });
    expect(computeBarDrag(data, 'move', 3)!.due).toBe('2026-06-21T17:00:00Z');
  });

  it('keeps all-day dates bare', () => {
    const data = makeTaskData({ dtstart: '2026-06-15', due: '2026-06-18' });
    const next = computeBarDrag(data, 'move', 1)!;
    expect(next.dtstart).not.toContain('T');
    expect(next.due).not.toContain('T');
  });

  it('resizes one edge without touching the other', () => {
    const data = makeTaskData({ dtstart: '2026-06-15', due: '2026-06-20' });
    expect(computeBarDrag(data, 'resize-start', 2)).toMatchObject({
      dtstart: '2026-06-17', due: '2026-06-20',
    });
    expect(computeBarDrag(data, 'resize-end', -2)).toMatchObject({
      dtstart: '2026-06-15', due: '2026-06-18',
    });
  });

  it('clamps a resize at a one-day bar instead of inverting', () => {
    const data = makeTaskData({ dtstart: '2026-06-15', due: '2026-06-18' });
    expect(computeBarDrag(data, 'resize-start', 99)!.dtstart).toBe('2026-06-18');
    expect(computeBarDrag(data, 'resize-end', -99)!.due).toBe('2026-06-15');
  });

  it('moves whichever single date a milestone has', () => {
    expect(computeBarDrag(makeTaskData({ due: '2026-06-15' }), 'milestone', 2)!.due).toBe('2026-06-17');
    expect(computeBarDrag(makeTaskData({ dtstart: '2026-06-15' }), 'milestone', 2)!.dtstart).toBe('2026-06-17');
  });

  it('returns null when the mode is impossible', () => {
    expect(computeBarDrag(makeTaskData({ due: '2026-06-15' }), 'resize-start', 1)).toBeNull();
    expect(computeBarDrag(makeTaskData({ due: '2026-06-15' }), 'resize-end', 1)).toBeNull();
    expect(computeBarDrag(makeTaskData(), 'move', 1)).toBeNull();
    expect(computeBarDrag(makeTaskData({ dtstart: 'x', due: 'y' }), 'milestone', 1)).toBeNull();
  });

  it('never mutates its input', () => {
    const data = makeTaskData({ dtstart: '2026-06-15', due: '2026-06-18' });
    const next = computeBarDrag(data, 'move', 0)!;
    expect(next).not.toBe(data);
    expect(next).toEqual(data);
    expect(data.dtstart).toBe('2026-06-15');
  });

  it('is unaffected by a DST transition', () => {
    // US DST starts 2026-03-08. Epoch-ms arithmetic would shift the wall clock by
    // an hour across it; string/UTC arithmetic must not.
    const data = makeTaskData({ dtstart: '2026-03-06T14:30:00', due: '2026-03-06T16:30:00' });
    const next = computeBarDrag(data, 'move', 4)!;
    expect(next.dtstart).toBe('2026-03-10T14:30:00');
    expect(next.due).toBe('2026-03-10T16:30:00');
  });
});

// ── computeScheduleDrop ───────────────────────────────────────────────────────

describe('computeRangeSchedule', () => {
  it('sets both dates from a left-to-right sweep', () => {
    expect(computeRangeSchedule(makeTaskData(), '2026-06-15', '2026-06-18')).toMatchObject({
      dtstart: '2026-06-15', due: '2026-06-18',
    });
  });

  it('orders a right-to-left sweep', () => {
    // The anchor is wherever the pointer went down, so it can be the later day.
    expect(computeRangeSchedule(makeTaskData(), '2026-06-18', '2026-06-15')).toMatchObject({
      dtstart: '2026-06-15', due: '2026-06-18',
    });
  });

  it('allows a single-day range', () => {
    expect(computeRangeSchedule(makeTaskData(), '2026-06-15', '2026-06-15')).toMatchObject({
      dtstart: '2026-06-15', due: '2026-06-15',
    });
  });

  it('leaves an already-dated task alone', () => {
    const data = makeTaskData({ due: '2026-06-01' });
    expect(computeRangeSchedule(data, '2026-06-15', '2026-06-18')).toBe(data);
  });

  it('never mutates its input', () => {
    const data = makeTaskData();
    computeRangeSchedule(data, '2026-06-15', '2026-06-18');
    expect(data.dtstart).toBeNull();
    expect(data.due).toBeNull();
  });
});

describe('computeScheduleDrop', () => {
  it('gives an unscheduled task a one-day span on the drop date', () => {
    const data = makeTaskData();
    expect(computeScheduleDrop(data, '2026-06-15')).toMatchObject({
      dtstart: '2026-06-15', due: '2026-06-15',
    });
  });

  it('leaves an already-dated task alone', () => {
    const data = makeTaskData({ due: '2026-06-01' });
    expect(computeScheduleDrop(data, '2026-06-15')).toBe(data);
  });

  it('never mutates its input', () => {
    const data = makeTaskData();
    computeScheduleDrop(data, '2026-06-15');
    expect(data.dtstart).toBeNull();
    expect(data.due).toBeNull();
  });
});

// ── flattenGanttRows ──────────────────────────────────────────────────────────

describe('computeUnschedule', () => {
  it('clears both dates of a span', () => {
    const next = computeUnschedule(makeTaskData({ dtstart: '2026-06-15', due: '2026-06-18' }))!;
    expect(next.dtstart).toBeNull();
    expect(next.due).toBeNull();
  });

  it('clears the single date of a milestone', () => {
    expect(computeUnschedule(makeTaskData({ due: '2026-06-15' }))!.due).toBeNull();
    expect(computeUnschedule(makeTaskData({ dtstart: '2026-06-15' }))!.dtstart).toBeNull();
  });

  it('returns null when there is nothing to clear', () => {
    // Lets the caller skip a PUT that would be a no-op on the server.
    expect(computeUnschedule(makeTaskData())).toBeNull();
  });

  it('leaves every other field alone', () => {
    const data = makeTaskData({
      dtstart: '2026-06-15', due: '2026-06-18', summary: 'Keep me',
      categories: ['work'], rrule: 'FREQ=WEEKLY', percentComplete: 40,
    });
    expect(computeUnschedule(data)).toMatchObject({
      summary: 'Keep me', categories: ['work'], rrule: 'FREQ=WEEKLY', percentComplete: 40,
    });
  });

  it('never mutates its input', () => {
    const data = makeTaskData({ dtstart: '2026-06-15', due: '2026-06-18' });
    computeUnschedule(data);
    expect(data.dtstart).toBe('2026-06-15');
    expect(data.due).toBe('2026-06-18');
  });
});

describe('flattenGanttRows', () => {
  const a = makeTask('a');
  const b = makeTask('b');
  const c = makeTask('c');
  const d = makeTask('d');

  // a → b → c, plus sibling d under a
  const childrenOf = new Map([
    ['a', [b, d]],
    ['b', [c]],
  ]);

  it('emits each parent immediately before its descendants', () => {
    const rows = flattenGanttRows([a], childrenOf, new Set());
    expect(rows.map((r) => r.task.uid)).toEqual(['a', 'b', 'c', 'd']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 1]);
  });

  it('reports child counts', () => {
    const rows = flattenGanttRows([a], childrenOf, new Set());
    expect(rows.find((r) => r.task.uid === 'a')!.childCount).toBe(2);
    expect(rows.find((r) => r.task.uid === 'c')!.childCount).toBe(0);
  });

  it('hides grandchildren of a collapsed parent', () => {
    const rows = flattenGanttRows([a], childrenOf, new Set(['b']));
    expect(rows.map((r) => r.task.uid)).toEqual(['a', 'b', 'd']);
    expect(rows.find((r) => r.task.uid === 'b')!.isCollapsed).toBe(true);
  });

  it('preserves sibling order', () => {
    const reversed = new Map([['a', [d, b]], ['b', [c]]]);
    expect(flattenGanttRows([a], reversed, new Set()).map((r) => r.task.uid)).toEqual([
      'a', 'd', 'b', 'c',
    ]);
  });

  it('terminates on a relation cycle, emitting each task once', () => {
    // buildTree has no cycle guard, so malformed RELATED-TO data can reach us.
    const cyclic = new Map([['a', [b]], ['b', [a]]]);
    const rows = flattenGanttRows([a], cyclic, new Set());
    expect(rows.map((r) => r.task.uid)).toEqual(['a', 'b']);
  });

  it('puts a task whose parent was filtered out at depth 0', () => {
    const rows = flattenGanttRows([a, c], childrenOf, new Set(['a']));
    expect(rows.map((r) => [r.task.uid, r.depth])).toEqual([['a', 0], ['c', 0]]);
  });
});
