import { createRequire } from 'node:module';
import type { EventJson, AlarmJson, AttendeeJson, RecurrenceRule, TaskJson } from '@dave/shared';
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
  if (!icsText?.trim()) return [];
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
 * a CalDAV server. Unknown properties from the original ICS are not preserved
 * here because EventJson is a normalized representation; round-trip fidelity
 * for exotic properties requires storing the raw ICS (see injectException).
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

  // RRULE
  if (event.recurrenceRule?.raw) {
    const rruleProp = new ICAL.Property('rrule');
    rruleProp.setValue(ICAL.Recur.fromString(event.recurrenceRule.raw));
    vevent.addProperty(rruleProp);
  }

  // RECURRENCE-ID (exception instances only)
  if (event.recurrenceId) {
    if (event.allDay) {
      const ridProp = new ICAL.Property('recurrence-id');
      ridProp.resetType('date');
      ridProp.setValue(ICAL.Time.fromDateString(event.recurrenceId.substring(0, 10)));
      vevent.addProperty(ridProp);
    } else {
      const ridTime = ICAL.Time.fromJSDate(new Date(event.recurrenceId), true);
      vevent.addPropertyWithValue('recurrence-id', ridTime);
    }
  }

  // VALARMs
  for (const alarm of event.alarms) {
    serializeAlarm(vevent, alarm, event.summary);
  }

  vcal.addSubcomponent(vevent);
  return vcal.toString();
}

// ── ICS mutation helpers (for recurring instance operations) ─────────────────

/**
 * Insert or replace a RECURRENCE-ID exception VEVENT into an existing raw ICS
 * string. The exception carries the same UID as the master but different times.
 * Used for scope="this" edits.
 */
