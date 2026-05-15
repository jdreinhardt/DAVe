import type { AddressBook, Calendar, Contact, CalendarEvent } from '@dave/shared';
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
