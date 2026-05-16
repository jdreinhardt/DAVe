import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Calendar, EventJson, AlarmJson } from '@dave/shared';
import { cn } from '../lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EventEditFormProps {
  initial: EventJson;
  calendars: Calendar[];
  selectedCalendarId: string;
  isNew: boolean;
  saving: boolean;
  onSave: (data: EventJson) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

type TriggerUnit = 'minutes' | 'hours' | 'days' | 'weeks';

interface AlarmDraft {
  action: 'DISPLAY' | 'EMAIL';
  triggerType: 'relative' | 'absolute';
  n: number;
  unit: TriggerUnit;
  before: boolean;
  absoluteStr: string; // datetime-local value for absolute triggers
  description: string;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function emptyEventJson(
  calendarId: string,
  start: string,
  end: string,
  allDay: boolean,
): EventJson {
  return {
    uid: crypto.randomUUID(),
    summary: '',
    description: '',
    location: '',
    start,
    end,
    allDay,
    tzid: allDay ? null : Intl.DateTimeFormat().resolvedOptions().timeZone,
    recurrenceRule: null,
    recurrenceId: null,
    alarms: [],
    attendees: [],
    calendarId,
    color: null,
  };
}

// ── Alarm draft helpers ───────────────────────────────────────────────────────

function alarmToAlarmDraft(alarm: AlarmJson): AlarmDraft {
  const parsed = parseDuration(alarm.trigger);
  if (parsed) {
    return {
      action: alarm.action,
      triggerType: 'relative',
      n: parsed.n,
      unit: parsed.unit,
      before: parsed.before,
      absoluteStr: '',
      description: alarm.description,
    };
  }
  return {
    action: alarm.action,
    triggerType: 'absolute',
    n: 15,
    unit: 'minutes',
    before: true,
    absoluteStr: alarm.trigger.substring(0, 16),
    description: alarm.description,
  };
}

function alarmDraftToAlarmJson(draft: AlarmDraft): AlarmJson {
  let trigger: string;
  if (draft.triggerType === 'relative') {
    trigger = durationToIso(draft.n, draft.unit, draft.before);
  } else {
    trigger = draft.absoluteStr ? new Date(draft.absoluteStr).toISOString() : '-PT15M';
  }
  return { action: draft.action, trigger, description: draft.description };
}

function durationToIso(n: number, unit: TriggerUnit, before: boolean): string {
  const sign = before ? '-' : '';
  const abs = Math.max(1, n);
  switch (unit) {
    case 'minutes': return `${sign}PT${abs}M`;
    case 'hours':   return `${sign}PT${abs}H`;
    case 'days':    return `${sign}P${abs}D`;
    case 'weeks':   return `${sign}P${abs}W`;
  }
}

function parseDuration(trigger: string): { n: number; unit: TriggerUnit; before: boolean } | null {
  const before = trigger.startsWith('-');
  const raw = trigger.replace(/^[+-]/, '');
  if (!raw.startsWith('P')) return null;

  const w = raw.match(/^P(\d+)W$/);
  if (w) return { n: parseInt(w[1] ?? '1'), unit: 'weeks', before };
  const d = raw.match(/^P(\d+)D$/);
  if (d) return { n: parseInt(d[1] ?? '1'), unit: 'days', before };
  const h = raw.match(/^PT(\d+)H$/);
  if (h) return { n: parseInt(h[1] ?? '1'), unit: 'hours', before };
  const m = raw.match(/^PT(\d+)M$/);
  if (m) return { n: parseInt(m[1] ?? '15'), unit: 'minutes', before };

  return null; // complex duration; fall back to absolute UI
}

// ── Date/time helpers ─────────────────────────────────────────────────────────

const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Convert a UTC ISO string to a "YYYY-MM-DDTHH:MM" string in the given
 * timezone for use with <input type="datetime-local">.
 */
function utcToLocalInput(utcIso: string, tzid: string): string {
  try {
    const date = new Date(utcIso);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tzid,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const p: Record<string, string> = {};
    for (const part of parts) p[part.type] = part.value;
    const h = p.hour === '24' ? '00' : p.hour;
    return `${p.year}-${p.month}-${p.day}T${h}:${p.minute}`;
  } catch {
    return utcIso.substring(0, 16);
  }
}

/**
 * Convert a "YYYY-MM-DDTHH:MM" datetime-local value (wall-clock in tzid) to
 * a UTC ISO string. When tzid equals the browser TZ (the default), new Date()
 * handles this correctly. For other zones, we compute the offset via Intl.
 * Note: DST-ambiguous times may resolve to either side of the transition.
 */
function localInputToUTC(localStr: string, tzid: string): string {
  // Treat the input as UTC first to get an approximation, then find the actual
  // offset by seeing what local time that UTC maps to in the target zone.
  const approx = new Date(localStr + ':00Z');
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tzid,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(approx);
    const p: Record<string, string> = {};
    for (const part of parts) p[part.type] = part.value;
    const h = p.hour === '24' ? '00' : p.hour;
    const localAsUTC = new Date(`${p.year}-${p.month}-${p.day}T${h}:${p.minute}:${p.second}Z`);
    const offsetMs = localAsUTC.getTime() - approx.getTime();
    return new Date(approx.getTime() - offsetMs).toISOString();
  } catch {
    return new Date(localStr).toISOString();
  }
}

