import { useState, useMemo } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventInput, DatesSetArg, EventClickArg } from '@fullcalendar/core';
import { X, MapPin, AlignLeft, Clock, Repeat, Users } from 'lucide-react';
import type { Calendar, EventJson, RecurrenceRule, AttendeeJson } from '@dave/shared';
import { getCalendars, getCalendarEvents } from '../api/collections';
import { useCollectionVisibility } from '../contexts/CollectionVisibility';
import { useSettings } from '../contexts/Settings';
import type { MapService } from '../contexts/Settings';
import { cn } from '../lib/utils';

// ── Map helpers ───────────────────────────────────────────────────────────────

function buildMapUrl(location: string, service: MapService): string {
  const q = encodeURIComponent(location);
  switch (service) {
    case 'google': return `https://www.google.com/maps/search/?api=1&query=${q}`;
    case 'apple':  return `https://maps.apple.com/?q=${q}`;
    default:       return `https://www.openstreetmap.org/search?query=${q}`;
  }
}

// ── Timezone helpers ──────────────────────────────────────────────────────────

const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function formatEventTime(isoStr: string, allDay: boolean): string {
  if (allDay) {
    // All-day dates are stored as YYYY-MM-DD; parse without timezone shift.
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
  // Strip optional ordinal prefix (e.g. "2MO" → "Mon", "-1FR" → "Fri")
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
  event: EventJson;
  calendar: Calendar;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const { hiddenCalendars } = useCollectionVisibility();
  const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(null);
  const [popup, setPopup] = useState<PopupData | null>(null);

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

  // Map CalendarEvents → FullCalendar EventInput.
  const fcEvents = useMemo<EventInput[]>(() => {
    return visibleCalendars.flatMap((cal, i) => {
      const events = eventQueries[i]?.data ?? [];
      return events.map((ev) => ({
        // Include start time so recurring instances (same URL, different time) each get a unique id.
        id: `${cal.id}::${ev.id}::${ev.data.start}`,
        title: ev.data.summary || '(No title)',
        start: ev.data.start,
        end: ev.data.end,
        allDay: ev.data.allDay,
        backgroundColor: cal.color,
        borderColor: cal.color,
        textColor: '#ffffff',
        extendedProps: { eventData: ev.data, calendar: cal },
      }));
    });
  }, [visibleCalendars, eventQueries]);

  const handleDatesSet = (arg: DatesSetArg) => {
    setDateRange({
      start: arg.start.toISOString(),
      end: arg.end.toISOString(),
    });
  };

  const handleEventClick = (arg: EventClickArg) => {
    arg.jsEvent.preventDefault();
    const { eventData, calendar } = arg.event.extendedProps as {
      eventData: EventJson;
      calendar: Calendar;
    };
    setPopup({ event: eventData, calendar });
  };

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
          buttonText={{
            today: 'Today',
            month: 'Month',
            week: 'Week',
            day: 'Day',
          }}
          events={fcEvents}
          datesSet={handleDatesSet}
          eventClick={handleEventClick}
          height="100%"
          eventDisplay="block"
          dayMaxEvents={4}
        />
      </div>

      {popup && (
        <EventPopup
          event={popup.event}
          calendar={popup.calendar}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
}

// ── Event detail popup ────────────────────────────────────────────────────────

function EventPopup({
  event,
  calendar,
  onClose,
}: {
  event: EventJson;
  calendar: Calendar;
  onClose: () => void;
}) {
  const { mapService } = useSettings();
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
          {/* Title + close button */}
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-semibold text-base leading-snug">
              {event.summary || '(No title)'}
            </h3>
            <button
              onClick={onClose}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
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
