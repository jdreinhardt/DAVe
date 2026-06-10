import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventInput, DatesSetArg, EventClickArg } from '@fullcalendar/core';
import { X, MapPin, AlignLeft, Clock, Repeat, Users, Bell, Pencil, Trash2 } from 'lucide-react';
import type { Calendar, CalendarEvent, EventJson, RecurrenceRule, AttendeeJson, RecurrenceScope } from '@dave/shared';
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
import { cn, buildMapUrl } from '../lib/utils';
import EventEditForm, { emptyEventJson } from '../components/EventEditForm';
import { useHotkey } from '../hooks/useHotkey';

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
  editScope?: RecurrenceScope; // set when user already chose a scope via dialog
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
  const isMobile = useIsMobile();

  const location = useLocation();
  const navigate = useNavigate();
  const calRef = useRef<FullCalendar>(null);
  const [pendingSelectEventId, setPendingSelectEventId] = useState<string | null>(null);

  const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(null);
  const [popup, setPopup] = useState<PopupData | null>(null);
  const [editModal, setEditModal] = useState<EditModalState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CalendarEvent | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);

  // Pending scope confirmation: when a recurring event is about to be edited or
  // deleted, we park the action here and show the scope dialog first.
  const [pendingScopeAction, setPendingScopeAction] = useState<{
    verb: 'edit' | 'delete';
    calendarEvent: CalendarEvent;
    // For edit-via-drag: the new EventJson to save after scope is chosen.
    pendingData?: EventJson;
    revert?: () => void;
  } | null>(null);

  // Capture event selection from global search; navigate calendar to target date.
  useEffect(() => {
    const state = location.state as { selectEventId?: string; eventStart?: string } | null;
    if (!state?.selectEventId) return;
    setPendingSelectEventId(state.selectEventId);
    navigate(location.pathname + location.search, { replace: true, state: null });
    if (state.eventStart) calRef.current?.getApi().gotoDate(state.eventStart);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

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
    mutationFn: ({ ev, data, scope }: { ev: CalendarEvent; data: EventJson; scope?: RecurrenceScope }) =>
      updateCalendarEvent(ev.id, data, ev.etag, scope, ev.calendarId),
    onSuccess: (result, { ev }) => {
      queryClient.invalidateQueries({ queryKey: ['events', result.calendarId] });
      if (result.continuation) {
        queryClient.invalidateQueries({ queryKey: ['events', result.continuation.calendarId] });
      }
      // When the event moved calendars, also flush the source calendar's cache.
      if (ev.calendarId !== result.calendarId) {
        queryClient.invalidateQueries({ queryKey: ['events', ev.calendarId] });
      }
      setEditModal(null);
      setPopup(null);
      showToast('Event saved');
    },
    onError: (e) => showToast(errorMessage(e, true), 'err'),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ ev, scope }: { ev: CalendarEvent; scope?: RecurrenceScope }) =>
      deleteCalendarEvent(
        ev.id,
        ev.calendarId,
        ev.etag,
        scope,
        ev.data.recurrenceId ?? undefined,
        ev.data.allDay,
      ),
    onMutate: async ({ ev, scope }) => {
      // Only optimistically remove on scope=all (full delete). Scoped deletes
      // modify the master ICS, so a refetch is needed to show the updated series.
      if (!scope || scope === 'all') {
        const queryFilter = { queryKey: ['events', ev.calendarId] };
        await queryClient.cancelQueries(queryFilter);
        // Snapshot all matching time-range buckets so we can roll back.
        const snapshots = queryClient.getQueriesData<CalendarEvent[]>(queryFilter);
        queryClient.setQueriesData<CalendarEvent[]>(
          queryFilter,
          (old) => (old ?? []).filter((e) => e.id !== ev.id),
        );
        setDeleteTarget(null);
        setPopup(null);
        setEditModal(null);
        return { snapshots, calendarId: ev.calendarId };
      }
      return null;
    },
    onSuccess: (_, { ev, scope }) => {
      if (scope && scope !== 'all') {
        // Scoped deletes need a refetch to show the modified recurring series.
        queryClient.invalidateQueries({ queryKey: ['events', ev.calendarId] });
        setDeleteTarget(null);
        setPopup(null);
        setEditModal(null);
      }
      showToast('Event deleted');
    },
    onError: (e, _, ctx) => {
      if (ctx?.snapshots) {
        for (const [key, data] of ctx.snapshots) {
          queryClient.setQueryData(key, data);
        }
      }
      setDeleteTarget(null);
      showToast(errorMessage(e, true), 'err');
    },
  });

  const allLoadedEvents = useMemo(
    () => visibleCalendars.flatMap((cal, i) => (eventQueries[i]?.data ?? []).map((ev) => ({ cal, ev }))),
    [eventQueries, visibleCalendars],
  );
  // Open popup for an event arriving from global search once the date's events are loaded.
  useEffect(() => {
    if (!pendingSelectEventId || allLoadedEvents.length === 0) return;
    const match = allLoadedEvents.find(({ ev }) => ev.data.uid === pendingSelectEventId);
    if (match) {
      setPendingSelectEventId(null);
      const calendar = visibleCalendars.find((c) => c.id === match.cal.id) ?? match.cal;
      setPopup({ calendarEvent: match.ev, calendar });
    }
  }, [pendingSelectEventId, allLoadedEvents, visibleCalendars]);

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

  // ── Scope dialog confirm ──────────────────────────────────────────────────

  const handleScopeConfirm = (scope: RecurrenceScope) => {
    if (!pendingScopeAction) return;
    const { verb, calendarEvent, pendingData, revert } = pendingScopeAction;
    setPendingScopeAction(null);

    if (verb === 'delete') {
      deleteMutation.mutate({ ev: calendarEvent, scope }, { onError: () => revert?.() });
    } else {
      // edit — either from modal or drag/resize
      if (pendingData) {
        updateMutation.mutate({ ev: calendarEvent, data: pendingData, scope }, {
          onError: () => revert?.(),
        });
      } else {
        // Open the edit modal with scope pre-chosen
        setEditModal({
          calendarEvent,
          initialStart: calendarEvent.data.start,
          initialEnd: calendarEvent.data.end,
          allDay: calendarEvent.data.allDay,
          calendarId: calendarEvent.calendarId,
          editScope: scope,
        });
      }
    }
  };

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

  // Drag to select a time range (week/day views) opens the create modal pre-filled.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleSelect = (arg: any) => {
    const calId = visibleCalendars[0]?.id ?? (calQuery.data?.[0]?.id ?? '');
    if (!calId) return;
    setEditModal({
      calendarEvent: null,
      initialStart: arg.startStr,
      initialEnd: arg.endStr,
      allDay: arg.allDay,
      calendarId: calId,
    });
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

    const isRecurring = !!eventData.recurrenceRule || !!eventData.recurrenceId;
    if (isRecurring) {
      setPendingScopeAction({ verb: 'edit', calendarEvent, pendingData: newData, revert: () => arg.revert() });
      return;
    }

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

    const isRecurring = !!eventData.recurrenceRule || !!eventData.recurrenceId;
    if (isRecurring) {
      setPendingScopeAction({ verb: 'edit', calendarEvent, pendingData: newData, revert: () => arg.revert() });
      return;
    }

    updateMutation.mutate({ ev: calendarEvent, data: newData }, {
      onError: () => arg.revert(),
    });
  };

  // ── Edit modal handlers ───────────────────────────────────────────────────

  const handleSave = (data: EventJson) => {
    if (editModal?.calendarEvent) {
      const ev = editModal.calendarEvent;
      const isRecurring = !!ev.data.recurrenceRule || !!ev.data.recurrenceId;
      const scope = editModal.editScope;
      if (isRecurring && !scope) {
        // Need scope — park this data and show dialog
        setPendingScopeAction({ verb: 'edit', calendarEvent: ev, pendingData: data });
        setEditModal(null);
        return;
      }
      // scope=all: the form's initial data had recurrenceId stripped (to enable
      // the RecurrenceEditor), but the backend needs the clicked occurrence's
      // original start to compute the time shift to apply to the master.
      const payload = scope === 'all' ? { ...data, recurrenceId: ev.data.recurrenceId } : data;
      updateMutation.mutate({ ev, data: payload, scope });
    } else {
      createMutation.mutate({ calId: data.calendarId || editModal?.calendarId || '', data });
    }
  };

  const handleDeleteRequest = (ev: CalendarEvent) => {
    const isRecurring = !!ev.data.recurrenceRule || !!ev.data.recurrenceId;
    if (isRecurring) {
      setPopup(null);
      setEditModal(null);
      setPendingScopeAction({ verb: 'delete', calendarEvent: ev });
    } else {
      setDeleteTarget(ev);
    }
  };

  const handleDeleteConfirm = () => {
    if (deleteTarget) deleteMutation.mutate({ ev: deleteTarget, scope: 'all' });
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  const handleNewEvent = useCallback(() => {
    const calId = visibleCalendars[0]?.id ?? (calQuery.data?.[0]?.id ?? '');
    if (!calId) return;
    const now = new Date();
    const roundedMs = Math.ceil(now.getTime() / (30 * 60_000)) * (30 * 60_000);
    const start = new Date(roundedMs).toISOString();
    const end = new Date(roundedMs + 60 * 60_000).toISOString();
    setEditModal({ calendarEvent: null, initialStart: start, initialEnd: end, allDay: false, calendarId: calId });
  }, [visibleCalendars, calQuery.data]);

  useHotkey('n', handleNewEvent);

  useHotkey('Escape', () => {
    if (editModal) { setEditModal(null); return; }
    if (popup) { setPopup(null); return; }
    if (deleteTarget) { setDeleteTarget(null); return; }
    if (pendingScopeAction) { setPendingScopeAction(null); return; }
  }, { skipWhenEditable: false });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col p-2 md:p-4 relative">
      {/* Sync indicator */}
      {isLoadingEvents && (
        <div className="absolute top-2 right-4 z-10 text-xs text-muted-foreground flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" />
          Syncing…
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={isMobile ? {
            left: 'prev,next',
            center: 'title',
            right: 'dayGridMonth,timeGridDay',
          } : {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay',
          }}
          buttonText={{ today: 'Today', month: 'Month', week: 'Week', day: 'Day' }}
          events={fcEvents}
          datesSet={handleDatesSet}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          select={handleSelect}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          editable={true}
          selectable={true}
          unselectAuto={true}
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
            const ev = popup.calendarEvent;
            const isRecurring = !!ev.data.recurrenceRule || !!ev.data.recurrenceId;
            setPopup(null);
            if (isRecurring) {
              setPendingScopeAction({ verb: 'edit', calendarEvent: ev });
            } else {
              setEditModal({
                calendarEvent: ev,
                initialStart: ev.data.start,
                initialEnd: ev.data.end,
                allDay: ev.data.allDay,
                calendarId: ev.calendarId,
              });
            }
          }}
          onDelete={() => handleDeleteRequest(popup.calendarEvent)}
        />
      )}

      {/* Event editor modal */}
      {editModal && (
        <EventEditForm
          initial={
            editModal.calendarEvent
              // scope=all: present the master (strip recurrenceId so the
              // RecurrenceEditor is enabled and no RECURRENCE-ID is written back)
              ? editModal.editScope === 'all'
                ? { ...editModal.calendarEvent.data, recurrenceId: null }
                : editModal.calendarEvent.data
              : emptyEventJson(
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

      {/* Recurrence scope dialog */}
      {pendingScopeAction && (
        <RecurrenceScopeDialog
          verb={pendingScopeAction.verb}
          onConfirm={handleScopeConfirm}
          onCancel={() => {
            pendingScopeAction.revert?.();
            setPendingScopeAction(null);
          }}
        />
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

// ── Recurrence scope dialog ───────────────────────────────────────────────────

function RecurrenceScopeDialog({
  verb,
  onConfirm,
  onCancel,
}: {
  verb: 'edit' | 'delete';
  onConfirm: (scope: RecurrenceScope) => void;
  onCancel: () => void;
}) {
  const [scope, setScope] = useState<RecurrenceScope>('this');
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="bg-background rounded-lg border border-border shadow-xl p-6 max-w-sm mx-4 w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-base mb-4">
          {verb === 'edit' ? 'Edit recurring event?' : 'Delete recurring event?'}
        </h3>
        <div className="space-y-2 mb-5">
          {(['this', 'following', 'all'] as RecurrenceScope[]).map((s) => (
            <label key={s} className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="recurrence-scope"
                value={s}
                checked={scope === s}
                onChange={() => setScope(s)}
                className="shrink-0"
              />
              <span className="text-sm">
                {s === 'this' && 'This event'}
                {s === 'following' && 'This and following events'}
                {s === 'all' && 'All events'}
              </span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(scope)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium',
              verb === 'delete'
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90',
            )}
          >
            {verb === 'edit' ? 'Edit' : 'Delete'}
          </button>
        </div>
      </div>
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