export function injectException(rawIcs: string, exception: EventJson): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let jcal: any;
  try { jcal = ICAL.parse(rawIcs); } catch { return rawIcs; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comp = new ICAL.Component(jcal) as any;

  const ridStr = exception.recurrenceId;
  if (!ridStr) return rawIcs;

  // Remove any existing exception with the same RECURRENCE-ID
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing: any[] = comp.getAllSubcomponents('vevent');
  for (const v of existing) {
    const rid = v.getFirstPropertyValue('recurrence-id');
    if (!rid) continue;
    const ridIso = rid.toJSDate ? rid.toJSDate().toISOString() : String(rid);
    const targetIso = exception.allDay
      ? new Date(ridStr + 'T00:00:00Z').toISOString()
      : new Date(ridStr).toISOString();
    if (ridIso === targetIso) {
      comp.removeSubcomponent(v);
      break;
    }
  }

  // Build the exception VEVENT using serializeIcalEvent, then extract its VEVENT
  const excIcs = serializeIcalEvent({ ...exception, recurrenceRule: null });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let excJcal: any;
  try { excJcal = ICAL.parse(excIcs); } catch { return rawIcs; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const excComp = new ICAL.Component(excJcal) as any;
  const excVevent = excComp.getFirstSubcomponent('vevent');
  if (!excVevent) return rawIcs;

  comp.addSubcomponent(excVevent);
  return comp.toString();
}

/**
 * Add an EXDATE property to the master VEVENT, excluding the given occurrence.
 * Used for scope="this" deletes.
 */
export function addExdate(rawIcs: string, occurrenceIso: string, allDay: boolean): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let jcal: any;
  try { jcal = ICAL.parse(rawIcs); } catch { return rawIcs; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comp = new ICAL.Component(jcal) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const master: any = comp.getAllSubcomponents('vevent').find((v: any) => !v.hasProperty('recurrence-id'));
  if (!master) return rawIcs;

  const exdateProp = new ICAL.Property('exdate');
  if (allDay) {
    exdateProp.resetType('date');
    exdateProp.setValue(ICAL.Time.fromDateString(occurrenceIso.substring(0, 10)));
  } else {
    exdateProp.resetType('date-time');
    exdateProp.setValue(ICAL.Time.fromJSDate(new Date(occurrenceIso), true));
  }
  master.addProperty(exdateProp);
  return comp.toString();
}

/**
 * Set UNTIL on the master RRULE to end the series before the given occurrence.
 * Used for scope="following" edits and deletes.
 * beforeIso is the DTSTART of the first occurrence to be cut (exclusive).
 *
 * ical.js's getFirstValue() returns a decoded copy, not a mutable reference, so
 * we cannot simply assign to rruleVal.until. Instead we manipulate the RRULE as
 * a string and replace the property with ICAL.Recur.fromString().
 */
export function truncateRrule(rawIcs: string, beforeIso: string, allDay: boolean): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let jcal: any;
  try { jcal = ICAL.parse(rawIcs); } catch { return rawIcs; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comp = new ICAL.Component(jcal) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const master: any = comp.getAllSubcomponents('vevent').find((v: any) => !v.hasProperty('recurrence-id'));
  if (!master) return rawIcs;

  const rruleProp = master.getFirstProperty('rrule');
  if (!rruleProp) return rawIcs;

  // Get the RRULE as a string (ICAL.Recur.toString() returns the rule text).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rruleVal: any = rruleProp.getFirstValue();
  const rawRrule: string = String(rruleVal?.toString?.() ?? '');
  if (!rawRrule) return rawIcs;

  // Build the UNTIL value string (RFC 5545 §3.3.10).
  let untilStr: string;
  if (allDay) {
    const d = new Date(beforeIso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    untilStr = d.toISOString().substring(0, 10).replace(/-/g, ''); // YYYYMMDD
  } else {
    const d = new Date(new Date(beforeIso).getTime() - 1000); // 1 s before
    untilStr = [
      d.getUTCFullYear(),
      String(d.getUTCMonth() + 1).padStart(2, '0'),
      String(d.getUTCDate()).padStart(2, '0'),
      'T',
      String(d.getUTCHours()).padStart(2, '0'),
      String(d.getUTCMinutes()).padStart(2, '0'),
      String(d.getUTCSeconds()).padStart(2, '0'),
      'Z',
    ].join('');
  }

  // Strip any existing UNTIL/COUNT, append the new UNTIL.
  const newRrule = rawRrule
    .replace(/;?UNTIL=[^;]*/gi, '')
    .replace(/;?COUNT=\d+/gi, '')
    + `;UNTIL=${untilStr}`;

  // Replace the property (creates a fresh ICAL.Recur from the string).
  master.removeProperty('rrule');
  const newProp = new ICAL.Property('rrule');
  newProp.setValue(ICAL.Recur.fromString(newRrule));
  master.addProperty(newProp);

  // Drop exception VEVENTs at or after the cut point.
  const cutTime = allDay
    ? new Date(beforeIso + 'T00:00:00Z').getTime()
    : new Date(beforeIso).getTime();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exceptions: any[] = comp.getAllSubcomponents('vevent').filter((v: any) => v.hasProperty('recurrence-id'));
  for (const exc of exceptions) {
    const rid = exc.getFirstPropertyValue('recurrence-id');
    if (!rid) continue;
    const ridMs = rid.toJSDate ? rid.toJSDate().getTime() : new Date(String(rid)).getTime();
    if (ridMs >= cutTime) comp.removeSubcomponent(exc);
  }

  return comp.toString();
}

/**
 * Replace the master VEVENT in a raw ICS with a new version built from eventData,
 * preserving any existing exception VEVENTs (unless the RRULE changed, in which
 * case they are cleared since they may no longer correspond to valid occurrences).
 * Used for scope="all" edits.
 *
 * IMPORTANT: `event` carries times from whichever occurrence the user clicked,
 * not from the master. We must preserve the master's original DTSTART date so
 * earlier occurrences are not cut off. We do apply the user's duration change
 * (e.g. 1-hour → 2-hour events) by computing DTEND = original DTSTART + Δ.
 */
export function updateMasterVevent(rawIcs: string, event: EventJson): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let jcal: any;
  try { jcal = ICAL.parse(rawIcs); } catch { return serializeIcalEvent({ ...event, recurrenceId: null }); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comp = new ICAL.Component(jcal) as any;

  // Detect RRULE change so we can decide whether to keep exceptions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oldMaster: any = comp.getAllSubcomponents('vevent').find((v: any) => !v.hasProperty('recurrence-id'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oldRruleVal: any = oldMaster?.getFirstProperty('rrule')?.getFirstValue();
  const oldRruleStr: string = String(oldRruleVal?.toString?.() ?? '');
  const newRruleStr: string = event.recurrenceRule?.raw ?? '';
  const rruleChanged = oldRruleStr !== newRruleStr;

  // ── Anchor start/end to the master's original DTSTART ────────────────────
  // The passed event.start is the occurrence's date, not the master's first
  // occurrence date. Replacing DTSTART with it would silently delete all
  // earlier occurrences. Instead we keep the master's DTSTART and only carry
  // over the duration delta from the user's edit.
  let anchoredEvent: EventJson = { ...event, recurrenceId: null };

  if (oldMaster) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origDtstartVal: any = oldMaster.getFirstProperty('dtstart')?.getFirstValue();
    if (origDtstartVal) {
      if (event.allDay) {
        const origDateStr = icaltimeToDateString(origDtstartVal);
        // Preserve original start date; carry over duration (in days).
        const durationDays = Math.round(
          (new Date(event.end + 'T00:00:00Z').getTime() -
           new Date(event.start + 'T00:00:00Z').getTime()) / 86_400_000,
        );
        const endD = new Date(origDateStr + 'T00:00:00Z');
        endD.setUTCDate(endD.getUTCDate() + durationDays);
        anchoredEvent = {
          ...anchoredEvent,
          start: origDateStr,
          end: endD.toISOString().substring(0, 10),
        };
      } else {
        // Preserve original UTC instant; carry over duration (in ms).
        const origStartIso: string = origDtstartVal.toJSDate().toISOString();
        const durationMs =
          new Date(event.end).getTime() - new Date(event.start).getTime();
        const newEndIso = new Date(new Date(origStartIso).getTime() + durationMs).toISOString();
        anchoredEvent = { ...anchoredEvent, start: origStartIso, end: newEndIso };
      }
    }
  }

  // Remove the old master VEVENT.
  if (oldMaster) comp.removeSubcomponent(oldMaster);

  // If RRULE changed, also clear exception VEVENTs (they may be orphaned).
  if (rruleChanged) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const v of comp.getAllSubcomponents('vevent') as any[]) {
      comp.removeSubcomponent(v);
    }
  }

  // Build fresh master VEVENT via our serializer, then transplant it.
  const newIcs = serializeIcalEvent(anchoredEvent);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let newJcal: any;
  try { newJcal = ICAL.parse(newIcs); } catch { return rawIcs; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newComp = new ICAL.Component(newJcal) as any;
  const newVevent = newComp.getFirstSubcomponent('vevent');
  if (!newVevent) return rawIcs;

  // Refresh VTIMEZONE for the event's timezone (regenerated by serializeIcalEvent).
  if (anchoredEvent.tzid && !anchoredEvent.allDay) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const vtz of comp.getAllSubcomponents('vtimezone') as any[]) {
      if (vtz.getFirstPropertyValue('tzid') === anchoredEvent.tzid) {
        comp.removeSubcomponent(vtz);
        break;
      }
    }
    const newVtz = newComp.getFirstSubcomponent('vtimezone');
    if (newVtz) comp.addSubcomponent(newVtz);
  }

  comp.addSubcomponent(newVevent);
  return comp.toString();
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

