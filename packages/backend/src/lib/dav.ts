import { createRequire } from 'node:module';
import type { DAVAccount } from 'tsdav';
import type * as TsdavTypes from 'tsdav';
import type { Config } from '../config.js';
import type { SessionData } from '../services/session.js';
import type { Calendar, AddressBook, Contact, ContactJson } from '@dave/shared';
import { parseVCard, serializeVCard } from './vcard.js';

// Node.js 22 treats tsdav.esm.js as CJS (no "type":"module" in tsdav's package.json)
// and fails to parse its ESM syntax. createRequire loads the proper CJS build instead.
const _req = createRequire(import.meta.url);
const {
  DAVClient,
  fetchAddressBooks: _fetchAddressBooks,
  fetchCalendars: _fetchCalendars,
  fetchVCards: _fetchVCards,
  getBasicAuthHeaders: _getBasicAuthHeaders,
} = _req('tsdav') as typeof TsdavTypes;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Coerce a tsdav displayName (can be string or object with a #text key) to string.
function str(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    if (typeof o['#text'] === 'string') return o['#text'];
    if (typeof o['_'] === 'string') return o['_'];
  }
  return fallback;
}

function collectionId(url: string): string {
  try {
    const seg = new URL(url).pathname.replace(/\/$/, '').split('/').filter(Boolean);
    return seg[seg.length - 1] ?? url;
  } catch {
    return url;
  }
}

// ── Login / discovery ─────────────────────────────────────────────────────────

export interface DiscoveryResult {
  principalUrl: string;
  calendarHomeUrl: string;
  addressBookHomeUrl: string;
  displayName: string;
}

export async function discoverAndValidate(
  username: string,
  password: string,
  config: Config,
): Promise<DiscoveryResult> {
  const creds = { username, password };

  // Two clients are needed because tsdav's homeUrl resolves to the matching
  // home set based on accountType (caldav → calendar-home-set,
  // carddav → addressbook-home-set).
  const calClient = new DAVClient({
    serverUrl: config.BAIKAL_BASE_URL,
    credentials: creds,
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
  const cardClient = new DAVClient({
    serverUrl: config.BAIKAL_BASE_URL,
    credentials: creds,
    authMethod: 'Basic',
    defaultAccountType: 'carddav',
  });

  await Promise.all([calClient.login(), cardClient.login()]);

  return {
    principalUrl: calClient.account?.principalUrl ?? '',
    calendarHomeUrl: calClient.account?.homeUrl ?? '',
    addressBookHomeUrl: cardClient.account?.homeUrl ?? '',
    displayName: username,
  };
}

// ── Collection listing ────────────────────────────────────────────────────────

function calAccount(session: SessionData, config: Config): DAVAccount {
  return {
    accountType: 'caldav',
    serverUrl: config.BAIKAL_BASE_URL,
    rootUrl: config.BAIKAL_BASE_URL,
    credentials: { username: session.username, password: session.password },
    principalUrl: session.principalUrl,
    homeUrl: session.calendarHomeUrl,
  };
}

function cardAccount(session: SessionData, config: Config): DAVAccount {
  return {
    accountType: 'carddav',
    serverUrl: config.BAIKAL_BASE_URL,
    rootUrl: config.BAIKAL_BASE_URL,
    credentials: { username: session.username, password: session.password },
    principalUrl: session.principalUrl,
    homeUrl: session.addressBookHomeUrl,
  };
}

export async function listCalendars(
  session: SessionData,
  config: Config,
): Promise<Calendar[]> {
  const authHeaders = _getBasicAuthHeaders({ username: session.username, password: session.password });
  const davCals = await _fetchCalendars({ account: calAccount(session, config), headers: authHeaders });

  return davCals.map((cal) => ({
    id: collectionId(cal.url),
    url: cal.url,
    displayName: str(cal.displayName, cal.url),
    color: str(cal.calendarColor, '#0082C9'),
    ctag: str(cal.ctag),
    syncToken: str(cal.syncToken),
    components: Array.isArray(cal.components) ? cal.components : ['VEVENT'],
    timezone: str(cal.timezone),
  }));
}

export async function listAddressBooks(
  session: SessionData,
  config: Config,
): Promise<AddressBook[]> {
  const authHeaders = _getBasicAuthHeaders({ username: session.username, password: session.password });
  const davBooks = await _fetchAddressBooks({ account: cardAccount(session, config), headers: authHeaders });

  return davBooks.map((book) => ({
    id: collectionId(book.url),
    url: book.url,
    displayName: str(book.displayName, book.url),
    color: '#6C757D',
    ctag: str(book.ctag),
    syncToken: str(book.syncToken),
  }));
}

export async function fetchContacts(
  session: SessionData,
  addressBookId: string,
  _config: Config,
): Promise<Contact[]> {
  const homeUrl = session.addressBookHomeUrl.replace(/\/$/, '');
  const addressBookUrl = `${homeUrl}/${addressBookId}/`;
  const authHeaders = _getBasicAuthHeaders({ username: session.username, password: session.password });

  const vcards = await _fetchVCards({
    addressBook: { url: addressBookUrl },
    headers: authHeaders,
  });

  return vcards
    .filter((v) => v.data)
    .map((v) => ({
      id: contactId(v.url),
      url: v.url,
      etag: v.etag ?? '',
      addressBookId,
      data: parseVCard(v.data as string),
    }));
}

function contactId(url: string): string {
  try {
    const seg = new URL(url).pathname.replace(/\/$/, '').split('/').filter(Boolean);
    const last = seg[seg.length - 1] ?? url;
    return last.replace(/\.vcf$/i, '');
  } catch {
    return url;
  }
}

// ── Contact write operations ───────────────────────────────────────────────────

function addressBookUrl(session: SessionData, addressBookId: string): string {
  return `${session.addressBookHomeUrl.replace(/\/$/, '')}/${addressBookId}/`;
}

function contactUrl(session: SessionData, addressBookId: string, id: string): string {
  return `${addressBookUrl(session, addressBookId)}${id}.vcf`;
}

function basicAuthHeader(session: SessionData): Record<string, string> {
  return _getBasicAuthHeaders({ username: session.username, password: session.password });
}

export interface ContactWriteResult {
  id: string;
  url: string;
  etag: string;
  addressBookId: string;
  data: ContactJson;
}

export async function createContact(
  session: SessionData,
  addressBookId: string,
  data: ContactJson,
  _config: Config,
): Promise<ContactWriteResult> {
  const uid = data.uid || crypto.randomUUID();
  const contactData: ContactJson = { ...data, uid };
  const vcardStr = serializeVCard(contactData);
  const url = contactUrl(session, addressBookId, uid);

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      ...basicAuthHeader(session),
      'Content-Type': 'text/vcard; charset=utf-8',
      'If-None-Match': '*',
    },
    body: vcardStr,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`PUT failed: ${res.status}`), { statusCode: res.status, body });
  }

  const etag = res.headers.get('ETag') ?? `"${uid}"`;
  return { id: uid, url, etag, addressBookId, data: contactData };
}

