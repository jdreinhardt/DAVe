import { describe, it, expect } from 'vitest';
import type { Task, TaskJson, Note, NoteJson } from '@dave/shared';
import {
  dateOnly,
  applyNewDate,
  dateStrToUtc,
  addDaysToDateStr,
  daysBetween,
  taskToFcEvent,
  journalToFcEvent,
  computeTaskDrop,
  computeJournalDrop,
} from '../lib/calendarLayers';

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

function makeTask(partial: Partial<TaskJson> = {}): Task {
  return {
    uid: 'task-1',
    etag: '"etag"',
    collectionUrl: 'https://dav.test/cal/work/',
    collectionId: 'work',
    data: makeTaskData(partial),
  };
}

function makeNote(partial: Partial<NoteJson> = {}): Note {
  return {
    uid: 'journal-1',
    etag: '"etag"',
    collectionUrl: 'https://dav.test/cal/work/',
    collectionId: 'work',
    data: {
      uid: 'journal-1',
      summary: 'Journal',
      description: '',
      dtstart: '2024-01-15',
      lastModified: null,
      categories: [],
      relations: [],
      collectionUrl: 'https://dav.test/cal/work/',
      ...partial,
    },
  };
}

// ── Date primitives ─────────────────────────────────────────────────────────

describe('dateOnly', () => {
  it('takes the date portion of a date or datetime', () => {
    expect(dateOnly('2024-01-15')).toBe('2024-01-15');
    expect(dateOnly('2024-01-15T09:30:00')).toBe('2024-01-15');
    expect(dateOnly('2024-01-15T09:30:00Z')).toBe('2024-01-15');
  });
});

describe('applyNewDate', () => {
  it('swaps a date-only value wholesale', () => {
    expect(applyNewDate('2024-01-15', '2024-02-20')).toBe('2024-02-20');
  });
  it('preserves the time component of a datetime', () => {
    expect(applyNewDate('2024-01-15T09:30:00', '2024-02-20')).toBe('2024-02-20T09:30:00');
  });
  it('preserves a trailing zone designator', () => {
    expect(applyNewDate('2024-01-15T09:30:00Z', '2024-02-20')).toBe('2024-02-20T09:30:00Z');
    expect(applyNewDate('2024-01-15T09:30:00+05:00', '2024-02-20')).toBe('2024-02-20T09:30:00+05:00');
  });
});

