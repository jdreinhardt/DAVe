import { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import type { Calendar, EventJson, AlarmJson, RecurrenceRule } from '@dave/shared';
import { RecurrenceEditor } from './RecurrenceEditor.js';
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
  // `before` is always true for new alarms; existing "after" alarms are read-only.
  before: boolean;
  absoluteStr: string; // only populated when triggerType === 'absolute' (read-only display)
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
    };
  }
  // Absolute trigger — preserved but shown read-only.
  return {
    action: alarm.action,
    triggerType: 'absolute',
    n: 15,
    unit: 'minutes',
    before: true,
    absoluteStr: alarm.trigger,
  };
}

function alarmDraftToAlarmJson(draft: AlarmDraft): AlarmJson {
  let trigger: string;
  if (draft.triggerType === 'relative') {
    trigger = durationToIso(draft.n, draft.unit, draft.before);
  } else {
    // Absolute: emit the stored string as-is (already ISO or duration).
    trigger = draft.absoluteStr || '-PT15M';
  }
  // Description intentionally omitted — serializer defaults to event title.
  return { action: draft.action, trigger, description: '' };
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

  return null;
}

function formatAbsoluteTrigger(isoStr: string): string {
  try { return new Date(isoStr).toLocaleString(); } catch { return isoStr; }
}

// ── Date/time helpers ─────────────────────────────────────────────────────────

const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

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

function localInputToUTC(localStr: string, tzid: string): string {
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

  const [summary, setSummary] = useState(initial.summary);
  const [description, setDescription] = useState(initial.description);
  const [location, setLocation] = useState(initial.location);
  const [allDay, setAllDay] = useState(initial.allDay);
  const [tzid, setTzid] = useState(initTzid);
  const [calendarId, setCalendarId] = useState(selectedCalendarId);
  const [summaryError, setSummaryError] = useState(false);
  const [showMore, setShowMore] = useState(
    // Auto-expand if the event has any non-default "more" content.
    !!(initial.location || initial.description || initial.alarms.length || initial.recurrenceRule || (initial.tzid && initial.tzid !== BROWSER_TZ)),
  );

  const [startStr, setStartStr] = useState<string>(() => {
    if (initial.allDay) return initial.start.substring(0, 10);
    return utcToLocalInput(initial.start, initTzid);
  });
  const [endStr, setEndStr] = useState<string>(() => {
    if (initial.allDay) {
      const exc = initial.end || initial.start;
      const incl = addDays(exc.substring(0, 10), -1);
      return incl >= initial.start.substring(0, 10) ? incl : initial.start.substring(0, 10);
    }
    return utcToLocalInput(initial.end || initial.start, initTzid);
  });

  const [alarms, setAlarms] = useState<AlarmDraft[]>(() =>
    initial.alarms.map(alarmToAlarmDraft),
  );

  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule | null>(
    initial.recurrenceRule ?? null,
  );

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAllDayToggle = (checked: boolean) => {
    setAllDay(checked);
    if (checked) {
      setStartStr(startStr.substring(0, 10));
      setEndStr(endStr.substring(0, 10));
    } else {
      setStartStr(startStr.substring(0, 10) + 'T09:00');
      setEndStr(endStr.substring(0, 10) + 'T10:00');
    }
  };

  const addAlarm = () =>
    setAlarms((a) => [
      ...a,
      { action: 'DISPLAY', triggerType: 'relative', n: 15, unit: 'minutes', before: true, absoluteStr: '' },
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
      const inclEnd = endStr.substring(0, 10);
      end = addDays(inclEnd >= start ? inclEnd : start, 1);
      resolvedTzid = null;
    } else {
      start = localInputToUTC(startStr, tzid);
      end = localInputToUTC(endStr, tzid);
      resolvedTzid = tzid;
    }

    onSave({
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
      recurrenceRule,
    });
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
          'w-full max-w-lg mx-4 flex flex-col max-h-[90vh]',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-1.5 w-full rounded-t-lg shrink-0" style={{ backgroundColor: selectedCal?.color ?? '#0082C9' }} />

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">

            {/* Calendar selector */}
            {calendars.length > 1 && (
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

            {/* Title */}
            <FormSection title="Title">
              <input
                type="text"
                value={summary}
                onChange={(e) => { setSummary(e.target.value); setSummaryError(false); }}
                placeholder="Event title"
                className={cn(inputCls, summaryError && 'border-destructive ring-destructive')}
                autoFocus
              />
              {summaryError && <p className="text-xs text-destructive">Title is required</p>}
            </FormSection>

            {/* When */}
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

              <div className="grid grid-cols-2 gap-3 mt-1">
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
            </FormSection>

            {/* More / Less toggle */}
            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground w-full"
            >
              {showMore ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showMore ? 'Less' : 'More options'}
            </button>

            {/* Expanded section */}
            {showMore && (
              <div className="space-y-4">
                {/* Timezone */}
                {!allDay && (
                  <FormSection title="Timezone">
                    <select
                      value={tzid}
                      onChange={(e) => setTzid(e.target.value)}
                      className={inputCls}
                    >
                      {TZ_LIST.map((tz) => (
                        <option key={tz} value={tz}>{tz}</option>
                      ))}
                    </select>
                  </FormSection>
                )}

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

                {/* Recurrence */}
                <FormSection title="Repeat">
                  <RecurrenceEditor
                    value={recurrenceRule}
                    onChange={setRecurrenceRule}
                    dtstart={startStr}
                    disabled={!!initial.recurrenceId}
                  />
                  {initial.recurrenceId && (
                    <p className="text-xs text-muted-foreground">
                      Recurrence rule is on the master event. Use &ldquo;Edit all&rdquo; to modify it.
                    </p>
                  )}
                </FormSection>

                {/* Reminders */}
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
                    <p className="text-xs text-muted-foreground">
                      Reminders are fired by your other CalDAV clients (phone, desktop).
                    </p>
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
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border shrink-0">
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
  // Absolute triggers (from existing events) are displayed read-only.
  if (alarm.triggerType === 'absolute') {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
        <span className="text-xs text-muted-foreground">
          {alarm.action === 'EMAIL' ? 'Email' : 'Notification'} at {formatAbsoluteTrigger(alarm.absoluteStr)}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // Relative trigger (the only type users can create).
  const beforeLabel = alarm.before ? 'before start' : 'after start';

  return (
    <div className="flex items-center gap-2 flex-wrap rounded-md border border-border px-3 py-2">
      <select
        value={alarm.action}
        onChange={(e) => onChange({ action: e.target.value as 'DISPLAY' | 'EMAIL' })}
        className={smallSelectCls}
      >
        <option value="DISPLAY">Notification</option>
        <option value="EMAIL">Email</option>
      </select>

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
        <option value="minutes">min</option>
        <option value="hours">hr</option>
        <option value="days">day(s)</option>
        <option value="weeks">week(s)</option>
      </select>

      <span className="text-xs text-muted-foreground">{beforeLabel}</span>

      <button
        type="button"
        onClick={onRemove}
        className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive shrink-0"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
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
