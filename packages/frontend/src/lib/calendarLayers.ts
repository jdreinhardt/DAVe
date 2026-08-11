// Pure helpers for the Calendar view's task and journal overlay layers.
// Kept free of React / DOM so they can be unit-tested — the timezone-sensitive
// date math here is load-bearing (tile placement + drag-to-reschedule).

import type { EventInput } from '@fullcalendar/core';
import type { Task, TaskJson, Note, NoteJson, CalendarTaskDate } from '@dave/shared';

/** The date portion ('YYYY-MM-DD') of an ISO date or datetime string. */
export const dateOnly = (iso: string): string => iso.substring(0, 10);

/** Replace the date portion of an ISO string, preserving any time component. */
export function applyNewDate(iso: string, newDateStr: string): string {
  const tIdx = iso.indexOf('T');
  return tIdx === -1 ? newDateStr : newDateStr + iso.substring(tIdx);
}

/** Parse a 'YYYY-MM-DD' string to a UTC epoch (midnight), timezone-independent. */
export function dateStrToUtc(dateStr: string): number {
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7));
  const d = Number(dateStr.slice(8, 10));
  return Date.UTC(y, m - 1, d);
}

/** Add (or subtract) whole days to a 'YYYY-MM-DD' string. */
export function addDaysToDateStr(dateStr: string, days: number): string {
  // Do the arithmetic in UTC so the returned calendar date never drifts by a day
  // in eastern-hemisphere timezones (a local parse + toISOString() would).
  const dt = new Date(dateStrToUtc(dateStr));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().substring(0, 10);
}

/** Whole-day difference between two 'YYYY-MM-DD' strings (to − from). */
export function daysBetween(fromDateStr: string, toDateStr: string): number {
  return Math.round((dateStrToUtc(toDateStr) - dateStrToUtc(fromDateStr)) / 86_400_000);
}

/**
 * Map a task to a FullCalendar all-day input per the configured date basis, or
 * null when the task lacks the anchor date(s). CANCELLED tasks are dropped.
 */
export function taskToFcEvent(task: Task, color: string, basis: CalendarTaskDate): EventInput | null {
  if (task.data.status === 'CANCELLED') return null;
  const { dtstart, due } = task.data;

  let start: string;
  let end: string | undefined;
  if (basis === 'due') {
    if (!due) return null;
    start = dateOnly(due);
  } else if (basis === 'dtstart') {
    if (!dtstart) return null;
    start = dateOnly(dtstart);
  } else {
    // span: bar from start to due when both present; single marker otherwise
    if (dtstart && due) {
      start = dateOnly(dtstart);
      end = addDaysToDateStr(dateOnly(due), 1); // FC all-day end is exclusive
    } else if (dtstart) {
      start = dateOnly(dtstart);
    } else if (due) {
      start = dateOnly(due);
    } else {
      return null;
    }
  }

  return {
    id: `task::${task.data.uid}`,
    title: task.data.summary || '(No title)',
    start,
    end,
    allDay: true,
    backgroundColor: color,
    borderColor: color,
    textColor: '#ffffff',
    durationEditable: false, // no resize for tasks in v1
    extendedProps: { componentType: 'task', task },
  };
}

/** Map a journal (dated VJOURNAL) to a FullCalendar all-day input, or null if undated. */
export function journalToFcEvent(journal: Note, color: string): EventInput | null {
  if (!journal.data.dtstart) return null;
  return {
    id: `journal::${journal.uid}`,
    title: journal.data.summary || '(Untitled)',
    start: dateOnly(journal.data.dtstart),
    allDay: true,
    backgroundColor: color,
    borderColor: color,
    textColor: '#ffffff',
    durationEditable: false,
    extendedProps: { componentType: 'journal', journal },
  };
}

/**
 * Compute the new task fields after dragging its tile to `newStart` ('YYYY-MM-DD'),
 * per the configured date basis. Returns null when a span task has no anchor date
 * (the caller should revert the drag). Never mutates the input; time-of-day on any
 * datetime value is preserved.
 */
export function computeTaskDrop(
  data: TaskJson,
  basis: CalendarTaskDate,
  newStart: string,
): TaskJson | null {
  const next: TaskJson = { ...data };
  if (basis === 'due') {
    next.due = applyNewDate(data.due ?? newStart, newStart);
  } else if (basis === 'dtstart') {
    next.dtstart = applyNewDate(data.dtstart ?? newStart, newStart);
  } else {
    // span: shift both dates by the delta applied to the dragged anchor.
    const anchor = data.dtstart ?? data.due;
    if (!anchor) return null;
    const delta = daysBetween(dateOnly(anchor), newStart);
    if (data.dtstart) next.dtstart = applyNewDate(data.dtstart, addDaysToDateStr(dateOnly(data.dtstart), delta));
    if (data.due) next.due = applyNewDate(data.due, addDaysToDateStr(dateOnly(data.due), delta));
  }
  return next;
}

/** Compute the new journal fields after dragging its tile to `newStart`. */
export function computeJournalDrop(data: NoteJson, newStart: string): NoteJson {
  if (!data.dtstart) return data;
  return { ...data, dtstart: applyNewDate(data.dtstart, newStart) };
}