export async function updateContact(
  session: SessionData,
  addressBookId: string,
  id: string,
  data: ContactJson,
  etag: string,
  _config: Config,
): Promise<ContactWriteResult> {
  const vcardStr = serializeVCard(data);
  const url = contactUrl(session, addressBookId, id);

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      ...basicAuthHeader(session),
      'Content-Type': 'text/vcard; charset=utf-8',
      'If-Match': etag,
    },
    body: vcardStr,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`PUT failed: ${res.status}`), { statusCode: res.status, body });
  }

  const newEtag = res.headers.get('ETag') ?? etag;
  return { id, url, etag: newEtag, addressBookId, data };
}

export async function deleteContact(
  session: SessionData,
  addressBookId: string,
  id: string,
  etag: string,
  _config: Config,
): Promise<void> {
  const url = contactUrl(session, addressBookId, id);

  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      ...basicAuthHeader(session),
      'If-Match': etag,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`DELETE failed: ${res.status}`), { statusCode: res.status, body });
  }
}

export async function fetchRawContacts(
  session: SessionData,
  addressBookId: string,
  _config: Config,
): Promise<{ url: string; etag: string; raw: string }[]> {
  const homeUrl = session.addressBookHomeUrl.replace(/\/$/, '');
  const abUrl = `${homeUrl}/${addressBookId}/`;
  const authHeaders = _getBasicAuthHeaders({ username: session.username, password: session.password });

  const vcards = await _fetchVCards({
    addressBook: { url: abUrl },
    headers: authHeaders,
  });

  return vcards
    .filter((v) => v.data)
    .map((v) => ({ url: v.url, etag: v.etag ?? '', raw: v.data as string }));
}
