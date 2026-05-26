import { describe, it, expect } from 'vitest';
import { computeNextOccurrence, rollForwardTask } from '../lib/ical.js';
import type { TaskJson } from '@dave/shared';

function makeIcs(lines: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//test//EN',
    'BEGIN:VTODO',
    ...lines,
    'END:VTODO',
    'END:VCALENDAR',
  ].join('\r\n');
}

function baseTask(overrides: Partial<TaskJson> = {}): TaskJson {
  return {
    uid: 'test-uid',
    summary: 'Recurring task',
    description: '',
    status: 'COMPLETED',
    priority: null,
    dtstart: '2024-01-01',
    due: null,
    completed: '2024-01-01T12:00:00.000Z',
    percentComplete: 100,
    lastModified: null,
    categories: [],
    relations: [],
    collectionUrl: 'https://baikal.example.com/cal/',
    alarms: [],
    rrule: 'FREQ=DAILY',
    ...overrides,
  };
}

// ── computeNextOccurrence ─────────────────────────────────────────────────────

describe('computeNextOccurrence', () => {
  it('returns next day for a daily task', () => {
    const ics = makeIcs([
      'UID:test-uid',
      'DTSTART;VALUE=DATE:20240101',
      'RRULE:FREQ=DAILY',
    ]);
    const result = computeNextOccurrence(ics, null, null);
    expect(result).not.toBeNull();
    expect(result!.nextDtstart).toBe('2024-01-02');
  });

  it('returns next week for a weekly task', () => {
    const ics = makeIcs([
      'UID:test-uid',
      'DTSTART;VALUE=DATE:20240101',
      'RRULE:FREQ=WEEKLY',
    ]);
    const result = computeNextOccurrence(ics, null, null);
    expect(result).not.toBeNull();
    expect(result!.nextDtstart).toBe('2024-01-08');
  });

  it('returns next month for a monthly task', () => {
    const ics = makeIcs([
      'UID:test-uid',
      'DTSTART;VALUE=DATE:20240115',
      'RRULE:FREQ=MONTHLY',
    ]);
    const result = computeNextOccurrence(ics, null, null);
    expect(result).not.toBeNull();
    expect(result!.nextDtstart).toBe('2024-02-15');
  });

  it('returns null when COUNT=1 (only one occurrence)', () => {
    const ics = makeIcs([
      'UID:test-uid',
      'DTSTART;VALUE=DATE:20240101',
      'RRULE:FREQ=DAILY;COUNT=1',
    ]);
    const result = computeNextOccurrence(ics, null, null);
    expect(result).toBeNull();
  });

  it('returns next when COUNT=2', () => {
    const ics = makeIcs([
      'UID:test-uid',
      'DTSTART;VALUE=DATE:20240101',
      'RRULE:FREQ=DAILY;COUNT=2',
    ]);
    const result = computeNextOccurrence(ics, null, null);
    expect(result).not.toBeNull();
    expect(result!.nextDtstart).toBe('2024-01-02');
  });

  it('returns null when UNTIL has already passed (is equal to DTSTART)', () => {
    // UNTIL=DTSTART means DTSTART is the only occurrence.
    const ics = makeIcs([
      'UID:test-uid',
      'DTSTART;VALUE=DATE:20240101',
      'RRULE:FREQ=DAILY;UNTIL=20240101',
    ]);
    const result = computeNextOccurrence(ics, null, null);
    expect(result).toBeNull();
  });

  it('returns next when UNTIL is in the future', () => {
    const ics = makeIcs([
      'UID:test-uid',
      'DTSTART;VALUE=DATE:20240101',
      'RRULE:FREQ=DAILY;UNTIL=20241231',
    ]);
    const result = computeNextOccurrence(ics, null, null);
    expect(result).not.toBeNull();
    expect(result!.nextDtstart).toBe('2024-01-02');
  });

  it('preserves DTSTART→DUE offset on roll-forward', () => {
    // DTSTART=Mon Jan 1, DUE=Wed Jan 3 (delta = 2 days)
    // Next DTSTART = Jan 8; next DUE should be Jan 10
    const ics = makeIcs([
      'UID:test-uid',
      'DTSTART;VALUE=DATE:20240101',
      'DUE;VALUE=DATE:20240103',
      'RRULE:FREQ=WEEKLY',
    ]);
    const result = computeNextOccurrence(ics, null, '2024-01-03');
    expect(result).not.toBeNull();
    expect(result!.nextDtstart).toBe('2024-01-08');
    expect(result!.nextDue).toBe('2024-01-10');
  });

  it('handles DUE-only task (no DTSTART)', () => {
    const ics = makeIcs([
      'UID:test-uid',
      'DUE;VALUE=DATE:20240101',
      'RRULE:FREQ=WEEKLY',
    ]);
    const result = computeNextOccurrence(ics, null, '2024-01-01');
    expect(result).not.toBeNull();
    expect(result!.nextDtstart).toBeNull();
    expect(result!.nextDue).toBe('2024-01-08');
  });

  it('returns null for DUE-only task with COUNT=1', () => {
    const ics = makeIcs([
      'UID:test-uid',
      'DUE;VALUE=DATE:20240101',
      'RRULE:FREQ=DAILY;COUNT=1',
    ]);
    const result = computeNextOccurrence(ics, null, '2024-01-01');
    expect(result).toBeNull();
  });

  it('returns null when rawIcs has no RRULE', () => {
    const ics = makeIcs([
      'UID:test-uid',
      'DTSTART;VALUE=DATE:20240101',
    ]);
    const result = computeNextOccurrence(ics, null, null);
    expect(result).toBeNull();
  });

  it('returns null for malformed ICS', () => {
    const result = computeNextOccurrence('NOT ICS', null, null);
    expect(result).toBeNull();
  });
});

