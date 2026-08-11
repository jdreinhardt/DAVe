// Pure helpers for the Tasks page's Gantt layout: window/geometry math, bar
// placement, drag arithmetic and row flattening. Kept free of React / DOM so the
// timezone-sensitive date math can be unit-tested on its own — same discipline as
// calendarLayers.ts, whose UTC date-string helpers this file builds on rather than
// re-deriving.

import type { Task, TaskJson } from '@dave/shared';
import { dateOnly, applyNewDate, dateStrToUtc, addDaysToDateStr, daysBetween } from './calendarLayers';

// ── Zoom levels ───────────────────────────────────────────────────────────────

export const GANTT_ZOOMS = ['day', 'week', 'month'] as const;
export type GanttZoom = (typeof GANTT_ZOOMS)[number];

/** Which calendar boundary the window start is floored to, so header bands never begin mid-cell. */
type BoundarySnap = 'none' | 'week' | 'month';

export interface ZoomConfig {
  pxPerDay: number;
  /** Days of context before the anchor (today, or today shifted by paging). */
  beforeDays: number;
  /** Days of horizon after the anchor. */
  afterDays: number;
  /** How far one prev/next page moves the anchor. */
  pageStepDays: number;
  snap: BoundarySnap;
}

export const ZOOM_CONFIG: Record<GanttZoom, ZoomConfig> = {
  day: { pxPerDay: 32, beforeDays: 14, afterDays: 90, pageStepDays: 30, snap: 'none' },
  week: { pxPerDay: 12, beforeDays: 28, afterDays: 273, pageStepDays: 91, snap: 'week' },
  month: { pxPerDay: 4, beforeDays: 90, afterDays: 640, pageStepDays: 365, snap: 'month' },
};

// ── Layout constants ──────────────────────────────────────────────────────────

export const ROW_H = 32;
export const HEADER_H = 48; // two 24px bands
export const MIN_BAR_PX = 6;
export const MILESTONE_PX = 12;
export const INDENT_PX = 14;
export const MAX_INDENT_DEPTH = 6;
export const SIDEBAR_W = 240;

// ── Window ────────────────────────────────────────────────────────────────────

export interface GanttWindow {
  zoom: GanttZoom;
  /** Inclusive 'YYYY-MM-DD'. */
  startStr: string;
  /** Inclusive 'YYYY-MM-DD'. */
  endStr: string;
  totalDays: number;
  pxPerDay: number;
  totalWidth: number;
}

/**
 * Today as 'YYYY-MM-DD' in the *browser's* timezone. Deliberately not
 * `toISOString().slice(0, 10)` — that yields UTC-today, which is a day ahead
 * east of UTC once local time passes midnight-UTC.
 */
