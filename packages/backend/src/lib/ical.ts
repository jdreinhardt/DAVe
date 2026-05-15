import { createRequire } from 'node:module';
import type { EventJson, AlarmJson, AttendeeJson, RecurrenceRule } from '@dave/shared';

const _req = createRequire(import.meta.url);
// ical.js ships CommonJS only with no official TypeScript types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ICAL = _req('ical.js') as any;

/**
 * Parse a raw iCalendar text (one VCALENDAR block) into normalized EventJson
 * objects. Provide rangeStart/rangeEnd (ISO strings) to expand recurring events
 * within that window; without them, recurring events fall back to one entry.
 *
 * Skips VEVENTs that fail to parse rather than throwing.
 */
export function parseIcalEvents(
  icsText: string,
  calendarId: string,
  rangeStart?: string,
  rangeEnd?: string,
): EventJson[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let jcal: any;
  try {
    jcal = ICAL.parse(icsText);
  } catch {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comp = new ICAL.Component(jcal) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vevents: any[] = comp.getAllSubcomponents('vevent');
  if (vevents.length === 0) return [];

  // Separate the master VEVENT (no RECURRENCE-ID) from exception instances.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const master: any = vevents.find((v) => !v.hasProperty('recurrence-id'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exceptions: any[] = vevents.filter((v) => v.hasProperty('recurrence-id'));

  if (!master) {
    // Unusual: only exception instances, no master — return them as-is.
    return exceptions.flatMap((v) => { try { return [parseVEvent(v, calendarId)]; } catch { return []; } });
  }

  const masterEvent = new ICAL.Event(master);

  // Attach exception instances so getOccurrenceDetails returns the right data.
  for (const exc of exceptions) {
    try { masterEvent.relateException(new ICAL.Event(exc)); } catch { /* skip malformed */ }
  }

  if (!masterEvent.isRecurring()) {
    try { return [parseVEvent(master, calendarId)]; } catch { return []; }
  }

  // Recurring event: expand instances within the requested range.
  if (!rangeStart || !rangeEnd) {
    // No range — return just the base instance as a fallback.
    try { return [parseVEvent(master, calendarId)]; } catch { return []; }
  }

  return expandRecurring(masterEvent, master, calendarId, rangeStart, rangeEnd);
}

// ── Recurrence expansion ─────────────────────────────────────────────────────

function expandRecurring(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  masterEvent: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  masterVevent: any,
  calendarId: string,
  rangeStartStr: string,
  rangeEndStr: string,
): EventJson[] {
  const rangeStart = ICAL.Time.fromJSDate(new Date(rangeStartStr), true);
  const rangeEnd = ICAL.Time.fromJSDate(new Date(rangeEndStr), true);

  const expand = new ICAL.RecurExpansion({
    component: masterVevent,
    dtstart: masterEvent.startDate,
  });

  const results: EventJson[] = [];
  const MAX_INSTANCES = 500; // guard against runaway FREQ=SECONDLY etc.

  for (let i = 0; i < MAX_INSTANCES; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nextTime: any = expand.next();
    if (!nextTime) break;
    if (nextTime.compare(rangeEnd) >= 0) break;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let occDetails: any;
    try {
      occDetails = masterEvent.getOccurrenceDetails(nextTime);
    } catch {
      continue;
    }

    // Skip occurrences that end before the range starts.
    const occEnd = occDetails.endDate ?? nextTime;
    if (occEnd.compare(rangeStart) <= 0) continue;

    try {
      results.push(occurrenceToEventJson(occDetails, masterVevent, calendarId));
    } catch {
      // skip individual bad occurrences
    }
  }

  return results;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function occurrenceToEventJson(occDetails: any, masterVevent: any, calendarId: string): EventJson {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const item: any = occDetails.item; // ICAL.Event — exception instance or master
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vevent: any = item?.component ?? masterVevent;
  const startDate = occDetails.startDate;
  const endDate = occDetails.endDate ?? startDate;

  const dtstart = masterVevent.getFirstProperty('dtstart');
  const tzid: string | null = dtstart?.getParameter('tzid') ?? null;
  const allDay: boolean = startDate?.isDate ?? false;

  const start = allDay ? icaltimeToDateString(startDate) : startDate.toJSDate().toISOString();
  const end = allDay ? icaltimeToDateString(endDate) : endDate.toJSDate().toISOString();

  const rid = occDetails.recurrenceId;
  const recurrenceId = rid
    ? (allDay ? icaltimeToDateString(rid) : rid.toJSDate().toISOString())
    : null;

  const colorVal = vevent.getFirstPropertyValue('color') ?? null;

  return {
    uid: String(item?.uid ?? ''),
    summary: String(item?.summary ?? ''),
    description: String(item?.description ?? ''),
    location: String(item?.location ?? ''),
    start,
    end,
    allDay,
    tzid,
    recurrenceRule: parseRRule(masterVevent),
    recurrenceId,
    alarms: parseAlarms(vevent),
    attendees: parseAttendees(vevent),
    calendarId,
    color: typeof colorVal === 'string' ? colorVal : null,
  };
}

// ── Single VEVENT parsing (non-recurring) ─────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseVEvent(vevent: any, calendarId: string): EventJson {
  const event = new ICAL.Event(vevent);

  const dtstart = vevent.getFirstProperty('dtstart');
  const tzid: string | null = dtstart?.getParameter('tzid') ?? null;
  const allDay: boolean = event.startDate?.isDate ?? false;

  let start: string;
  let end: string;

  if (allDay) {
    start = icaltimeToDateString(event.startDate);
    end = icaltimeToDateString(event.endDate ?? event.startDate);
  } else {
    start = event.startDate.toJSDate().toISOString();
    end = (event.endDate ?? event.startDate).toJSDate().toISOString();
  }

  const rawRecurrenceId = vevent.getFirstPropertyValue('recurrence-id');
  const recurrenceId = rawRecurrenceId != null ? String(rawRecurrenceId) : null;

  const colorVal = vevent.getFirstPropertyValue('color') ?? null;

  return {
    uid: String(event.uid ?? ''),
    summary: String(event.summary ?? ''),
    description: String(event.description ?? ''),
    location: String(event.location ?? ''),
    start,
    end,
    allDay,
    tzid,
    recurrenceRule: parseRRule(vevent),
    recurrenceId,
    alarms: parseAlarms(vevent),
    attendees: parseAttendees(vevent),
    calendarId,
    color: typeof colorVal === 'string' ? colorVal : null,
  };
}

// ── Shared helpers ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function icaltimeToDateString(t: any): string {
  // ICAL.Time.toString() for a date-type value yields "YYYY-MM-DD".
  return String(t.toString()).substring(0, 10);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseAlarms(vevent: any): AlarmJson[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const valarms: any[] = vevent.getAllSubcomponents('valarm');
  return valarms.flatMap((valarm) => {
    try {
      const rawAction = String(valarm.getFirstPropertyValue('action') ?? 'DISPLAY').toUpperCase();
      const action: 'DISPLAY' | 'EMAIL' = rawAction === 'EMAIL' ? 'EMAIL' : 'DISPLAY';

      const triggerProp = valarm.getFirstProperty('trigger');
      const triggerVal = triggerProp?.getFirstValue();
      let trigger = '';
      if (triggerVal != null && typeof triggerVal.toICALString === 'function') {
        trigger = String(triggerVal.toICALString());
      } else if (triggerVal != null) {
        trigger = String(triggerVal);
      }

      const description = String(valarm.getFirstPropertyValue('description') ?? '');
      return [{ action, trigger, description }];
    } catch {
      return [];
    }
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseAttendees(vevent: any): AttendeeJson[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any[] = vevent.getAllProperties('attendee');
  return props.flatMap((prop) => {
    try {
      const raw = String(prop.getFirstValue() ?? '');
      const email = raw.startsWith('mailto:') ? raw.slice(7) : raw;
      if (!email) return [];
      const name = String(prop.getParameter('cn') ?? '');
      const partstat = String(prop.getParameter('partstat') ?? 'NEEDS-ACTION').toUpperCase();
      const role = String(prop.getParameter('role') ?? 'REQ-PARTICIPANT').toUpperCase();
      return [{ email, name, partstat, role }];
    } catch {
      return [];
    }
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseRRule(vevent: any): RecurrenceRule | null {
  const rruleProp = vevent.getFirstProperty('rrule');
  if (!rruleProp) return null;

  try {
    const rruleVal = rruleProp.getFirstValue();
    const raw: string = String(rruleVal?.toString?.() ?? '');
    const freq = String(rruleVal?.freq ?? '').toUpperCase();

    if (!(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const).includes(freq as RecurrenceRule['freq'])) {
      return null;
    }

    const until = rruleVal?.until;
    const untilStr: string | undefined = until != null
      ? (until.toJSDate?.() ?? new Date(String(until))).toISOString().substring(0, 10)
      : undefined;

    const parts = rruleVal?.parts ?? {};
    const byDay: string[] | undefined = Array.isArray(parts['BYDAY']) ? parts['BYDAY'] : undefined;
    const byMonthDay: number[] | undefined = Array.isArray(parts['BYMONTHDAY'])
      ? (parts['BYMONTHDAY'] as unknown[]).map(Number)
      : undefined;
    const byMonth: number[] | undefined = Array.isArray(parts['BYMONTH'])
      ? (parts['BYMONTH'] as unknown[]).map(Number)
      : undefined;

    return {
      freq: freq as RecurrenceRule['freq'],
      interval: typeof rruleVal?.interval === 'number' && rruleVal.interval > 1
        ? rruleVal.interval
        : undefined,
      count: typeof rruleVal?.count === 'number' ? rruleVal.count : undefined,
      until: untilStr,
      byDay,
      byMonthDay,
      byMonth,
      raw,
    };
  } catch {
    return null;
  }
}