describe('addDaysToDateStr (timezone-independent)', () => {
  it('adds within a month', () => {
    expect(addDaysToDateStr('2024-01-01', 1)).toBe('2024-01-02');
  });
  it('crosses a leap-day boundary', () => {
    expect(addDaysToDateStr('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDaysToDateStr('2024-02-29', 1)).toBe('2024-03-01');
  });
  it('crosses a year boundary', () => {
    expect(addDaysToDateStr('2024-12-31', 1)).toBe('2025-01-01');
  });
  it('is unaffected by DST transitions', () => {
    // US spring-forward (2024-03-10) and fall-back (2024-11-03)
    expect(addDaysToDateStr('2024-03-10', 1)).toBe('2024-03-11');
    expect(addDaysToDateStr('2024-11-03', 1)).toBe('2024-11-04');
  });
  it('subtracts with negative days', () => {
    expect(addDaysToDateStr('2024-01-01', -1)).toBe('2023-12-31');
  });
});

describe('daysBetween', () => {
  it('counts whole days forward and backward', () => {
    expect(daysBetween('2024-01-01', '2024-01-02')).toBe(1);
    expect(daysBetween('2024-01-05', '2024-01-01')).toBe(-4);
  });
  it('crosses month and DST boundaries correctly', () => {
    expect(daysBetween('2024-01-31', '2024-02-01')).toBe(1);
    expect(daysBetween('2024-03-09', '2024-03-11')).toBe(2); // spans US DST
  });
  it('round-trips with dateStrToUtc', () => {
    expect(dateStrToUtc('2024-01-02') - dateStrToUtc('2024-01-01')).toBe(86_400_000);
  });
});

// ── taskToFcEvent ────────────────────────────────────────────────────────────

describe('taskToFcEvent', () => {
  it('drops CANCELLED tasks', () => {
    expect(taskToFcEvent(makeTask({ status: 'CANCELLED', due: '2024-01-15' }), '#fff', 'due')).toBeNull();
  });

  describe("basis 'due'", () => {
    it('places on the due date', () => {
      const ev = taskToFcEvent(makeTask({ due: '2024-01-15' }), '#abc', 'due');
      expect(ev).toMatchObject({ id: 'task::task-1', start: '2024-01-15', allDay: true });
      expect(ev?.end).toBeUndefined();
      expect(ev?.extendedProps?.componentType).toBe('task');
    });
    it('omits a task with no due date', () => {
      expect(taskToFcEvent(makeTask({ dtstart: '2024-01-10', due: null }), '#abc', 'due')).toBeNull();
    });
  });

  describe("basis 'dtstart'", () => {
    it('places on the start date', () => {
      const ev = taskToFcEvent(makeTask({ dtstart: '2024-01-10' }), '#abc', 'dtstart');
      expect(ev?.start).toBe('2024-01-10');
    });
    it('omits a task with no start date', () => {
      expect(taskToFcEvent(makeTask({ due: '2024-01-15', dtstart: null }), '#abc', 'dtstart')).toBeNull();
    });
  });

  describe("basis 'span'", () => {
    it('spans start→due with an exclusive end (due + 1 day)', () => {
      const ev = taskToFcEvent(makeTask({ dtstart: '2024-01-10', due: '2024-01-15' }), '#abc', 'span');
      expect(ev?.start).toBe('2024-01-10');
      expect(ev?.end).toBe('2024-01-16');
    });
    it('renders a single marker when only one date is present', () => {
      expect(taskToFcEvent(makeTask({ dtstart: '2024-01-10', due: null }), '#abc', 'span'))
        .toMatchObject({ start: '2024-01-10', end: undefined });
      expect(taskToFcEvent(makeTask({ dtstart: null, due: '2024-01-15' }), '#abc', 'span'))
        .toMatchObject({ start: '2024-01-15', end: undefined });
    });
    it('omits a task with neither date', () => {
      expect(taskToFcEvent(makeTask({ dtstart: null, due: null }), '#abc', 'span')).toBeNull();
    });
  });

  it('falls back to a placeholder title', () => {
    const ev = taskToFcEvent(makeTask({ summary: '', due: '2024-01-15' }), '#abc', 'due');
    expect(ev?.title).toBe('(No title)');
  });
});

// ── journalToFcEvent ─────────────────────────────────────────────────────────

describe('journalToFcEvent', () => {
  it('places a dated journal on its DTSTART date', () => {
    const ev = journalToFcEvent(makeNote({ dtstart: '2024-01-15T08:00:00' }), '#123');
    expect(ev).toMatchObject({ id: 'journal::journal-1', start: '2024-01-15', allDay: true });
    expect(ev?.extendedProps?.componentType).toBe('journal');
  });
  it('omits an undated (note) entry', () => {
    expect(journalToFcEvent(makeNote({ dtstart: null }), '#123')).toBeNull();
  });
  it('falls back to a placeholder title', () => {
    expect(journalToFcEvent(makeNote({ summary: '' }), '#123')?.title).toBe('(Untitled)');
  });
});

// ── computeTaskDrop ──────────────────────────────────────────────────────────

describe('computeTaskDrop', () => {
  it("basis 'due' sets the due date, preserving time-of-day", () => {
    expect(computeTaskDrop(makeTaskData({ due: '2024-01-15' }), 'due', '2024-02-20')!.due).toBe('2024-02-20');
    expect(computeTaskDrop(makeTaskData({ due: '2024-01-15T14:00:00' }), 'due', '2024-02-20')!.due)
      .toBe('2024-02-20T14:00:00');
  });
  it("basis 'due' fills in a due date when none existed", () => {
    expect(computeTaskDrop(makeTaskData({ due: null }), 'due', '2024-02-20')!.due).toBe('2024-02-20');
  });
  it("basis 'dtstart' sets the start date", () => {
    expect(computeTaskDrop(makeTaskData({ dtstart: '2024-01-10' }), 'dtstart', '2024-02-20')!.dtstart)
      .toBe('2024-02-20');
  });

  it("basis 'span' shifts both dates by the same delta, preserving the gap and times", () => {
    const out = computeTaskDrop(
      makeTaskData({ dtstart: '2024-01-10T09:00:00', due: '2024-01-15T17:00:00' }),
      'span',
      '2024-01-12', // dragged the start anchor +2 days
    )!;
    expect(out.dtstart).toBe('2024-01-12T09:00:00');
    expect(out.due).toBe('2024-01-17T17:00:00');
  });
  it("basis 'span' shifts a single-date task", () => {
    expect(computeTaskDrop(makeTaskData({ dtstart: '2024-01-10', due: null }), 'span', '2024-01-14')!.dtstart)
      .toBe('2024-01-14');
  });
  it("basis 'span' returns null when the task has no anchor date", () => {
    expect(computeTaskDrop(makeTaskData({ dtstart: null, due: null }), 'span', '2024-01-14')).toBeNull();
  });

  it('does not mutate the input', () => {
    const input = makeTaskData({ due: '2024-01-15' });
    computeTaskDrop(input, 'due', '2024-02-20');
    expect(input.due).toBe('2024-01-15');
  });
});

// ── computeJournalDrop ───────────────────────────────────────────────────────

describe('computeJournalDrop', () => {
  it('moves DTSTART to the dropped day, preserving time', () => {
    expect(computeJournalDrop(makeNote({ dtstart: '2024-01-15' }).data, '2024-03-01').dtstart)
      .toBe('2024-03-01');
    expect(computeJournalDrop(makeNote({ dtstart: '2024-01-15T08:30:00' }).data, '2024-03-01').dtstart)
      .toBe('2024-03-01T08:30:00');
  });
  it('leaves an undated entry unchanged', () => {
    const data = makeNote({ dtstart: null }).data;
    expect(computeJournalDrop(data, '2024-03-01').dtstart).toBeNull();
  });
  it('does not mutate the input', () => {
    const data = makeNote({ dtstart: '2024-01-15' }).data;
    computeJournalDrop(data, '2024-03-01');
    expect(data.dtstart).toBe('2024-01-15');
  });
});
