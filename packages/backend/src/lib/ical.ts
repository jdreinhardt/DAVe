import { createRequire } from 'node:module';
import type { EventJson, AlarmJson, AttendeeJson, RecurrenceRule } from '@dave/shared';
// crypto is available as a global in Node 19+; the import keeps older Node happy.
import { randomUUID } from 'node:crypto';

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

// ── Serialization ─────────────────────────────────────────────────────────────

/**
 * Serialize an EventJson into a VCALENDAR iCalendar string suitable for PUT to
 * a CalDAV server. Only handles non-recurring events (RRULE serialization is
 * deferred to Milestone 7). Unknown properties from the original ICS are not
 * preserved here because EventJson is a normalized representation; round-trip
 * fidelity for exotic properties requires storing the raw ICS, which is M7+.
 */
export function serializeIcalEvent(event: EventJson): string {
  const vcal = new ICAL.Component(['vcalendar', [], []]);
  vcal.addPropertyWithValue('version', '2.0');
  vcal.addPropertyWithValue('prodid', '-//dave//EN');
  vcal.addPropertyWithValue('calscale', 'GREGORIAN');

  // VTIMEZONE with the correct UTC offset for this timezone at the event's reference
  // time. This is a simplified single-component block (no DST transitions), but it
  // gives ical.js enough information to convert DTSTART back to UTC correctly.
  if (event.tzid && !event.allDay) {
    const vtz = new ICAL.Component('vtimezone');
    vtz.addPropertyWithValue('tzid', event.tzid);
    const std = new ICAL.Component('standard');
    std.addPropertyWithValue('dtstart', ICAL.Time.fromDateTimeString('1970-01-01T00:00:00'));
    const offsetStr = utcOffsetString(event.start, event.tzid);
    std.addPropertyWithValue('tzoffsetfrom', offsetStr);
    std.addPropertyWithValue('tzoffsetto', offsetStr);
    vtz.addSubcomponent(std);
    vcal.addSubcomponent(vtz);
  }

  const vevent = new ICAL.Component('vevent');

  // UID
  const uid = event.uid || randomUUID();
  vevent.addPropertyWithValue('uid', uid);

  // DTSTAMP (required by RFC 5545)
  const dtstamp = ICAL.Time.fromJSDate(new Date(), true);
  vevent.addPropertyWithValue('dtstamp', dtstamp);

  // DTSTART / DTEND
  if (event.allDay) {
    // DATE value type; event.end is the exclusive date (day after last day).
    const startProp = new ICAL.Property('dtstart');
    startProp.resetType('date');
    startProp.setValue(ICAL.Time.fromDateString(event.start.substring(0, 10)));
    vevent.addProperty(startProp);

    const endDateStr = event.end ? event.end.substring(0, 10) : event.start.substring(0, 10);
    const endProp = new ICAL.Property('dtend');
    endProp.resetType('date');
    endProp.setValue(ICAL.Time.fromDateString(endDateStr));
    vevent.addProperty(endProp);
  } else if (event.tzid) {
    // Zoned time: convert the stored UTC (or wall-clock) value to wall-clock in
    // the target timezone using Intl, then emit with TZID parameter.
    const startLocal = toIcalLocalString(event.start, event.tzid);
    const startProp = new ICAL.Property('dtstart');
    startProp.resetType('date-time');
    startProp.setParameter('tzid', event.tzid);
    startProp.setValue(ICAL.Time.fromDateTimeString(startLocal));
    vevent.addProperty(startProp);

    const endLocal = toIcalLocalString(event.end || event.start, event.tzid);
    const endProp = new ICAL.Property('dtend');
    endProp.resetType('date-time');
    endProp.setParameter('tzid', event.tzid);
    endProp.setValue(ICAL.Time.fromDateTimeString(endLocal));
    vevent.addProperty(endProp);
  } else {
    // No timezone — emit as UTC.
    vevent.addPropertyWithValue('dtstart', ICAL.Time.fromJSDate(new Date(event.start), true));
    vevent.addPropertyWithValue('dtend', ICAL.Time.fromJSDate(new Date(event.end || event.start), true));
  }

  // Text properties
  if (event.summary) vevent.addPropertyWithValue('summary', event.summary);
  if (event.description) vevent.addPropertyWithValue('description', event.description);
  if (event.location) vevent.addPropertyWithValue('location', event.location);

  // VALARMs
  for (const alarm of event.alarms) {
    serializeAlarm(vevent, alarm, event.summary);
  }

  vcal.addSubcomponent(vevent);
  return vcal.toString();
}

/**
 * Return the UTC offset for a given IANA timezone at the instant described by
 * isoStr, as a ±HHMM string suitable for VTIMEZONE TZOFFSETFROM/TZOFFSETTO.
 * Uses Intl so no tz database is needed.
 */
function utcOffsetString(isoStr: string, tzid: string): string {
  const isUtcOrOffset = /Z$/.test(isoStr) || /[+-]\d{2}:\d{2}$/.test(isoStr);
  const date = isUtcOrOffset ? new Date(isoStr) : new Date(isoStr + 'Z');

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tzid,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;
  const h = p.hour === '24' ? '00' : p.hour;
  const localAsUtc = new Date(`${p.year}-${p.month}-${p.day}T${h}:${p.minute}:${p.second}Z`);

  const offsetMs = localAsUtc.getTime() - date.getTime();
  const offsetMin = Math.round(offsetMs / 60_000);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const hh = Math.floor(abs / 60).toString().padStart(2, '0');
  const mm = (abs % 60).toString().padStart(2, '0');
  return `${sign}${hh}${mm}`;
}

/**
 * Convert a UTC ISO string or wall-clock string to "YYYY-MM-DDTHH:MM:SS" local
 * wall-clock time in the given IANA timezone using Intl, so ical.js can emit
 * DTSTART;TZID=…:YYYYMMDDTHHMMSS without bundling timezone data.
 */
function toIcalLocalString(isoStr: string, tzid: string): string {
  // If the input has no timezone indicator, treat as already wall-clock.
  const isUtcOrOffset = /Z$/.test(isoStr) || /[+-]\d{2}:\d{2}$/.test(isoStr);
  const date = isUtcOrOffset ? new Date(isoStr) : new Date(isoStr + 'Z');

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tzid,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;
  const h = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day}T${h}:${p.minute}:${p.second}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeAlarm(vevent: any, alarm: AlarmJson, eventSummary: string): void {
  const valarm = new ICAL.Component('valarm');
  valarm.addPropertyWithValue('action', alarm.action);

  const triggerProp = new ICAL.Property('trigger');
  const raw = alarm.trigger;

  if (/^-?P/.test(raw)) {
    // ISO 8601 duration (relative trigger)
    const dur = ICAL.Duration.fromString(raw);
    triggerProp.resetType('duration');
    // RELATED=START is required for relative triggers per RFC 5545 §3.8.6.3
    triggerProp.setParameter('related', 'START');
    triggerProp.setValue(dur);
  } else {
    // Absolute datetime trigger
    try {
      const absTime = ICAL.Time.fromJSDate(new Date(raw), true);
      triggerProp.resetType('date-time');
      triggerProp.setParameter('value', 'DATE-TIME');
      triggerProp.setValue(absTime);
    } catch {
      triggerProp.setValue(raw);
    }
  }
  valarm.addProperty(triggerProp);

  valarm.addPropertyWithValue('description', alarm.description || eventSummary || 'Reminder');
  vevent.addSubcomponent(valarm);
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
