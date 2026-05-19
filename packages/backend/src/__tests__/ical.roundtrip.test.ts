import { describe, it, expect } from 'vitest';
import { parseIcalEvents, serializeIcalEvent } from '../lib/ical.js';
import type { EventJson } from '@dave/shared';

const CAL_ID = 'cal-rt';

function roundtrip(e: EventJson): EventJson {
  const ics = serializeIcalEvent(e);
  const events = parseIcalEvents(ics, CAL_ID);
  if (!events.length) throw new Error('Round-trip produced no events');
  return events[0]!;
}

describe('iCal round-trip', () => {
  it('preserves summary, description, location for a UTC event', () => {
    const original: EventJson = {
      uid: 'rt-1',
      summary: 'All Hands',
      description: 'Monthly sync',
      location: 'Main Hall',
      start: '2024-03-01T14:00:00.000Z',
      end: '2024-03-01T15:00:00.000Z',
      allDay: false,
      tzid: null,
      recurrenceRule: null,
      recurrenceId: null,
      alarms: [],
      attendees: [],
      calendarId: CAL_ID,
      color: null,
    };
    const rt = roundtrip(original);
    expect(rt.summary).toBe('All Hands');
    expect(rt.description).toBe('Monthly sync');
    expect(rt.location).toBe('Main Hall');
    expect(rt.allDay).toBe(false);
    expect(rt.tzid).toBeNull();
  });

  it('preserves all-day event without timezone drift', () => {
    const original: EventJson = {
      uid: 'rt-allday',
      summary: 'Holiday',
      description: '',
      location: '',
      start: '2024-07-04',
      end: '2024-07-05',
      allDay: true,
      tzid: null,
      recurrenceRule: null,
      recurrenceId: null,
      alarms: [],
      attendees: [],
      calendarId: CAL_ID,
      color: null,
    };
    const rt = roundtrip(original);
    expect(rt.allDay).toBe(true);
    // Dates must not shift regardless of runner's timezone
    expect(rt.start).toBe('2024-07-04');
    expect(rt.end).toBe('2024-07-05');
  });

  it('preserves RRULE raw string', () => {
    const original: EventJson = {
      uid: 'rt-rrule',
      summary: 'Weekly Review',
      description: '',
      location: '',
      start: '2024-01-08T09:00:00.000Z',
      end: '2024-01-08T10:00:00.000Z',
      allDay: false,
      tzid: null,
      recurrenceRule: { freq: 'WEEKLY', raw: 'FREQ=WEEKLY;BYDAY=MO' },
      recurrenceId: null,
      alarms: [],
      attendees: [],
      calendarId: CAL_ID,
      color: null,
    };
    // No range → fallback to one event; recurrenceRule is preserved from master
    const rt = roundtrip(original);
    expect(rt.recurrenceRule?.freq).toBe('WEEKLY');
    expect(rt.recurrenceRule?.raw).toContain('FREQ=WEEKLY');
  });

  it('preserves VALARM trigger on round-trip', () => {
    const original: EventJson = {
      uid: 'rt-alarm',
      summary: 'Doctor Appointment',
      description: '',
      location: '',
      start: '2024-06-15T14:00:00.000Z',
      end: '2024-06-15T15:00:00.000Z',
      allDay: false,
      tzid: null,
      recurrenceRule: null,
      recurrenceId: null,
      alarms: [{ action: 'DISPLAY', trigger: '-PT30M', description: 'Reminder' }],
      attendees: [],
      calendarId: CAL_ID,
      color: null,
    };
    const rt = roundtrip(original);
    expect(rt.alarms).toHaveLength(1);
    expect(rt.alarms[0]!.trigger).toBe('-PT30M');
  });
});
