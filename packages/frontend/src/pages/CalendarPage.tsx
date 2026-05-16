import { useState, useMemo } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventInput, DatesSetArg, EventClickArg } from '@fullcalendar/core';
import { X, MapPin, AlignLeft, Clock, Repeat, Users, Bell, Pencil, Trash2 } from 'lucide-react';
import type { Calendar, CalendarEvent, EventJson, RecurrenceRule, AttendeeJson } from '@dave/shared';
import {
  getCalendars,
  getCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from '../api/collections';
import { ApiError } from '../api/client';
import { useCollectionVisibility } from '../contexts/CollectionVisibility';
import { useSettings } from '../contexts/Settings';
import type { MapService } from '../contexts/Settings';
import { cn } from '../lib/utils';
import EventEditForm, { emptyEventJson } from '../components/EventEditForm';

// ── Map helpers ───────────────────────────────────────────────────────────────

function buildMapUrl(location: string, service: MapService): string {
  const q = encodeURIComponent(location);
  switch (service) {
    case 'google': return `https://www.google.com/maps/search/?api=1&query=${q}`;
    case 'apple':  return `https://maps.apple.com/?q=${q}`;
    default:       return `https://www.openstreetmap.org/search?query=${q}`;
  }
}

function formatAlarmTrigger(trigger: string): string {
  const negative = trigger.startsWith('-');
  const raw = negative ? trigger.slice(1) : trigger.startsWith('+') ? trigger.slice(1) : trigger;

  if (!raw.startsWith('P')) {
    try { return new Date(trigger).toLocaleString(); } catch { return trigger; }
  }

  const match = raw.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return trigger;

  const totalMinutes =
    (parseInt(match[1] ?? '0')) * 7 * 24 * 60 +
    (parseInt(match[2] ?? '0')) * 24 * 60 +
    (parseInt(match[3] ?? '0')) * 60 +
    (parseInt(match[4] ?? '0')) +
    Math.round(parseInt(match[5] ?? '0') / 60);

  if (totalMinutes === 0) return 'At time of event';

  let label: string;
  if (totalMinutes % (7 * 24 * 60) === 0) {
    const n = totalMinutes / (7 * 24 * 60);
    label = `${n} ${n === 1 ? 'week' : 'weeks'}`;
  } else if (totalMinutes % (24 * 60) === 0) {
    const n = totalMinutes / (24 * 60);
    label = `${n} ${n === 1 ? 'day' : 'days'}`;
  } else if (totalMinutes % 60 === 0) {
    const n = totalMinutes / 60;
    label = `${n} ${n === 1 ? 'hour' : 'hours'}`;
  } else {
    label = `${totalMinutes} ${totalMinutes === 1 ? 'minute' : 'minutes'}`;
  }

  return negative ? `${label} before` : `${label} after`;
}

// ── Timezone helpers ──────────────────────────────────────────────────────────

const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function formatEventTime(isoStr: string, allDay: boolean): string {
  if (allDay) {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(isoStr + 'T00:00:00'));
  }
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoStr));
}

function formatOriginalTime(isoStr: string, tzid: string): string {
  const time = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: tzid,
  }).format(new Date(isoStr));
  return `Originally: ${time} ${tzid}`;
}

// ── Recurrence formatting ─────────────────────────────────────────────────────

const DAY_NAMES: Record<string, string> = {
  MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun',
};

function dayLabel(byday: string): string {
  const code = byday.replace(/^[+-]?\d*/, '').toUpperCase();
  return DAY_NAMES[code] ?? byday;
}

function formatRecurrence(rule: RecurrenceRule): string {
  const interval = rule.interval ?? 1;

  const freqWord: Record<RecurrenceRule['freq'], [string, string]> = {
    DAILY:   ['daily',   'day'],
    WEEKLY:  ['weekly',  'week'],
    MONTHLY: ['monthly', 'month'],
    YEARLY:  ['yearly',  'year'],
  };
  const [singular, noun] = freqWord[rule.freq];

  let base = interval === 1 ? `Repeats ${singular}` : `Repeats every ${interval} ${noun}s`;

  if (rule.freq === 'WEEKLY' && rule.byDay && rule.byDay.length > 0) {
    base += ` on ${rule.byDay.map(dayLabel).join(', ')}`;
  }

  if (rule.until) {
    const until = new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    }).format(new Date(rule.until + 'T00:00:00'));
    base += `, until ${until}`;
  } else if (rule.count != null) {
    base += `, ${rule.count} time${rule.count === 1 ? '' : 's'}`;
  }

  return base;
}

