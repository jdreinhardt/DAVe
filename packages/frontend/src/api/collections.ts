import type { AddressBook, Calendar } from '@dave/shared';
import { apiFetch } from './client';

export const getAddressBooks = (): Promise<AddressBook[]> =>
  apiFetch<AddressBook[]>('/api/addressbooks');

export const getCalendars = (): Promise<Calendar[]> =>
  apiFetch<Calendar[]>('/api/calendars');
