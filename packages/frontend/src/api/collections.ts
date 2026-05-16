import type { AddressBook, Calendar, Contact, CalendarEvent, EventJson, EventWriteResponse } from '@dave/shared';
import { apiFetch } from './client';

export const getAddressBooks = (): Promise<AddressBook[]> =>
  apiFetch<AddressBook[]>('/api/addressbooks');

export const getCalendars = (): Promise<Calendar[]> =>
  apiFetch<Calendar[]>('/api/calendars');

export const getContacts = (addressBookId: string): Promise<Contact[]> =>
  apiFetch<Contact[]>(`/api/addressbooks/${encodeURIComponent(addressBookId)}/contacts`);

export const getCalendarEvents = (calendarId: string, start: string, end: string): Promise<CalendarEvent[]> =>
  apiFetch<CalendarEvent[]>(
    `/api/calendars/${encodeURIComponent(calendarId)}/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
  );

export const createCalendarEvent = (
  calendarId: string,
  data: EventJson,
): Promise<EventWriteResponse> =>
  apiFetch<EventWriteResponse>(
    `/api/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: 'POST', body: JSON.stringify({ data }) },
  );

export const updateCalendarEvent = (
  eventId: string,
  data: EventJson,
  etag: string,
): Promise<EventWriteResponse> =>
  apiFetch<EventWriteResponse>(
    `/api/events/${encodeURIComponent(eventId)}`,
    { method: 'PUT', body: JSON.stringify({ data, etag }) },
  );

export const deleteCalendarEvent = (
  eventId: string,
  calendarId: string,
  etag: string,
): Promise<null> =>
  apiFetch<null>(
    `/api/events/${encodeURIComponent(eventId)}?calendarId=${encodeURIComponent(calendarId)}&etag=${encodeURIComponent(etag)}`,
    { method: 'DELETE' },
  );

export function writeResponseToCalendarEvent(r: EventWriteResponse): CalendarEvent {
  return { id: r.id, url: r.url, etag: r.etag, calendarId: r.calendarId, data: r.data };
}
