import { describe, it, expect } from 'vitest';
import { serializeIcalEvent } from '../lib/ical.js';
import type { EventJson } from '@dave/shared';

function baseEvent(): EventJson {
  return {
    uid: 'test-uid-1',
    summary: 'Test Event',
    description: '',
    location: '',
    start: '2024-01-15T10:00:00.000Z',
    end: '2024-01-15T11:00:00.000Z',
    allDay: false,
    tzid: null,
    recurrenceRule: null,
    recurrenceId: null,
    alarms: [],
    attendees: [],
    calendarId: 'cal-1',
    color: null,
  };
}

describe('serializeIcalEvent – structure', () => {
  it('wraps output in VCALENDAR', () => {
    const out = serializeIcalEvent(baseEvent());
    expect(out).toContain('BEGIN:VCALENDAR');
    expect(out).toContain('END:VCALENDAR');
  });

  it('wraps output in VEVENT', () => {
    const out = serializeIcalEvent(baseEvent());
    expect(out).toContain('BEGIN:VEVENT');
    expect(out).toContain('END:VEVENT');
  });

  it('includes PRODID', () => {
    expect(serializeIcalEvent(baseEvent())).toContain('PRODID:-//dave//EN');
  });

  it('includes DTSTAMP (parseable ISO date)', () => {
    const out = serializeIcalEvent(baseEvent());
    const match = out.match(/DTSTAMP:(\d{8}T\d{6}Z)/);
    expect(match).toBeTruthy();
    expect(new Date(match![1]!.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')).getTime()).not.toBeNaN();
  });
});

describe('serializeIcalEvent – DTSTART formats', () => {
  it('UTC event emits DTSTART without TZID', () => {
    const out = serializeIcalEvent(baseEvent());
    expect(out).toContain('DTSTART:');
    // Should NOT have TZID parameter
    expect(out).not.toContain('DTSTART;TZID');
  });

  it('all-day event emits DTSTART;VALUE=DATE', () => {
    const e = baseEvent();
    e.allDay = true;
    e.start = '2024-01-15';
    e.end = '2024-01-16';
    const out = serializeIcalEvent(e);
    expect(out).toContain('DTSTART;VALUE=DATE:20240115');
    expect(out).toContain('DTEND;VALUE=DATE:20240116');
  });

  it('zoned event emits DTSTART;TZID=... and a VTIMEZONE block', () => {
    const e = baseEvent();
    e.tzid = 'America/New_York';
    e.start = '2024-01-15T15:00:00.000Z'; // 10:00 NY time in Jan
    e.end = '2024-01-15T16:00:00.000Z';
    const out = serializeIcalEvent(e);
    expect(out).toContain('DTSTART;TZID=America/New_York:');
    expect(out).toContain('BEGIN:VTIMEZONE');
    expect(out).toContain('TZID:America/New_York');
  });
});

describe('serializeIcalEvent – UID', () => {
  it('uses provided uid', () => {
    const e = baseEvent();
    e.uid = 'my-custom-uid';
    expect(serializeIcalEvent(e)).toContain('UID:my-custom-uid');
  });

  it('auto-generates UID when empty', () => {
    const e = baseEvent();
    e.uid = '';
    const out = serializeIcalEvent(e);
    const match = out.match(/UID:(.+)/);
    expect(match).toBeTruthy();
    expect(match![1]!.trim()).not.toBe('');
  });
});

describe('serializeIcalEvent – RRULE', () => {
  it('includes RRULE when recurrenceRule.raw is set', () => {
    const e = baseEvent();
    e.recurrenceRule = { freq: 'WEEKLY', raw: 'FREQ=WEEKLY;BYDAY=MO,WE' };
    expect(serializeIcalEvent(e)).toContain('RRULE:');
  });

  it('omits RRULE when recurrenceRule is null', () => {
    expect(serializeIcalEvent(baseEvent())).not.toContain('RRULE:');
  });
});

describe('serializeIcalEvent – RECURRENCE-ID', () => {
  it('emits RECURRENCE-ID for exception instances', () => {
    const e = baseEvent();
    e.recurrenceId = '2024-01-22T10:00:00.000Z';
    const out = serializeIcalEvent(e);
    expect(out).toContain('RECURRENCE-ID:');
  });

  it('does not emit RECURRENCE-ID when null', () => {
    expect(serializeIcalEvent(baseEvent())).not.toContain('RECURRENCE-ID:');
  });
});

describe('serializeIcalEvent – VALARMs', () => {
  it('includes VALARM for each alarm', () => {
    const e = baseEvent();
    e.alarms = [
      { action: 'DISPLAY', trigger: '-PT15M', description: 'Reminder' },
      { action: 'EMAIL', trigger: '-PT60M', description: 'Email Reminder' },
    ];
    const out = serializeIcalEvent(e);
    expect(out.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect(out).toContain('ACTION:DISPLAY');
    expect(out).toContain('ACTION:EMAIL');
  });
});
