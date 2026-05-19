import { describe, it, expect } from 'vitest';
import { addExdate, injectException, truncateRrule, updateMasterVevent } from '../lib/ical.js';
import { parseIcalEvents } from '../lib/ical.js';
import type { EventJson } from '@dave/shared';

const CAL_ID = 'cal-mut';

/** Build a minimal recurring ICS string */
function recurringIcs(extra = ''): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//test//EN',
    'BEGIN:VEVENT',
    'UID:master-1',
    'SUMMARY:Daily Standup',
    'DTSTART:20240101T090000Z',
    'DTEND:20240101T093000Z',
    'RRULE:FREQ=DAILY',
    extra,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

// ── addExdate ─────────────────────────────────────────────────────────────────

describe('addExdate', () => {
  it('adds an EXDATE to the master VEVENT (timed)', () => {
    const result = addExdate(recurringIcs(), '2024-01-03T09:00:00.000Z', false);
    expect(result).toContain('EXDATE');
    // The excluded date should no longer appear when expanding
    const events = parseIcalEvents(
      result, CAL_ID,
      '2024-01-01T00:00:00Z',
      '2024-01-05T00:00:00Z',
    );
    const jan3 = events.find((e) => e.start.startsWith('2024-01-03'));
    expect(jan3).toBeUndefined();
    // Other dates should still be there
    expect(events.find((e) => e.start.startsWith('2024-01-01'))).toBeDefined();
    expect(events.find((e) => e.start.startsWith('2024-01-02'))).toBeDefined();
  });

  it('adds an EXDATE for an all-day occurrence', () => {
    const allDayIcs = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//test//EN',
      'BEGIN:VEVENT',
      'UID:allday-recur',
      'SUMMARY:Daily All-Day',
      'DTSTART;VALUE=DATE:20240101',
      'DTEND;VALUE=DATE:20240102',
      'RRULE:FREQ=DAILY',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const result = addExdate(allDayIcs, '2024-01-03', true);
    expect(result).toContain('EXDATE');
  });

  it('returns original string unchanged when ICS is malformed', () => {
    const bad = 'NOT VALID ICS';
    expect(addExdate(bad, '2024-01-01T00:00:00Z', false)).toBe(bad);
  });

  it('multiple calls add multiple EXDATEs', () => {
    let ics = recurringIcs();
    ics = addExdate(ics, '2024-01-03T09:00:00.000Z', false);
    ics = addExdate(ics, '2024-01-05T09:00:00.000Z', false);
    expect((ics.match(/EXDATE/g) ?? []).length).toBe(2);
  });
});

// ── injectException ───────────────────────────────────────────────────────────