// ── Task helpers ──────────────────────────────────────────────────────────────

/**
 * Enforce the three-property coherence rule for task completion (spec §5.6):
 * STATUS=COMPLETED ↔ PERCENT-COMPLETE=100 ↔ COMPLETED timestamp.
 * STATUS=CANCELLED clears COMPLETED but leaves PERCENT-COMPLETE alone.
 * Setting PERCENT-COMPLETE=100 on an otherwise non-complete task triggers completion.
 */
export function applyCompletion(data: TaskJson): TaskJson {
  const result = { ...data };

  // Percent-complete=100 implies completion regardless of status field.
  if (result.percentComplete === 100 && result.status !== 'CANCELLED') {
    result.status = 'COMPLETED';
  }

  if (result.status === 'COMPLETED') {
    result.percentComplete = 100;
    if (!result.completed) result.completed = new Date().toISOString();
  } else if (result.status === 'CANCELLED') {
    result.completed = null;
    // percent-complete left as-is per spec
  } else {
    // Any active status — clear completed timestamp and percent if they signal completion.
    if (result.percentComplete === 100) result.percentComplete = 0;
    result.completed = null;
  }

  return result;
}

/**
 * Serialize a TaskJson into a VCALENDAR > VTODO ICS string.
 *
 * When rawIcs is provided (update path), the existing ICS is parsed and only
 * the managed properties are replaced — unknown X- properties and any other
 * fields we don't render are preserved verbatim (round-trip fidelity).
 *
 * When rawIcs is absent (create path), a fresh VCALENDAR is built.
 */