// ── Attendee helpers ──────────────────────────────────────────────────────────

const MAX_ATTENDEES_VISIBLE = 8;

function partstatStyle(partstat: string): { dot: string; label: string } {
  switch (partstat) {
    case 'ACCEPTED':     return { dot: 'bg-green-500',  label: 'Accepted' };
    case 'DECLINED':     return { dot: 'bg-red-500',    label: 'Declined' };
    case 'TENTATIVE':    return { dot: 'bg-amber-400',  label: 'Tentative' };
    case 'DELEGATED':    return { dot: 'bg-blue-400',   label: 'Delegated' };
    default:             return { dot: 'bg-muted-foreground/40', label: 'Awaiting' };
  }
}

function AttendeeRow({ attendee }: { attendee: AttendeeJson }) {
  const display = attendee.name || attendee.email;
  const sub = attendee.name ? attendee.email : null;
  const { dot, label } = partstatStyle(attendee.partstat);

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span
        className={cn('inline-block h-2 w-2 rounded-full shrink-0', dot)}
        title={label}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm truncate">{display}</p>
        {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
      </div>
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
    </div>
  );
}

// ── Popup data shape ──────────────────────────────────────────────────────────

interface PopupData {
  calendarEvent: CalendarEvent;
  calendar: Calendar;
}

// ── Toast ─────────────────────────────────────────────────────────────────────

interface ToastData { msg: string; type: 'ok' | 'err' }

// ── Edit modal state ──────────────────────────────────────────────────────────

interface EditModalState {
  calendarEvent: CalendarEvent | null; // null = creating new
  initialStart: string;
  initialEnd: string;
  allDay: boolean;
  calendarId: string;
}

// ── Error helper ──────────────────────────────────────────────────────────────

