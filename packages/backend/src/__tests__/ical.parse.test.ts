import { describe, it, expect } from 'vitest';
import { parseIcalEvents } from '../lib/ical.js';

const CAL_ID = 'cal-test';

function wrap(vevent: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//test//EN',
    vevent,
    'END:VCALENDAR',
  ].join('\r\n');
}

describe('parseIcalEvents – basics', () => {
  it('returns [] for empty string', () => {
    expect(parseIcalEvents('', CAL_ID)).toEqual([]);
  });

  it('returns [] for malformed ICS', () => {
    expect(parseIcalEvents('NOT ICS AT ALL', CAL_ID)).toEqual([]);
  });

  it('returns [] when VCALENDAR has no VEVENTs', () => {
    const ics = wrap('');
    expect(parseIcalEvents(ics, CAL_ID)).toEqual([]);
  });

  it('parses a simple UTC event', () => {
    const ics = wrap([
      'BEGIN:VEVENT',
      'UID:simple-1',
      'SUMMARY:My Event',
      'DESCRIPTION:A test event',
      'LOCATION:Conference Room A',
      'DTSTART:20240115T100000Z',
      'DTEND:20240115T110000Z',
      'END:VEVENT',
    ].join('\r\n'));

    const events = parseIcalEvents(ics, CAL_ID);
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.uid).toBe('simple-1');
    expect(e.summary).toBe('My Event');
    expect(e.description).toBe('A test event');
    expect(e.location).toBe('Conference Room A');
    expect(e.allDay).toBe(false);
    expect(e.calendarId).toBe(CAL_ID);
    expect(e.tzid).toBeNull();
    // Start should be ISO string ending in Z
    expect(e.start).toMatch(/Z$/);
  });
});

describe('parseIcalEvents – all-day events', () => {
  it('parses an all-day event', () => {
    const ics = wrap([
      'BEGIN:VEVENT',
      'UID:allday-1',
      'SUMMARY:Birthday',
      'DTSTART;VALUE=DATE:20240115',
      'DTEND;VALUE=DATE:20240116',
      'END:VEVENT',
    ].join('\r\n'));

    const events = parseIcalEvents(ics, CAL_ID);
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.allDay).toBe(true);
    expect(e.start).toBe('2024-01-15');
    expect(e.end).toBe('2024-01-16');
  });
});