export function serializeIcalTask(task: TaskJson, rawIcs?: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let vcal: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let vtodo: any;

  if (rawIcs) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jcal: any = ICAL.parse(rawIcs);
      vcal = new ICAL.Component(jcal);
      vtodo = vcal.getFirstSubcomponent('vtodo');
    } catch {
      rawIcs = undefined; // fall through to create path
    }
  }

  if (!vtodo) {
    // Create path.
    vcal = new ICAL.Component(['vcalendar', [], []]);
    vcal.addPropertyWithValue('version', '2.0');
    vcal.addPropertyWithValue('prodid', '-//dave//EN');
    vcal.addPropertyWithValue('calscale', 'GREGORIAN');
    vtodo = new ICAL.Component('vtodo');
    vcal.addSubcomponent(vtodo);
  }

  const uid = task.uid || randomUUID();

  vtodo.removeAllProperties('uid');
  vtodo.addPropertyWithValue('uid', uid);

  // DTSTAMP — always refresh
  vtodo.removeAllProperties('dtstamp');
  vtodo.addPropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true));

  // LAST-MODIFIED — always refresh
  vtodo.removeAllProperties('last-modified');
  vtodo.addPropertyWithValue('last-modified', ICAL.Time.fromJSDate(new Date(), true));

  setPropText(vtodo, 'summary', task.summary);
  setPropText(vtodo, 'description', task.description || null);

  if (task.status) {
    setPropText(vtodo, 'status', task.status.toUpperCase());
  } else {
    vtodo.removeAllProperties('status');
  }

  if (task.priority != null) {
    vtodo.removeAllProperties('priority');
    vtodo.addPropertyWithValue('priority', task.priority);
  } else {
    vtodo.removeAllProperties('priority');
  }

  if (task.percentComplete != null) {
    vtodo.removeAllProperties('percent-complete');
    vtodo.addPropertyWithValue('percent-complete', task.percentComplete);
  } else {
    vtodo.removeAllProperties('percent-complete');
  }

  // DTSTART — date-only if the value is a date string (no T), otherwise datetime
  setDateOrDatetime(vtodo, 'dtstart', task.dtstart);
  setDateOrDatetime(vtodo, 'due', task.due);
  setDateOrDatetime(vtodo, 'completed', task.completed);

  // CATEGORIES — one CATEGORIES property with all values
  vtodo.removeAllProperties('categories');
  if (task.categories.length > 0) {
    const catProp = new ICAL.Property('categories');
    catProp.setValues(task.categories);
    vtodo.addProperty(catProp);
  }

  // RELATED-TO — one property per relation
  vtodo.removeAllProperties('related-to');
  for (const rel of task.relations) {
    const relProp = new ICAL.Property('related-to');
    if (rel.reltype && rel.reltype !== 'UNKNOWN') {
      relProp.setParameter('reltype', rel.reltype);
    }
    relProp.setValue(rel.relatedUid);
    vtodo.addProperty(relProp);
  }

  // RRULE — preserve existing if task.rrule is null (we don't edit it in M3),
  // or update if a value is explicitly provided.
  if (task.rrule !== null && task.rrule !== undefined) {
    vtodo.removeAllProperties('rrule');
    if (task.rrule) {
      const rruleProp = new ICAL.Property('rrule');
      rruleProp.setValue(ICAL.Recur.fromString(task.rrule));
      vtodo.addProperty(rruleProp);
    }
  }
  // If task.rrule is null/undefined (not sent by client), leave any existing RRULE alone.

  // VALARMs: replace only when the caller provides alarms data (non-empty).
  // An empty array on an update path means "alarms weren't included in this
  // request" (e.g. a list-response status toggle), so we leave existing
  // VALARMs intact to avoid silent data loss. The full edit form always sends
  // the real alarm list fetched from the single-task endpoint.
  if (!rawIcs || (task.alarms && task.alarms.length > 0)) {
    for (const sub of vtodo.getAllSubcomponents('valarm')) {
      vtodo.removeSubcomponent(sub);
    }
    for (const alarm of task.alarms ?? []) {
      serializeAlarm(vtodo, alarm, task.summary);
    }
  }

  return vcal.toString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setPropText(comp: any, propName: string, value: string | null): void {
  comp.removeAllProperties(propName);
  if (value != null && value !== '') {
    comp.addPropertyWithValue(propName, value);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setDateOrDatetime(comp: any, propName: string, isoStr: string | null): void {
  comp.removeAllProperties(propName);
  if (!isoStr) return;
  const prop = new ICAL.Property(propName);
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoStr)) {
    prop.resetType('date');
    prop.setValue(ICAL.Time.fromDateString(isoStr));
  } else {
    prop.resetType('date-time');
    prop.setValue(ICAL.Time.fromJSDate(new Date(isoStr), true));
  }
  comp.addProperty(prop);
}

