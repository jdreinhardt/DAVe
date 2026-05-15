import type { AddressBook, Calendar, Contact } from '@dave/shared';
import { apiFetch } from './client';

export const getAddressBooks = (): Promise<AddressBook[]> =>
  apiFetch<AddressBook[]>('/api/addressbooks');

export const getCalendars = (): Promise<Calendar[]> =>
  apiFetch<Calendar[]>('/api/calendars');

export const getContacts = (addressBookId: string): Promise<Contact[]> =>
  apiFetch<Contact[]>(`/api/addressbooks/${encodeURIComponent(addressBookId)}/contacts`);