export function localTodayStr(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Floor a date string back to the preceding Monday / 1st of the month. */
export function snapBackToBoundary(dateStr: string, snap: BoundarySnap): string {
  if (snap === 'none') return dateStr;
  if (snap === 'month') return `${dateStr.substring(0, 7)}-01`;
  // getUTCDay: 0 = Sunday. Shift so Monday is the week start.
  const dow = new Date(dateStrToUtc(dateStr)).getUTCDay();
  return addDaysToDateStr(dateStr, -((dow + 6) % 7));
}

/**
 * The visible date window: a fixed-length span anchored on today, shifted by
 * `page` whole pages. The span length is constant per zoom (boundary snapping
 * moves the start earlier and carries the end with it), so the chart never
 * changes width as the user pages.
 */
export function computeWindow(todayStr: string, zoom: GanttZoom, page: number): GanttWindow {
  const cfg = ZOOM_CONFIG[zoom];
  const totalDays = cfg.beforeDays + cfg.afterDays + 1;
  const anchor = addDaysToDateStr(todayStr, page * cfg.pageStepDays);
  const startStr = snapBackToBoundary(addDaysToDateStr(anchor, -cfg.beforeDays), cfg.snap);
  return {
    zoom,
    startStr,
    endStr: addDaysToDateStr(startStr, totalDays - 1),
    totalDays,
    pxPerDay: cfg.pxPerDay,
    totalWidth: totalDays * cfg.pxPerDay,
  };
}

/**
 * The x offset of a date's leading edge. Unclamped by design — may be negative or
 * past `totalWidth`; layoutBar owns the clamping and the off-window verdict.
 */
export function dateToX(win: GanttWindow, dateStr: string): number {
  return daysBetween(win.startStr, dateOnly(dateStr)) * win.pxPerDay;
}

/** The day column an x offset falls in, clamped to the window. */
export function xToDayIndex(win: GanttWindow, x: number): number {
  const idx = Math.floor(x / win.pxPerDay);
  return Math.min(win.totalDays - 1, Math.max(0, idx));
}

/** The date an x offset falls on, clamped to the window. */
export function xToDateStr(win: GanttWindow, x: number): string {
  return addDaysToDateStr(win.startStr, xToDayIndex(win, x));
}

/**
 * Convert a horizontal drag distance to whole days. The single place pixels
 * become days — day granularity at every zoom follows from this. Rounds half
 * *away from zero* so dragging left and right feel symmetric (plain Math.round
 * rounds -1.5 to -1 but 1.5 to 2).
 */
export function pxToDayDelta(dx: number, pxPerDay: number): number {
  return Math.sign(dx) * Math.round(Math.abs(dx) / pxPerDay);
}

/** Whether today falls inside the window, and where. */
export function todayX(win: GanttWindow, todayStr: string): number | null {
  const idx = daysBetween(win.startStr, todayStr);
  if (idx < 0 || idx >= win.totalDays) return null;
  return idx * win.pxPerDay;
}

// ── Task shapes ───────────────────────────────────────────────────────────────

export type GanttShape =
  | { kind: 'span'; startStr: string; endStr: string; inverted: boolean }
  | { kind: 'milestone'; dateStr: string; anchor: 'dtstart' | 'due' }
  | { kind: 'none' };

/**
 * How a task is drawn: both dates give a span (DUE inclusive), exactly one gives
 * a milestone, neither gives nothing.
 *
 * Unlike taskToFcEvent this does *not* drop CANCELLED tasks — the Gantt renders a
 * tree, and removing a row would break the parent/child indentation of everything
 * beneath it. Cancelled tasks are styled, not filtered.
 */
export function taskGanttShape(data: TaskJson): GanttShape {
  const { dtstart, due } = data;
  if (dtstart && due) {
    const startStr = dateOnly(dtstart);
    const dueStr = dateOnly(due);
    // A due date before the start is malformed data, not something to render
    // backwards — collapse it to a single day at the start.
    const inverted = daysBetween(startStr, dueStr) < 0;
    return { kind: 'span', startStr, endStr: inverted ? startStr : dueStr, inverted };
  }
  if (dtstart) return { kind: 'milestone', dateStr: dateOnly(dtstart), anchor: 'dtstart' };
  if (due) return { kind: 'milestone', dateStr: dateOnly(due), anchor: 'due' };
  return { kind: 'none' };
}

export interface BarLayout {
  x: number;
  width: number;
  clippedLeft: boolean;
  clippedRight: boolean;
  /** Set when the task falls entirely outside the window; x is pinned to that edge. */
  offWindow: 'before' | 'after' | null;
}

/** Place a shape in the window, clamping to its bounds and reporting what was cut off. */
export function layoutBar(win: GanttWindow, shape: GanttShape): BarLayout | null {
  if (shape.kind === 'none') return null;

  let rawX: number;
  let rawW: number;
  if (shape.kind === 'span') {
    rawX = dateToX(win, shape.startStr);
    // +1 because DUE is an inclusive day, not an exclusive boundary.
    rawW = (daysBetween(shape.startStr, shape.endStr) + 1) * win.pxPerDay;
  } else {
    // Centre the diamond on its day. At month zoom a day is narrower than the
    // diamond, so it deliberately overflows its column rather than vanishing.
    rawX = dateToX(win, shape.dateStr) + win.pxPerDay / 2 - MILESTONE_PX / 2;
    rawW = MILESTONE_PX;
  }

  const spanEnd = shape.kind === 'span' ? rawX + rawW : dateToX(win, shape.dateStr) + win.pxPerDay;
  const spanStart = shape.kind === 'span' ? rawX : dateToX(win, shape.dateStr);
  if (spanEnd <= 0) {
    return { x: 0, width: 0, clippedLeft: false, clippedRight: false, offWindow: 'before' };
  }
  if (spanStart >= win.totalWidth) {
    return { x: win.totalWidth, width: 0, clippedLeft: false, clippedRight: false, offWindow: 'after' };
  }

  if (shape.kind === 'milestone') {
    const x = Math.min(Math.max(0, rawX), Math.max(0, win.totalWidth - MILESTONE_PX));
    return { x, width: MILESTONE_PX, clippedLeft: false, clippedRight: false, offWindow: null };
  }

  const clippedLeft = rawX < 0;
  const clippedRight = rawX + rawW > win.totalWidth;
  let x = Math.max(0, rawX);
  let width = Math.max(MIN_BAR_PX, Math.min(win.totalWidth, rawX + rawW) - x);
  if (x + width > win.totalWidth) x = Math.max(0, win.totalWidth - width);
  if (width > win.totalWidth) width = win.totalWidth;
  return { x, width, clippedLeft, clippedRight, offWindow: null };
}

// ── Header bands ──────────────────────────────────────────────────────────────

export interface HeaderCell {
  key: string;
  label: string;
  x: number;
  width: number;
  isToday?: boolean;
  isWeekend?: boolean;
}

function fmt(dateStr: string, opts: Intl.DateTimeFormatOptions, locale?: string): string {
  // timeZone: 'UTC' is mandatory — the Date is constructed at UTC midnight, so
  // formatting it in the local zone would render the previous day west of UTC.
  return new Date(dateStrToUtc(dateStr)).toLocaleDateString(locale, { ...opts, timeZone: 'UTC' });
}

/** Group consecutive days sharing a key into run-length cells (month runs, year runs). */
function runs(
  win: GanttWindow,
  keyOf: (dateStr: string) => string,
  labelOf: (dateStr: string) => string,
): HeaderCell[] {
  const cells: HeaderCell[] = [];
  for (let i = 0; i < win.totalDays; i++) {
    const dateStr = addDaysToDateStr(win.startStr, i);
    const key = keyOf(dateStr);
    const last = cells[cells.length - 1];
    if (last && last.key === key) {
      last.width += win.pxPerDay;
    } else {
      cells.push({ key, label: labelOf(dateStr), x: i * win.pxPerDay, width: win.pxPerDay });
    }
  }
  return cells;
}

/**
 * The two header bands for a window. Every cell width is a whole number of day
 * columns, so the bands align to the body gridlines with no accumulated rounding.
 */
export function buildHeaderBands(
  win: GanttWindow,
  todayStr: string,
  locale?: string,
): { top: HeaderCell[]; bottom: HeaderCell[] } {
  const monthRuns = () =>
    runs(win, (d) => d.substring(0, 7), (d) => fmt(d, { month: 'long', year: 'numeric' }, locale));

  if (win.zoom === 'day') {
    const bottom: HeaderCell[] = [];
    for (let i = 0; i < win.totalDays; i++) {
      const dateStr = addDaysToDateStr(win.startStr, i);
      const dow = new Date(dateStrToUtc(dateStr)).getUTCDay();
      bottom.push({
        key: dateStr,
        label: String(Number(dateStr.substring(8, 10))),
        x: i * win.pxPerDay,
        width: win.pxPerDay,
        isToday: dateStr === todayStr,
        isWeekend: dow === 0 || dow === 6,
      });
    }
    return { top: monthRuns(), bottom };
  }

  if (win.zoom === 'week') {
    const bottom: HeaderCell[] = [];
    for (let i = 0; i < win.totalDays; i += 7) {
      const dateStr = addDaysToDateStr(win.startStr, i);
      const days = Math.min(7, win.totalDays - i); // the last cell may be partial
      bottom.push({
        key: dateStr,
        label: fmt(dateStr, { month: 'short', day: 'numeric' }, locale),
        x: i * win.pxPerDay,
        width: days * win.pxPerDay,
        isToday: todayStr >= dateStr && todayStr < addDaysToDateStr(dateStr, days),
      });
    }
    return { top: monthRuns(), bottom };
  }

  return {
    top: runs(win, (d) => d.substring(0, 4), (d) => d.substring(0, 4)),
    bottom: runs(win, (d) => d.substring(0, 7), (d) => fmt(d, { month: 'short' }, locale)).map(
      (c) => ({ ...c, isToday: c.key === todayStr.substring(0, 7) }),
    ),
  };
}

// ── Drag arithmetic ───────────────────────────────────────────────────────────

export type DragMode = 'move' | 'resize-start' | 'resize-end' | 'milestone';

/** Shift one ISO date field by whole days, preserving any time-of-day component. */
function shift(iso: string, days: number): string {
  return applyNewDate(iso, addDaysToDateStr(dateOnly(iso), days));
}

/**
 * The task fields after a drag of `deltaDays`. Returns null when the mode is
 * impossible for this data, so the caller can revert.
 *
 * Every write goes through applyNewDate: the backend's setDateOrDatetime treats a
 * bare 'YYYY-MM-DD' as a DATE value, so assigning one over a timed DUE would
 * silently convert the VTODO to all-day. Never mutates the input.
 */
export function computeBarDrag(data: TaskJson, mode: DragMode, deltaDays: number): TaskJson | null {
  const next: TaskJson = { ...data };
  const { dtstart, due } = data;

  if (mode === 'move') {
    if (!dtstart && !due) return null;
    if (dtstart) next.dtstart = shift(dtstart, deltaDays);
    if (due) next.due = shift(due, deltaDays);
    return next;
  }

  if (mode === 'milestone') {
    // A milestone has exactly one date and never gains a second one from a drag.
    if (dtstart && due) return null;
    if (dtstart) next.dtstart = shift(dtstart, deltaDays);
    else if (due) next.due = shift(due, deltaDays);
    else return null;
    return next;
  }

  // Resizes need both dates, and clamp so the bar can't invert — one day is the floor.
  if (!dtstart || !due) return null;
  const duration = daysBetween(dateOnly(dtstart), dateOnly(due));
  if (mode === 'resize-start') {
    next.dtstart = shift(dtstart, Math.min(deltaDays, duration));
  } else {
    next.due = shift(due, Math.max(deltaDays, -duration));
  }
  return next;
}

/**
 * The task fields after dropping an unscheduled task on `dropDateStr`. Gives it a
 * one-day span rather than a single date, so either edge can immediately be
 * dragged out to a real duration. Never mutates the input.
 */
export function computeScheduleDrop(data: TaskJson, dropDateStr: string): TaskJson {
  return computeRangeSchedule(data, dropDateStr, dropDateStr);
}

/**
 * The task fields after sweeping out a date range on an unscheduled task's empty
 * track. The two days are whichever ends the user dragged between, so they arrive
 * in either order; DUE is inclusive of the later one. Never mutates the input.
 */
export function computeRangeSchedule(data: TaskJson, dayA: string, dayB: string): TaskJson {
  if (data.dtstart || data.due) return data; // defensive: only unscheduled tasks are sources
  const [dtstart, due] = daysBetween(dayA, dayB) < 0 ? [dayB, dayA] : [dayA, dayB];
  return { ...data, dtstart, due };
}

/**
 * The task fields after clearing its schedule, or null when there is nothing to
 * clear so the caller can skip a pointless write. Never mutates the input.
 */
export function computeUnschedule(data: TaskJson): TaskJson | null {
  if (!data.dtstart && !data.due) return null;
  return { ...data, dtstart: null, due: null };
}

// ── Row flattening ────────────────────────────────────────────────────────────

export interface GanttRow {
  task: Task;
  depth: number;
  childCount: number;
  isCollapsed: boolean;
}

/**
 * Depth-first flatten of the task tree into chart rows, skipping the descendants
 * of collapsed parents. Sibling order is preserved from `childrenOf`, so the
 * toolbar's sort/order controls still govern — the chart never re-sorts by date.
 *
 * The `seen` set makes a malformed RELATED-TO cycle terminate instead of hanging;
 * buildTree in TasksPage has no such guard.
 */
export function flattenGanttRows(
  roots: Task[],
  childrenOf: Map<string, Task[]>,
  collapsed: Set<string>,
): GanttRow[] {
  const rows: GanttRow[] = [];
  const seen = new Set<string>();

  const walk = (task: Task, depth: number) => {
    if (seen.has(task.uid)) return;
    seen.add(task.uid);
    const children = childrenOf.get(task.uid) ?? [];
    const isCollapsed = collapsed.has(task.uid);
    rows.push({ task, depth, childCount: children.length, isCollapsed });
    if (isCollapsed) return;
    for (const child of children) walk(child, depth + 1);
  };

  for (const root of roots) walk(root, 0);
  return rows;
}