// ── rollForwardTask ───────────────────────────────────────────────────────────

describe('rollForwardTask', () => {
  it('advances DTSTART and resets status on roll-forward', () => {
    const ics = makeIcs([
      'UID:test-uid',
      'DTSTART;VALUE=DATE:20240101',
      'RRULE:FREQ=DAILY',
    ]);
    const task = baseTask({ dtstart: '2024-01-01', rrule: 'FREQ=DAILY' });
    const rolled = rollForwardTask(task, ics);
    expect(rolled).not.toBeNull();
    expect(rolled!.dtstart).toBe('2024-01-02');
    expect(rolled!.status).toBe('NEEDS-ACTION');
    expect(rolled!.percentComplete).toBe(0);
    expect(rolled!.completed).toBeNull();
  });

  it('returns null for task without RRULE', () => {
    const ics = makeIcs(['UID:test-uid', 'DTSTART;VALUE=DATE:20240101']);
    const task = baseTask({ rrule: null });
    expect(rollForwardTask(task, ics)).toBeNull();
  });

  it('returns null when COUNT=1 (last occurrence)', () => {
    const ics = makeIcs([
      'UID:test-uid',
      'DTSTART;VALUE=DATE:20240101',
      'RRULE:FREQ=DAILY;COUNT=1',
    ]);
    const task = baseTask({ rrule: 'FREQ=DAILY;COUNT=1' });
    expect(rollForwardTask(task, ics)).toBeNull();
  });

  it('decrements COUNT on each roll-forward', () => {
    const ics = makeIcs([
      'UID:test-uid',
      'DTSTART;VALUE=DATE:20240101',
      'RRULE:FREQ=DAILY;COUNT=3',
    ]);
    const task = baseTask({ dtstart: '2024-01-01', rrule: 'FREQ=DAILY;COUNT=3' });
    const rolled = rollForwardTask(task, ics);
    expect(rolled).not.toBeNull();
    expect(rolled!.rrule).toBe('FREQ=DAILY;COUNT=2');
    expect(rolled!.dtstart).toBe('2024-01-02');
  });

  it('second roll-forward from COUNT=2 returns null (last occurrence)', () => {
    // Simulate the second completion: task now has DTSTART=Jan2, COUNT=2
    const ics2 = makeIcs([
      'UID:test-uid',
      'DTSTART;VALUE=DATE:20240102',
      'RRULE:FREQ=DAILY;COUNT=2',
    ]);
    const task2 = baseTask({ dtstart: '2024-01-02', rrule: 'FREQ=DAILY;COUNT=2' });
    const rolled2 = rollForwardTask(task2, ics2);
    expect(rolled2).not.toBeNull();
    expect(rolled2!.rrule).toBe('FREQ=DAILY;COUNT=1');
    expect(rolled2!.dtstart).toBe('2024-01-03');

    // Third completion: COUNT=1, no more
    const ics3 = makeIcs([
      'UID:test-uid',
      'DTSTART;VALUE=DATE:20240103',
      'RRULE:FREQ=DAILY;COUNT=1',
    ]);
    const task3 = baseTask({ dtstart: '2024-01-03', rrule: 'FREQ=DAILY;COUNT=1' });
    expect(rollForwardTask(task3, ics3)).toBeNull();
  });

  it('does not modify COUNT when UNTIL is used', () => {
    const ics = makeIcs([
      'UID:test-uid',
      'DTSTART;VALUE=DATE:20240101',
      'RRULE:FREQ=DAILY;UNTIL=20241231',
    ]);
    const task = baseTask({ dtstart: '2024-01-01', rrule: 'FREQ=DAILY;UNTIL=20241231' });
    const rolled = rollForwardTask(task, ics);
    expect(rolled).not.toBeNull();
    expect(rolled!.rrule).toBe('FREQ=DAILY;UNTIL=20241231');
  });

  it('preserves DUE offset', () => {
    const ics = makeIcs([
      'UID:test-uid',
      'DTSTART;VALUE=DATE:20240101',
      'DUE;VALUE=DATE:20240103',
      'RRULE:FREQ=WEEKLY',
    ]);
    const task = baseTask({
      dtstart: '2024-01-01',
      due: '2024-01-03',
      rrule: 'FREQ=WEEKLY',
    });
    const rolled = rollForwardTask(task, ics);
    expect(rolled).not.toBeNull();
    expect(rolled!.dtstart).toBe('2024-01-08');
    expect(rolled!.due).toBe('2024-01-10');
  });

  it('handles DST transition (spring forward) without losing a day', () => {
    // Weekly task crossing the US spring-forward (2024-03-10 in America/New_York).
    // All-day tasks should not be affected by DST at all.
    const ics = makeIcs([
      'UID:test-uid',
      'DTSTART;VALUE=DATE:20240304',
      'RRULE:FREQ=WEEKLY',
    ]);
    const task = baseTask({ dtstart: '2024-03-04', rrule: 'FREQ=WEEKLY' });
    const rolled = rollForwardTask(task, ics);
    expect(rolled).not.toBeNull();
    // Should be exactly 7 days later, not 6 or 8.
    expect(rolled!.dtstart).toBe('2024-03-11');
  });

  it('preserves all other task fields on roll-forward', () => {
    const ics = makeIcs([
      'UID:test-uid',
      'DTSTART;VALUE=DATE:20240101',
      'RRULE:FREQ=DAILY',
    ]);
    const task = baseTask({
      summary: 'Take medication',
      description: 'One pill per day',
      priority: 1,
      categories: ['health'],
      rrule: 'FREQ=DAILY',
    });
    const rolled = rollForwardTask(task, ics)!;
    expect(rolled.summary).toBe('Take medication');
    expect(rolled.description).toBe('One pill per day');
    expect(rolled.priority).toBe(1);
    expect(rolled.categories).toEqual(['health']);
    expect(rolled.rrule).toBe('FREQ=DAILY');
  });
});