describe('parseIcalEvents – zoned events', () => {
  it('captures TZID from DTSTART', () => {
    const ics = wrap([
      'BEGIN:VEVENT',
      'UID:zoned-1',
      'SUMMARY:NYC Meeting',
      'DTSTART;TZID=America/New_York:20240115T100000',
      'DTEND;TZID=America/New_York:20240115T110000',
      'END:VEVENT',
    ].join('\r\n'));

    const events = parseIcalEvents(ics, CAL_ID);
    expect(events).toHaveLength(1);
    expect(events[0]!.tzid).toBe('America/New_York');
    // Start is a UTC ISO string (converted from wall-clock NY time)
    expect(events[0]!.start).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('parseIcalEvents – VALARMs', () => {
  it('parses a DISPLAY alarm with relative trigger', () => {
    const ics = wrap([
      'BEGIN:VEVENT',
      'UID:alarm-1',
      'SUMMARY:Alarm Event',
      'DTSTART:20240115T100000Z',
      'DTEND:20240115T110000Z',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT15M',
      'DESCRIPTION:Reminder',
      'END:VALARM',
      'END:VEVENT',
    ].join('\r\n'));

    const events = parseIcalEvents(ics, CAL_ID);
    expect(events[0]!.alarms).toHaveLength(1);
    expect(events[0]!.alarms[0]!.action).toBe('DISPLAY');
    expect(events[0]!.alarms[0]!.trigger).toBe('-PT15M');
    expect(events[0]!.alarms[0]!.description).toBe('Reminder');
  });

  it('parses an EMAIL alarm', () => {
    const ics = wrap([
      'BEGIN:VEVENT',
      'UID:alarm-email-1',
      'SUMMARY:Email Alarm',
      'DTSTART:20240115T100000Z',
      'DTEND:20240115T110000Z',
      'BEGIN:VALARM',
      'ACTION:EMAIL',
      'TRIGGER:-PT30M',
      'DESCRIPTION:Emailed reminder',
      'END:VALARM',
      'END:VEVENT',
    ].join('\r\n'));

    const events = parseIcalEvents(ics, CAL_ID);
    expect(events[0]!.alarms[0]!.action).toBe('EMAIL');
    expect(events[0]!.alarms[0]!.trigger).toBe('-PT30M');
  });
});

describe('parseIcalEvents – RRULE', () => {
  it('returns one fallback instance for a recurring event without a range', () => {
    const ics = wrap([
      'BEGIN:VEVENT',
      'UID:recur-1',
      'SUMMARY:Weekly',
      'DTSTART:20240115T100000Z',
      'DTEND:20240115T110000Z',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
      'END:VEVENT',
    ].join('\r\n'));

    const events = parseIcalEvents(ics, CAL_ID);
    expect(events).toHaveLength(1);
    expect(events[0]!.recurrenceRule?.freq).toBe('WEEKLY');
    expect(events[0]!.recurrenceRule?.raw).toContain('FREQ=WEEKLY');
  });

  it('expands a daily recurring event within a range', () => {
    const ics = wrap([
      'BEGIN:VEVENT',
      'UID:daily-1',
      'SUMMARY:Daily Standup',
      'DTSTART:20240101T090000Z',
      'DTEND:20240101T093000Z',
      'RRULE:FREQ=DAILY',
      'END:VEVENT',
    ].join('\r\n'));

    const events = parseIcalEvents(
      ics, CAL_ID,
      '2024-01-01T00:00:00Z',
      '2024-01-04T00:00:00Z',
    );
    expect(events).toHaveLength(3); // Jan 1, 2, 3
  });

  it('respects COUNT when expanding', () => {
    const ics = wrap([
      'BEGIN:VEVENT',
      'UID:count-1',
      'SUMMARY:Three Times',
      'DTSTART:20240101T090000Z',
      'DTEND:20240101T100000Z',
      'RRULE:FREQ=DAILY;COUNT=3',
      'END:VEVENT',
    ].join('\r\n'));

    const events = parseIcalEvents(
      ics, CAL_ID,
      '2024-01-01T00:00:00Z',
      '2024-01-10T00:00:00Z',
    );
    expect(events).toHaveLength(3);
  });

  it('parses RRULE freq/interval/byDay', () => {
    const ics = wrap([
      'BEGIN:VEVENT',
      'UID:biweekly-1',
      'SUMMARY:Bi-weekly',
      'DTSTART:20240101T090000Z',
      'DTEND:20240101T100000Z',
      'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH',
      'END:VEVENT',
    ].join('\r\n'));

    const events = parseIcalEvents(ics, CAL_ID);
    expect(events[0]!.recurrenceRule?.freq).toBe('WEEKLY');
    expect(events[0]!.recurrenceRule?.interval).toBe(2);
    expect(events[0]!.recurrenceRule?.byDay).toContain('TU');
    expect(events[0]!.recurrenceRule?.byDay).toContain('TH');
  });
});

describe('parseIcalEvents – RECURRENCE-ID exceptions', () => {
  it('exception instance overrides master summary for that occurrence', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//test//EN',
      // Master
      'BEGIN:VEVENT',
      'UID:master-exc-1',
      'SUMMARY:Regular Meeting',
      'DTSTART:20240101T090000Z',
      'DTEND:20240101T100000Z',
      'RRULE:FREQ=WEEKLY',
      'END:VEVENT',
      // Exception for Jan 8
      'BEGIN:VEVENT',
      'UID:master-exc-1',
      'SUMMARY:Special Meeting',
      'RECURRENCE-ID:20240108T090000Z',
      'DTSTART:20240108T100000Z',
      'DTEND:20240108T110000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const events = parseIcalEvents(
      ics, CAL_ID,
      '2024-01-01T00:00:00Z',
      '2024-01-15T00:00:00Z',
    );
    const jan8 = events.find((e) => e.start.startsWith('2024-01-08'));
    expect(jan8?.summary).toBe('Special Meeting');
    const jan1 = events.find((e) => e.start.startsWith('2024-01-01'));
    expect(jan1?.summary).toBe('Regular Meeting');
  });
});

describe('parseIcalEvents – attendees', () => {
  it('parses ATTENDEE with CN and PARTSTAT', () => {
    const ics = wrap([
      'BEGIN:VEVENT',
      'UID:attendee-1',
      'SUMMARY:Team Call',
      'DTSTART:20240115T100000Z',
      'DTEND:20240115T110000Z',
      'ATTENDEE;CN=Alice;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:alice@example.com',
      'END:VEVENT',
    ].join('\r\n'));

    const events = parseIcalEvents(ics, CAL_ID);
    expect(events[0]!.attendees).toHaveLength(1);
    const att = events[0]!.attendees[0]!;
    expect(att.email).toBe('alice@example.com');
    expect(att.name).toBe('Alice');
    expect(att.partstat).toBe('ACCEPTED');
  });
});
