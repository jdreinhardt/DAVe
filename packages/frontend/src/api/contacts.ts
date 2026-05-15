import type {
  Contact,
  ContactJson,
  ContactWriteResponse,
  ImportContactsResponse,
} from '@dave/shared';
import { apiFetch } from './client';

export const createContact = (
  addressBookId: string,
  data: ContactJson,
): Promise<ContactWriteResponse> =>
  apiFetch<ContactWriteResponse>(
    `/api/addressbooks/${encodeURIComponent(addressBookId)}/contacts`,
    { method: 'POST', body: JSON.stringify({ data }) },
  );

export const updateContact = (
  addressBookId: string,
  contactId: string,
  data: ContactJson,
  etag: string,
): Promise<ContactWriteResponse> =>
  apiFetch<ContactWriteResponse>(
    `/api/addressbooks/${encodeURIComponent(addressBookId)}/contacts/${encodeURIComponent(contactId)}`,
    { method: 'PUT', body: JSON.stringify({ data, etag }) },
  );

export const deleteContact = (
  addressBookId: string,
  contactId: string,
  etag: string,
): Promise<null> =>
  apiFetch<null>(
    `/api/addressbooks/${encodeURIComponent(addressBookId)}/contacts/${encodeURIComponent(contactId)}?etag=${encodeURIComponent(etag)}`,
    { method: 'DELETE' },
  );

export const importContacts = (
  addressBookId: string,
  vcf: string,
): Promise<ImportContactsResponse> =>
  apiFetch<ImportContactsResponse>(
    `/api/addressbooks/${encodeURIComponent(addressBookId)}/import`,
    { method: 'POST', body: JSON.stringify({ vcf }) },
  );

export const exportContactsUrl = (addressBookId: string, ids?: string[]): string => {
  const base = `/api/addressbooks/${encodeURIComponent(addressBookId)}/export`;
  if (ids && ids.length > 0) return `${base}?ids=${ids.map(encodeURIComponent).join(',')}`;
  return base;
};

// Helper to convert a ContactWriteResponse to a Contact shape for cache updates.
export function writeResponseToContact(r: ContactWriteResponse): Contact {
  return { id: r.id, url: r.url, etag: r.etag, addressBookId: r.addressBookId, data: r.data };
}