/** Add N days to a YYYY-MM-DD string. */
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().substring(0, 10);
}

// ── Available timezones ───────────────────────────────────────────────────────

const TZ_LIST: string[] = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (Intl as any).supportedValuesOf('timeZone') as string[];
  } catch {
    return [BROWSER_TZ];
  }
})();

// ── Main component ────────────────────────────────────────────────────────────

export default function EventEditForm({
  initial,
  calendars,
  selectedCalendarId,
  isNew,
  saving,
  onSave,
  onDelete,
  onCancel,
}: EventEditFormProps) {
  const initTzid = initial.tzid ?? BROWSER_TZ;

  // Form field state
  const [summary, setSummary] = useState(initial.summary);
  const [description, setDescription] = useState(initial.description);
  const [location, setLocation] = useState(initial.location);
  const [allDay, setAllDay] = useState(initial.allDay);
  const [tzid, setTzid] = useState(initTzid);
  const [calendarId, setCalendarId] = useState(selectedCalendarId);
  const [summaryError, setSummaryError] = useState(false);

  // Start / end stored as datetime-local strings (YYYY-MM-DDTHH:MM) for timed,
  // or YYYY-MM-DD for all-day. The all-day end shown to the user is INCLUSIVE
  // (EventJson stores the exclusive end, i.e. the day after).
  const [startStr, setStartStr] = useState<string>(() => {
    if (initial.allDay) return initial.start.substring(0, 10);
    return utcToLocalInput(initial.start, initTzid);
  });
  const [endStr, setEndStr] = useState<string>(() => {
    if (initial.allDay) {
      // Display inclusive end (subtract 1 exclusive day stored in EventJson).
      const exc = initial.end || initial.start;
      const incl = addDays(exc.substring(0, 10), -1);
      // Guard: never show end before start.
      return incl >= initial.start.substring(0, 10) ? incl : initial.start.substring(0, 10);
    }
    return utcToLocalInput(initial.end || initial.start, initTzid);
  });

  const [alarms, setAlarms] = useState<AlarmDraft[]>(() =>
    initial.alarms.map(alarmToAlarmDraft),
  );

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAllDayToggle = (checked: boolean) => {
    setAllDay(checked);
    if (checked) {
      // Snap timed values to date portion
      setStartStr(startStr.substring(0, 10));
      setEndStr(endStr.substring(0, 10));
    } else {
      // Add default time (09:00 – 10:00)
      setStartStr(startStr.substring(0, 10) + 'T09:00');
      setEndStr(endStr.substring(0, 10) + 'T10:00');
    }
  };

  const handleTzChange = (newTz: string) => {
    // Reinterpret the current wall-clock as the new timezone (no time shift).
    setTzid(newTz);
  };

  const addAlarm = () =>
    setAlarms((a) => [
      ...a,
      { action: 'DISPLAY', triggerType: 'relative', n: 15, unit: 'minutes', before: true, absoluteStr: '', description: '' },
    ]);

  const updateAlarm = (i: number, patch: Partial<AlarmDraft>) =>
    setAlarms((a) => a.map((al, idx) => (idx === i ? { ...al, ...patch } : al)));

  const removeAlarm = (i: number) => setAlarms((a) => a.filter((_, idx) => idx !== i));

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim()) {
      setSummaryError(true);
      return;
    }

    let start: string;
    let end: string;
    let resolvedTzid: string | null;

    if (allDay) {
      start = startStr.substring(0, 10);
      // Convert inclusive end back to exclusive.
      const inclEnd = endStr.substring(0, 10);
      end = addDays(inclEnd >= start ? inclEnd : start, 1);
      resolvedTzid = null;
    } else {
      start = localInputToUTC(startStr, tzid);
      end = localInputToUTC(endStr, tzid);
      resolvedTzid = tzid;
    }

    const data: EventJson = {
      ...initial,
      uid: initial.uid || crypto.randomUUID(),
      calendarId,
      summary: summary.trim(),
      description,
      location,
      start,
      end,
      allDay,
      tzid: resolvedTzid,
      alarms: alarms.map(alarmDraftToAlarmJson),
    };

    onSave(data);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const selectedCal = calendars.find((c) => c.id === calendarId) ?? calendars[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        className={cn(
          'bg-background rounded-lg shadow-xl border border-border',
          'w-full max-w-lg mx-4 flex flex-col',
          'max-h-[90vh]',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Calendar color accent */}
        <div className="h-1.5 w-full rounded-t-lg shrink-0" style={{ backgroundColor: selectedCal?.color ?? '#0082C9' }} />

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5 min-h-0">

            {/* Calendar selector — only shown when creating with multiple calendars */}
            {isNew && calendars.length > 1 && (
              <FormSection title="Calendar">
                <select
                  value={calendarId}
                  onChange={(e) => setCalendarId(e.target.value)}
                  className={inputCls}
                >
                  {calendars.map((cal) => (
                    <option key={cal.id} value={cal.id}>{cal.displayName}</option>
                  ))}
                </select>
              </FormSection>
            )}

            {/* Summary */}
            <FormSection title="Title">
              <input
                type="text"
                value={summary}
                onChange={(e) => { setSummary(e.target.value); setSummaryError(false); }}
                placeholder="Event title"
                className={cn(inputCls, summaryError && 'border-destructive ring-destructive')}
                autoFocus
              />
              {summaryError && (
                <p className="text-xs text-destructive">Title is required</p>
              )}
            </FormSection>

            {/* All-day + dates */}
            <FormSection title="When">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => handleAllDayToggle(e.target.checked)}
                  className="rounded"
                />
                All day
              </label>

              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <label className={labelCls}>Start</label>
                  <input
                    type={allDay ? 'date' : 'datetime-local'}
                    value={startStr}
                    onChange={(e) => setStartStr(e.target.value)}
                    className={inputCls}
                    required
                  />
                </div>
                <div>
                  <label className={labelCls}>End{allDay ? ' (inclusive)' : ''}</label>
                  <input
                    type={allDay ? 'date' : 'datetime-local'}
                    value={endStr}
                    onChange={(e) => setEndStr(e.target.value)}
                    min={startStr}
                    className={inputCls}
                    required
                  />
                </div>
              </div>

              {!allDay && (
                <div className="mt-2">
                  <label className={labelCls}>Timezone</label>
                  <select
                    value={tzid}
                    onChange={(e) => handleTzChange(e.target.value)}
                    className={inputCls}
                  >
                    {TZ_LIST.map((tz) => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                </div>
              )}
            </FormSection>

            {/* Location */}
            <FormSection title="Location">
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Add a location"
                className={inputCls}
              />
            </FormSection>

            {/* Description */}
            <FormSection title="Description">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a description"
                rows={3}
                className={cn(inputCls, 'resize-none')}
              />
            </FormSection>

            {/* Alarms */}
            <FormSection
              title="Reminders"
              action={
                <button
                  type="button"
                  onClick={addAlarm}
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Plus className="h-3 w-3" /> Add
                </button>
              }
            >
              {alarms.length === 0 && (
                <p className="text-xs text-muted-foreground">No reminders — other CalDAV clients will fire them.</p>
              )}
              {alarms.map((alarm, i) => (
                <AlarmRow
                  key={i}
                  alarm={alarm}
                  onChange={(patch) => updateAlarm(i, patch)}
                  onRemove={() => removeAlarm(i)}
                />
              ))}
            </FormSection>
          </div>

          {/* Footer */}
          <div className={cn(
            'flex items-center justify-between gap-3 px-6 py-4',
            'border-t border-border shrink-0',
          )}>
            <div>
              {!isNew && onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  className={cn(outlineBtnCls, 'text-destructive border-destructive hover:bg-destructive/10')}
                >
                  Delete
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onCancel} className={outlineBtnCls}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium',
                  'bg-primary text-primary-foreground hover:bg-primary/90',
                  'focus:outline-none focus:ring-2 focus:ring-ring',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Alarm row ─────────────────────────────────────────────────────────────────

function AlarmRow({
  alarm,
  onChange,
  onRemove,
}: {
  alarm: AlarmDraft;
  onChange: (patch: Partial<AlarmDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3 relative">
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-2 right-2 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      <div className="flex gap-2 flex-wrap pr-6">
        {/* Action */}
        <select
          value={alarm.action}
          onChange={(e) => onChange({ action: e.target.value as 'DISPLAY' | 'EMAIL' })}
          className={smallSelectCls}
        >
          <option value="DISPLAY">Notification</option>
          <option value="EMAIL">Email</option>
        </select>

        {/* Trigger type */}
        <select
          value={alarm.triggerType}
          onChange={(e) => onChange({ triggerType: e.target.value as 'relative' | 'absolute' })}
          className={smallSelectCls}
        >
          <option value="relative">Relative</option>
          <option value="absolute">Absolute time</option>
        </select>
      </div>

      {alarm.triggerType === 'relative' ? (
        <div className="flex gap-2 flex-wrap items-center">
          <input
            type="number"
            min={1}
            value={alarm.n}
            onChange={(e) => onChange({ n: Math.max(1, parseInt(e.target.value) || 1) })}
            className={cn(smallSelectCls, 'w-16')}
          />
          <select
            value={alarm.unit}
            onChange={(e) => onChange({ unit: e.target.value as TriggerUnit })}
            className={smallSelectCls}
          >
            <option value="minutes">minute(s)</option>
            <option value="hours">hour(s)</option>
            <option value="days">day(s)</option>
            <option value="weeks">week(s)</option>
          </select>
          <select
            value={alarm.before ? 'before' : 'after'}
            onChange={(e) => onChange({ before: e.target.value === 'before' })}
            className={smallSelectCls}
          >
            <option value="before">before</option>
            <option value="after">after</option>
          </select>
          <span className="text-xs text-muted-foreground">start</span>
        </div>
      ) : (
        <input
          type="datetime-local"
          value={alarm.absoluteStr}
          onChange={(e) => onChange({ absoluteStr: e.target.value })}
          className={cn(inputCls, 'text-sm')}
        />
      )}

      {/* Optional description override */}
      <input
        type="text"
        value={alarm.description}
        onChange={(e) => onChange({ description: e.target.value })}
        placeholder="Description (defaults to event title)"
        className={cn(inputCls, 'text-xs')}
      />
    </div>
  );
}

// ── FormSection ───────────────────────────────────────────────────────────────

function FormSection({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        {action}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const inputCls = [
  'w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground',
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring',
].join(' ');

const labelCls = 'block text-xs text-muted-foreground mb-0.5';

const outlineBtnCls = [
  'rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted',
  'text-foreground focus:outline-none focus:ring-2 focus:ring-ring',
].join(' ');

const smallSelectCls = [
  'rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground',
  'focus:outline-none focus:ring-2 focus:ring-ring',
].join(' ');
