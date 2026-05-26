import { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp, Repeat } from 'lucide-react';
import type { Calendar, Task, TaskJson, AlarmJson } from '@dave/shared';
import { cn } from '../lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TaskEditFormProps {
  initial: TaskJson;
  calendars: Calendar[]; // VTODO-capable calendars
  isNew: boolean;
  saving: boolean;
  onSave: (data: TaskJson) => void;
  onDelete?: () => void;
  onCancel: () => void;
  /** All tasks visible to the user, used to populate the parent-task selector. */
  allTasks?: Task[];
}

type TriggerUnit = 'minutes' | 'hours' | 'days' | 'weeks';

interface AlarmDraft {
  action: 'DISPLAY' | 'EMAIL';
  triggerType: 'relative' | 'absolute';
  n: number;
  unit: TriggerUnit;
  before: boolean;
  absoluteStr: string;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function emptyTaskJson(collectionUrl: string): TaskJson {
  return {
    uid: crypto.randomUUID(),
    summary: '',
    description: '',
    status: 'NEEDS-ACTION',
    priority: null,
    dtstart: null,
    due: null,
    completed: null,
    percentComplete: null,
    lastModified: null,
    categories: [],
    relations: [],
    collectionUrl,
    alarms: [],
    rrule: null,
  };
}

// ── Alarm helpers (mirrors EventEditForm) ─────────────────────────────────────

function alarmToAlarmDraft(alarm: AlarmJson): AlarmDraft {
  const parsed = parseDuration(alarm.trigger);
  if (parsed) {
    return { action: alarm.action, triggerType: 'relative', n: parsed.n, unit: parsed.unit, before: parsed.before, absoluteStr: '' };
  }
  return { action: alarm.action, triggerType: 'absolute', n: 15, unit: 'minutes', before: true, absoluteStr: alarm.trigger };
}

function alarmDraftToAlarmJson(draft: AlarmDraft): AlarmJson {
  const trigger = draft.triggerType === 'relative'
    ? durationToIso(draft.n, draft.unit, draft.before)
    : (draft.absoluteStr || '-PT15M');
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

// ── Category helpers ──────────────────────────────────────────────────────────

function parseCategoryInput(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// ── Priority helpers ──────────────────────────────────────────────────────────

function priorityLabel(p: number): string {
  if (p >= 1 && p <= 3) return 'High';
  if (p >= 4 && p <= 6) return 'Medium';
  if (p >= 7 && p <= 9) return 'Low';
  return '';
}

function priorityColor(p: number): string {
  if (p >= 1 && p <= 3) return 'text-red-600 dark:text-red-400';
  if (p >= 4 && p <= 6) return 'text-amber-600 dark:text-amber-400';
  if (p >= 7 && p <= 9) return 'text-green-600 dark:text-green-400';
  return '';
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function isDatetime(iso: string | null): boolean {
  return iso !== null && iso.includes('T');
}

function isoToDateInput(iso: string | null): string {
  if (!iso) return '';
  return iso.substring(0, 10);
}

function isoToDatetimeInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  // Format as YYYY-MM-DDTHH:MM in local time for datetime-local input.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeInputToIso(localStr: string): string | null {
  if (!localStr) return null;
  // datetime-local gives "YYYY-MM-DDTHH:MM"; new Date() parses as local time.
  return new Date(localStr).toISOString();
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TaskEditForm({
  initial,
  calendars,
  isNew,
  saving,
  onSave,
  onDelete,
  onCancel,
  allTasks,
}: TaskEditFormProps) {
  const [summary, setSummary] = useState(initial.summary);
  const [summaryError, setSummaryError] = useState(false);
  const [description, setDescription] = useState(initial.description);
  const [status, setStatus] = useState<string>(initial.status ?? 'NEEDS-ACTION');
  const [hasPriority, setHasPriority] = useState(initial.priority != null);
  const [priority, setPriority] = useState<number>(initial.priority ?? 5);
  const [dtstartStr, setDtstartStr] = useState(isoToDateInput(initial.dtstart));
  const [dueAllDay, setDueAllDay] = useState(!isDatetime(initial.due));
  const [dueDateStr, setDueDateStr] = useState(isoToDateInput(initial.due));
  const [dueDatetimeStr, setDueDatetimeStr] = useState(
    isDatetime(initial.due) ? isoToDatetimeInput(initial.due) : '',
  );
  const [percentComplete, setPercentComplete] = useState<number>(initial.percentComplete ?? 0);
  const [categoryStr, setCategoryStr] = useState(initial.categories.join(', '));
  const [collectionUrl, setCollectionUrl] = useState(initial.collectionUrl);
  const [alarms, setAlarms] = useState<AlarmDraft[]>(() => (initial.alarms ?? []).map(alarmToAlarmDraft));
  const [showMore, setShowMore] = useState(!!(initial.alarms?.length || initial.dtstart || initial.percentComplete));
  const [parentUid, setParentUid] = useState<string>(
    () => initial.relations.find((r) => r.reltype === 'PARENT')?.relatedUid ?? '',
  );

  // ── Handlers ─────────────────────────────────────────────────────────────

  const addAlarm = () =>
    setAlarms((a) => [...a, { action: 'DISPLAY', triggerType: 'relative', n: 15, unit: 'minutes', before: true, absoluteStr: '' }]);

  const removeAlarm = (i: number) =>
    setAlarms((a) => a.filter((_, idx) => idx !== i));

  const updateAlarm = (i: number, patch: Partial<AlarmDraft>) =>
    setAlarms((a) => a.map((al, idx) => idx === i ? { ...al, ...patch } : al));

  const handleSubmit = () => {
    if (!summary.trim()) {
      setSummaryError(true);
      return;
    }
    setSummaryError(false);

    // Rebuild relations: keep all non-PARENT entries, then add PARENT if selected.
    const nonParentRelations = initial.relations.filter((r) => r.reltype !== 'PARENT');
    const relations = parentUid
      ? [...nonParentRelations, { relatedUid: parentUid, reltype: 'PARENT' }]
      : nonParentRelations;

    const data: TaskJson = {
      ...initial,
      summary: summary.trim(),
      description: description.trim(),
      status: status || 'NEEDS-ACTION',
      priority: hasPriority ? priority : null,
      dtstart: dtstartStr || null,
      due: dueAllDay ? (dueDateStr || null) : datetimeInputToIso(dueDatetimeStr),
      completed: initial.completed, // completion timestamp managed by backend applyCompletion
      percentComplete: percentComplete || null,
      categories: parseCategoryInput(categoryStr),
      relations,
      collectionUrl,
      alarms: alarms.map(alarmDraftToAlarmJson),
      rrule: initial.rrule, // pass through unchanged; M3 doesn't edit RRULE
    };

    onSave(data);
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Summary */}
      <div>
        <label className="block text-sm font-medium mb-1">
          Title <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={summary}
          onChange={(e) => { setSummary(e.target.value); if (e.target.value.trim()) setSummaryError(false); }}
          placeholder="Task title"
          className={cn(
            'w-full rounded-md border px-3 py-2 text-sm bg-background',
            summaryError ? 'border-red-500' : 'border-input',
          )}
          autoFocus={isNew}
        />
        {summaryError && <p className="text-xs text-red-500 mt-1">Title is required</p>}
      </div>

      {/* Status */}
      <div>
        <label className="block text-sm font-medium mb-1">Status</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-full rounded-md border border-input px-3 py-2 text-sm bg-background"
        >
          <option value="NEEDS-ACTION">Not started</option>
          <option value="IN-PROCESS">In progress</option>
          <option value="CANCELLED">Cancelled</option>
          {initial.status === 'COMPLETED' && <option value="COMPLETED">Completed</option>}
        </select>
      </div>

      {/* Calendar */}
      {calendars.length > 1 && (
        <div>
          <label className="block text-sm font-medium mb-1">List</label>
          <select
            value={collectionUrl}
            onChange={(e) => {
              setCollectionUrl(e.target.value);
              setParentUid(''); // parent must be in the same collection
            }}
            className="w-full rounded-md border border-input px-3 py-2 text-sm bg-background"
          >
            {calendars.map((cal) => (
              <option key={cal.url} value={cal.url}>{cal.displayName}</option>
            ))}
          </select>
        </div>
      )}

      {/* Parent task */}
      {allTasks && allTasks.length > 0 && (
        <div>
          <label className="block text-sm font-medium mb-1">Parent task</label>
          <select
            value={parentUid}
            onChange={(e) => setParentUid(e.target.value)}
            className="w-full rounded-md border border-input px-3 py-2 text-sm bg-background"
          >
            <option value="">(No parent)</option>
            {allTasks
              .filter((t) => t.uid !== initial.uid && t.collectionUrl === collectionUrl)
              .map((t) => (
                <option key={t.uid} value={t.uid}>
                  {t.data.summary || '(no title)'}
                </option>
              ))}
          </select>
        </div>
      )}

      {/* Due date */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium">Due date</label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dueAllDay}
              onChange={(e) => {
                setDueAllDay(e.target.checked);
                if (e.target.checked && dueDatetimeStr) {
                  // Switching to all-day — keep the date portion.
                  setDueDateStr(dueDatetimeStr.substring(0, 10));
                } else if (!e.target.checked && dueDateStr) {
                  // Switching to timed — pre-fill with date + noon.
                  setDueDatetimeStr(dueDateStr + 'T12:00');
                }
              }}
              className="rounded"
            />
            All day
          </label>
        </div>
        {dueAllDay ? (
          <input
            type="date"
            value={dueDateStr}
            onChange={(e) => setDueDateStr(e.target.value)}
            className="w-full rounded-md border border-input px-3 py-2 text-sm bg-background"
          />
        ) : (
          <input
            type="datetime-local"
            value={dueDatetimeStr}
            onChange={(e) => setDueDatetimeStr(e.target.value)}
            className="w-full rounded-md border border-input px-3 py-2 text-sm bg-background"
          />
        )}
      </div>

      {/* Categories */}
      <div>
        <label className="block text-sm font-medium mb-1">Tags</label>
        <input
          type="text"
          value={categoryStr}
          onChange={(e) => setCategoryStr(e.target.value)}
          placeholder="work, personal, urgent"
          className="w-full rounded-md border border-input px-3 py-2 text-sm bg-background"
        />
        <p className="text-xs text-muted-foreground mt-1">Comma-separated</p>
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium mb-1">Notes</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Add notes…"
          className="w-full rounded-md border border-input px-3 py-2 text-sm bg-background resize-y"
        />
      </div>

      {/* Priority */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <label className="text-sm font-medium">Priority</label>
          <button
            type="button"
            onClick={() => setHasPriority((v) => !v)}
            className="text-xs text-muted-foreground underline"
          >
            {hasPriority ? 'Clear' : 'Set priority'}
          </button>
        </div>
        {hasPriority && (
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={9}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="flex-1"
            />
            <span className={cn('text-sm font-medium w-16', priorityColor(priority))}>
              {priorityLabel(priority)} ({priority})
            </span>
          </div>
        )}
      </div>

      {/* More section toggle */}
      <button
        type="button"
        onClick={() => setShowMore((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {showMore ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {showMore ? 'Fewer options' : 'More options'}
      </button>

      {showMore && (
        <div className="flex flex-col gap-4 border-l pl-4 ml-1 border-border">
          {/* Start date */}
          <div>
            <label className="block text-sm font-medium mb-1">Start date</label>
            <input
              type="date"
              value={dtstartStr}
              onChange={(e) => setDtstartStr(e.target.value)}
              className="w-full rounded-md border border-input px-3 py-2 text-sm bg-background"
            />
          </div>

          {/* Percent complete */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Progress — {percentComplete}%
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={percentComplete}
              onChange={(e) => setPercentComplete(Number(e.target.value))}
              className="w-full"
            />
          </div>

          {/* Recurring notice */}
          {initial.rrule && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Repeat size={14} />
              Recurring task — recurrence editing coming soon
            </div>
          )}

          {/* Alarms */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Reminders</label>
              <button
                type="button"
                onClick={addAlarm}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus size={12} /> Add reminder
              </button>
            </div>
            {alarms.map((alarm, i) => (
              <AlarmRow
                key={i}
                alarm={alarm}
                onChange={(patch) => updateAlarm(i, patch)}
                onRemove={() => removeAlarm(i)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between pt-2 border-t border-border mt-2">
        <div className="flex gap-2">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={saving}
              className="px-3 py-1.5 text-sm rounded-md border border-destructive text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded-md border border-input hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : isNew ? 'Create task' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AlarmRow sub-component ────────────────────────────────────────────────────

function AlarmRow({
  alarm,
  onChange,
  onRemove,
}: {
  alarm: AlarmDraft;
  onChange: (patch: Partial<AlarmDraft>) => void;
  onRemove: () => void;
}) {
  if (alarm.triggerType === 'absolute') {
    return (
      <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
        <span className="flex-1">At {new Date(alarm.absoluteStr).toLocaleString()} (fixed time)</span>
        <button type="button" onClick={onRemove} className="text-destructive hover:text-destructive/80">
          <Trash2 size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 mb-2">
      <input
        type="number"
        min={1}
        max={999}
        value={alarm.n}
        onChange={(e) => onChange({ n: Math.max(1, parseInt(e.target.value) || 1) })}
        className="w-16 rounded-md border border-input px-2 py-1 text-sm bg-background"
      />
      <select
        value={alarm.unit}
        onChange={(e) => onChange({ unit: e.target.value as TriggerUnit })}
        className="rounded-md border border-input px-2 py-1 text-sm bg-background"
      >
        <option value="minutes">min</option>
        <option value="hours">hours</option>
        <option value="days">days</option>
        <option value="weeks">weeks</option>
      </select>
      <span className="text-sm text-muted-foreground">before</span>
      <select
        value={alarm.action}
        onChange={(e) => onChange({ action: e.target.value as 'DISPLAY' | 'EMAIL' })}
        className="rounded-md border border-input px-2 py-1 text-sm bg-background"
      >
        <option value="DISPLAY">Notification</option>
        <option value="EMAIL">Email</option>
      </select>
      <button type="button" onClick={onRemove} className="text-destructive hover:text-destructive/80 ml-auto">
        <Trash2 size={14} />
      </button>
    </div>
  );
}