function errorMessage(e: unknown, is412Special = false): string {
  if (e instanceof ApiError) {
    if (is412Special && e.statusCode === 412) {
      return 'Event was modified elsewhere — please reload and try again.';
    }
    return e.message;
  }
  return 'Something went wrong.';
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const { hiddenCalendars } = useCollectionVisibility();
  const queryClient = useQueryClient();

  const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(null);
  const [popup, setPopup] = useState<PopupData | null>(null);
  const [editModal, setEditModal] = useState<EditModalState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CalendarEvent | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);

  const calQuery = useQuery({
    queryKey: ['calendars'],
    queryFn: getCalendars,
    staleTime: 5 * 60_000,
  });

  const visibleCalendars = useMemo(
    () => (calQuery.data ?? []).filter((cal) => !hiddenCalendars.has(cal.id)),
    [calQuery.data, hiddenCalendars],
  );

  const eventQueries = useQueries({
    queries: visibleCalendars.map((cal) => ({
      queryKey: ['events', cal.id, dateRange?.start, dateRange?.end],
      queryFn: () => getCalendarEvents(cal.id, dateRange!.start, dateRange!.end),
      enabled: !!dateRange,
      staleTime: 2 * 60_000,
    })),
  });

  const isLoadingEvents = dateRange !== null && eventQueries.some((q) => q.isFetching);

  // ── Toast helper ─────────────────────────────────────────────────────────

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: ({ calId, data }: { calId: string; data: EventJson }) =>
      createCalendarEvent(calId, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['events', result.calendarId] });
      setEditModal(null);
      showToast('Event created');
    },
    onError: (e) => showToast(errorMessage(e), 'err'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ ev, data }: { ev: CalendarEvent; data: EventJson }) =>
      updateCalendarEvent(ev.id, data, ev.etag),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['events', result.calendarId] });
      setEditModal(null);
      setPopup(null);
      showToast('Event saved');
    },
    onError: (e) => showToast(errorMessage(e, true), 'err'),
  });

  const deleteMutation = useMutation({
    mutationFn: (ev: CalendarEvent) =>
      deleteCalendarEvent(ev.id, ev.calendarId, ev.etag),
    onSuccess: (_, ev) => {
      queryClient.invalidateQueries({ queryKey: ['events', ev.calendarId] });
      setDeleteTarget(null);
      setPopup(null);
      setEditModal(null);
      showToast('Event deleted');
    },
    onError: (e) => {
      setDeleteTarget(null);
      showToast(errorMessage(e, true), 'err');
    },
  });

  // ── FullCalendar event mapping ─────────────────────────────────────────────

  const fcEvents = useMemo<EventInput[]>(() => {
    return visibleCalendars.flatMap((cal, i) => {
      const events = eventQueries[i]?.data ?? [];
      return events.map((ev) => ({
        id: `${cal.id}::${ev.id}::${ev.data.start}`,
        title: ev.data.summary || '(No title)',
        start: ev.data.start,
        end: ev.data.end,
        allDay: ev.data.allDay,
        backgroundColor: cal.color,
        borderColor: cal.color,
        textColor: '#ffffff',
        extendedProps: {
          eventData: ev.data,
          calendarEvent: ev,       // full CalendarEvent (includes etag)
          calendar: cal,
        },
      }));
    });
  }, [visibleCalendars, eventQueries]);

  // ── FullCalendar handlers ─────────────────────────────────────────────────

  const handleDatesSet = (arg: DatesSetArg) => {
    setDateRange({ start: arg.start.toISOString(), end: arg.end.toISOString() });
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleDateClick = (arg: any) => {
    const calId = visibleCalendars[0]?.id ?? (calQuery.data?.[0]?.id ?? '');
    if (!calId) return;
    const start = arg.dateStr;
    const isAllDay = arg.allDay;
    const end = isAllDay
      ? start
      : new Date(new Date(start).getTime() + 60 * 60_000).toISOString();
    setEditModal({ calendarEvent: null, initialStart: start, initialEnd: end, allDay: isAllDay, calendarId: calId });
  };

  const handleEventClick = (arg: EventClickArg) => {
    arg.jsEvent.preventDefault();
    const { calendarEvent, calendar } = arg.event.extendedProps as {
      eventData: EventJson;
      calendarEvent: CalendarEvent;
      calendar: Calendar;
    };
    setPopup({ calendarEvent, calendar });
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleEventDrop = (arg: any) => {
    const { calendarEvent, eventData } = arg.event.extendedProps as {
      eventData: EventJson;
      calendarEvent: CalendarEvent;
    };
    if (!calendarEvent) { arg.revert(); return; }

    const newData: EventJson = {
      ...eventData,
      start: arg.event.startStr,
      end: arg.event.endStr || arg.event.startStr,
      allDay: arg.event.allDay,
    };

    updateMutation.mutate({ ev: calendarEvent, data: newData }, {
      onError: () => arg.revert(),
    });
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleEventResize = (arg: any) => {
    const { calendarEvent, eventData } = arg.event.extendedProps as {
      eventData: EventJson;
      calendarEvent: CalendarEvent;
    };
    if (!calendarEvent) { arg.revert(); return; }

    const newData: EventJson = {
      ...eventData,
      start: arg.event.startStr,
      end: arg.event.endStr || arg.event.startStr,
    };

    updateMutation.mutate({ ev: calendarEvent, data: newData }, {
      onError: () => arg.revert(),
    });
  };

  // ── Edit modal handlers ───────────────────────────────────────────────────

  const handleSave = (data: EventJson) => {
    if (editModal?.calendarEvent) {
      updateMutation.mutate({ ev: editModal.calendarEvent, data });
    } else {
      createMutation.mutate({ calId: data.calendarId || editModal?.calendarId || '', data });
    }
  };

  const handleDeleteRequest = (ev: CalendarEvent) => {
    setDeleteTarget(ev);
  };

  const handleDeleteConfirm = () => {
    if (deleteTarget) deleteMutation.mutate(deleteTarget);
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col p-4 relative">
      {/* Sync indicator */}
      {isLoadingEvents && (
        <div className="absolute top-2 right-4 z-10 text-xs text-muted-foreground flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" />
          Syncing…
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay',
          }}
          buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day' }}
          events={fcEvents}
          datesSet={handleDatesSet}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          editable={true}
          selectable={true}
          height="100%"
          eventDisplay="block"
          dayMaxEvents={4}
        />
      </div>

      {/* Event detail popup */}
      {popup && !editModal && (
        <EventPopup
          calendarEvent={popup.calendarEvent}
          calendar={popup.calendar}
          onClose={() => setPopup(null)}
          onEdit={() => {
            setEditModal({
              calendarEvent: popup.calendarEvent,
              initialStart: popup.calendarEvent.data.start,
              initialEnd: popup.calendarEvent.data.end,
              allDay: popup.calendarEvent.data.allDay,
              calendarId: popup.calendarEvent.calendarId,
            });
            setPopup(null);
          }}
          onDelete={() => handleDeleteRequest(popup.calendarEvent)}
        />
      )}

      {/* Event editor modal */}
      {editModal && (
        <EventEditForm
          initial={
            editModal.calendarEvent?.data ??
            emptyEventJson(
              editModal.calendarId,
              editModal.initialStart,
              editModal.initialEnd,
              editModal.allDay,
            )
          }
          calendars={calQuery.data ?? []}
          selectedCalendarId={editModal.calendarId}
          isNew={!editModal.calendarEvent}
          saving={isSaving}
          onSave={handleSave}
          onDelete={editModal.calendarEvent ? () => handleDeleteRequest(editModal.calendarEvent!) : undefined}
          onCancel={() => setEditModal(null)}
        />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="bg-background rounded-lg border border-border shadow-xl p-6 max-w-sm mx-4 w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-base mb-2">Delete event?</h3>
            <p className="text-sm text-muted-foreground mb-5">
              &ldquo;{deleteTarget.data.summary || '(No title)'}&rdquo; will be permanently deleted.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleteMutation.isPending}
                className="rounded-md bg-destructive text-destructive-foreground px-3 py-1.5 text-sm hover:bg-destructive/90 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={cn(
            'fixed bottom-4 right-4 z-[70] rounded-lg px-4 py-2.5 text-sm shadow-lg',
            toast.type === 'ok'
              ? 'bg-background border border-border text-foreground'
              : 'bg-destructive text-destructive-foreground',
          )}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Event detail popup ────────────────────────────────────────────────────────

function EventPopup({
  calendarEvent,
  calendar,
  onClose,
  onEdit,
  onDelete,
}: {
  calendarEvent: CalendarEvent;
  calendar: Calendar;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { mapService } = useSettings();
  const event = calendarEvent.data;
  const showOriginalTz =
    !event.allDay && event.tzid !== null && event.tzid !== BROWSER_TZ;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className={cn(
          'bg-background rounded-lg shadow-xl border border-border',
          'w-full max-w-sm mx-4 overflow-hidden',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Calendar color accent bar */}
        <div className="h-1.5 w-full" style={{ backgroundColor: calendar.color }} />

        <div className="p-4 space-y-3">
          {/* Title + actions */}
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-semibold text-base leading-snug">
              {event.summary || '(No title)'}
            </h3>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={onEdit}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
                title="Edit event"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={onDelete}
                className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title="Delete event"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={onClose}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Calendar label */}
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: calendar.color }}
            />
            <span className="text-xs text-muted-foreground">{calendar.displayName}</span>
          </div>

          {/* Time */}
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span>{formatEventTime(event.start, event.allDay)}</span>
            </div>
            {!event.allDay && event.start !== event.end && (
              <div className="pl-6 text-xs text-muted-foreground">
                → {formatEventTime(event.end, false)}
              </div>
            )}
            {showOriginalTz && event.tzid && (
              <div className="pl-6 text-xs text-muted-foreground italic">
                {formatOriginalTime(event.start, event.tzid)}
              </div>
            )}
          </div>

          {/* Recurrence */}
          {event.recurrenceRule && (
            <div className="flex items-center gap-2 text-sm">
              <Repeat className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">{formatRecurrence(event.recurrenceRule)}</span>
            </div>
          )}

          {/* Alarms */}
          {event.alarms.length > 0 && (
            <div className="flex items-start gap-2 text-sm">
              <Bell className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
              <div className="space-y-0.5">
                {event.alarms.map((alarm, i) => (
                  <div key={i} className="text-muted-foreground">
                    {formatAlarmTrigger(alarm.trigger)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Location */}
          {event.location && (
            <div className="flex items-start gap-2 text-sm">
              <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
              <a
                href={buildMapUrl(event.location, mapService)}
                target="_blank"
                rel="noopener noreferrer"
                className="break-words hover:underline text-primary"
              >
                {event.location}
              </a>
            </div>
          )}

          {/* Description */}
          {event.description && (
            <div className="flex items-start gap-2 text-sm">
              <AlignLeft className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
              <p className="whitespace-pre-wrap break-words text-muted-foreground leading-relaxed">
                {event.description}
              </p>
            </div>
          )}

          {/* Attendees */}
          {event.attendees.length > 0 && (
            <div className="flex items-start gap-2">
              <Users className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
              <div className="flex-1 space-y-1.5 min-w-0">
                {event.attendees.slice(0, MAX_ATTENDEES_VISIBLE).map((a, i) => (
                  <AttendeeRow key={i} attendee={a} />
                ))}
                {event.attendees.length > MAX_ATTENDEES_VISIBLE && (
                  <p className="text-xs text-muted-foreground">
                    + {event.attendees.length - MAX_ATTENDEES_VISIBLE} more
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