describe('injectException', () => {
  const exception: EventJson = {
    uid: 'master-1',
    summary: 'Special Standup',
    description: '',
    location: '',
    start: '2024-01-03T10:00:00.000Z',
    end: '2024-01-03T10:30:00.000Z',
    allDay: false,
    tzid: null,
    recurrenceRule: null,
    recurrenceId: '2024-01-03T09:00:00.000Z',
    alarms: [],
    attendees: [],
    calendarId: CAL_ID,
    color: null,
  };

  it('injects a RECURRENCE-ID VEVENT into the calendar', () => {
    const result = injectException(recurringIcs(), exception);
    expect(result).toContain('RECURRENCE-ID:');
    expect(result).toContain('Special Standup');
    // Should now have 2 VEVENTs (master + exception)
    expect((result.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
  });

  it('replaces an existing exception with the same RECURRENCE-ID', () => {
    const first = injectException(recurringIcs(), exception);
    const updated = injectException(first, { ...exception, summary: 'Updated Standup' });
    // Still only 2 VEVENTs (not 3)
    expect((updated.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
    expect(updated).toContain('Updated Standup');
    expect(updated).not.toContain('Special Standup');
  });

  it('returns original string unchanged when recurrenceId is null', () => {
    const ics = recurringIcs();
    const result = injectException(ics, { ...exception, recurrenceId: null });
    expect(result).toBe(ics);
  });
});

// ── truncateRrule ─────────────────────────────────────────────────────────────

describe('truncateRrule', () => {
  it('adds UNTIL to the RRULE (timed)', () => {
    const result = truncateRrule(recurringIcs(), '2024-01-04T09:00:00.000Z', false);
    expect(result).toContain('UNTIL=');
    // No occurrences on or after Jan 4
    const events = parseIcalEvents(
      result, CAL_ID,
      '2024-01-01T00:00:00Z',
      '2024-01-10T00:00:00Z',
    );
    expect(events.every((e) => !e.start.startsWith('2024-01-04'))).toBe(true);
    expect(events.every((e) => !e.start.startsWith('2024-01-05'))).toBe(true);
    // Jan 1-3 should be present
    expect(events.some((e) => e.start.startsWith('2024-01-01'))).toBe(true);
    expect(events.some((e) => e.start.startsWith('2024-01-03'))).toBe(true);
  });

  it('strips existing COUNT when adding UNTIL', () => {
    const withCount = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//test//EN',
      'BEGIN:VEVENT',
      'UID:count-recur',
      'SUMMARY:Daily',
      'DTSTART:20240101T090000Z',
      'DTEND:20240101T093000Z',
      'RRULE:FREQ=DAILY;COUNT=10',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const result = truncateRrule(withCount, '2024-01-04T09:00:00.000Z', false);
    expect(result).not.toContain('COUNT=');
    expect(result).toContain('UNTIL=');
  });

  it('drops exception VEVENTs at or after the cut point', () => {
    // Start with recurring event + an exception AFTER the cut
    const withException = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//test//EN',
      'BEGIN:VEVENT',
      'UID:trunc-master',
      'SUMMARY:Daily',
      'DTSTART:20240101T090000Z',
      'DTEND:20240101T093000Z',
      'RRULE:FREQ=DAILY',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:trunc-master',
      'SUMMARY:Exception after cut',
      'RECURRENCE-ID:20240106T090000Z',
      'DTSTART:20240106T100000Z',
      'DTEND:20240106T110000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const result = truncateRrule(withException, '2024-01-04T09:00:00.000Z', false);
    // The Jan 6 exception should be gone
    expect(result).not.toContain('Exception after cut');
    // Master should still be present
    expect(result).toContain('BEGIN:VEVENT');
  });

  it('returns original string when ICS is malformed', () => {
    const bad = 'GARBAGE';
    expect(truncateRrule(bad, '2024-01-04T09:00:00Z', false)).toBe(bad);
  });
});

// ── updateMasterVevent ────────────────────────────────────────────────────────

describe('updateMasterVevent', () => {
  it('updates summary and preserves original DTSTART', () => {
    const event: EventJson = {
      uid: 'master-1',
      summary: 'Renamed Standup',
      description: 'New description',
      location: '',
      // This is the OCCURRENCE date, not the master start — updateMasterVevent should anchor to master's DTSTART
      start: '2024-01-03T09:00:00.000Z',
      end: '2024-01-03T09:30:00.000Z',
      allDay: false,
      tzid: null,
      recurrenceRule: { freq: 'DAILY', raw: 'FREQ=DAILY' },
      recurrenceId: null,
      alarms: [],
      attendees: [],
      calendarId: CAL_ID,
      color: null,
    };

    const result = updateMasterVevent(recurringIcs(), event);
    expect(result).toContain('Renamed Standup');
    // DTSTART should be anchored to the original Jan 1 date
    expect(result).toContain('DTSTART:20240101T090000Z');
  });

  it('clears exception VEVENTs when RRULE changes', () => {
    const withException = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//test//EN',
      'BEGIN:VEVENT',
      'UID:master-1',
      'SUMMARY:Daily',
      'DTSTART:20240101T090000Z',
      'DTEND:20240101T093000Z',
      'RRULE:FREQ=DAILY',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:master-1',
      'SUMMARY:Exception',
      'RECURRENCE-ID:20240103T090000Z',
      'DTSTART:20240103T100000Z',
      'DTEND:20240103T110000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const event: EventJson = {
      uid: 'master-1',
      summary: 'Weekly Now',
      description: '',
      location: '',
      start: '2024-01-01T09:00:00.000Z',
      end: '2024-01-01T09:30:00.000Z',
      allDay: false,
      tzid: null,
      recurrenceRule: { freq: 'WEEKLY', raw: 'FREQ=WEEKLY' }, // changed from DAILY
      recurrenceId: null,
      alarms: [],
      attendees: [],
      calendarId: CAL_ID,
      color: null,
    };

    const result = updateMasterVevent(withException, event);
    // Exception should be dropped since RRULE changed
    expect(result).not.toContain('Exception');
    expect(result).toContain('RRULE:FREQ=WEEKLY');
  });
});
