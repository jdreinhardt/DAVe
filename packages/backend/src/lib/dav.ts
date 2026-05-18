import { createRequire } from 'node:module';
import type { DAVAccount } from 'tsdav';
import type * as TsdavTypes from 'tsdav';
import type { Config } from '../config.js';
import type { SessionData } from '../services/session.js';
import type { Calendar, AddressBook, Contact, ContactJson, CalendarEvent, EventJson } from '@dave/shared';
import type { RecurrenceScope } from '@dave/shared';
import { parseVCard, serializeVCard } from './vcard.js';
import { parseIcalEvents, serializeIcalEvent, injectException, addExdate, truncateRrule, updateMasterVevent } from './ical.js';

// Node.js 22 treats tsdav.esm.js as CJS (no "type":"module" in tsdav's package.json)
// and fails to parse its ESM syntax. createRequire loads the proper CJS build instead.
const _req = createRequire(import.meta.url);
const {
  DAVClient,
  fetchAddressBooks: _fetchAddressBooks,
  fetchCalendars: _fetchCalendars,
  fetchCalendarObjects: _fetchCalendarObjects,
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

// ── Calendar event fetching ───────────────────────────────────────────────────

function calendarObjectId(url: string): string {
  try {
    const seg = new URL(url).pathname.replace(/\/$/, '').split('/').filter(Boolean);
    const last = seg[seg.length - 1] ?? url;
    return last.replace(/\.ics$/i, '');
  } catch {
    return url;
  }
}

export async function fetchEvents(
  session: SessionData,
  calendarId: string,
  start: string,
  end: string,
  _config: Config,
): Promise<CalendarEvent[]> {
  const calUrl = `${session.calendarHomeUrl.replace(/\/$/, '')}/${calendarId}/`;
  const authHeaders = _getBasicAuthHeaders({ username: session.username, password: session.password });

  const objects = await _fetchCalendarObjects({
    calendar: { url: calUrl },
    timeRange: { start, end },
    headers: authHeaders,
  });

  return objects
    .filter((obj: TsdavTypes.DAVCalendarObject) => obj.data)
    .flatMap((obj: TsdavTypes.DAVCalendarObject) => {
      const events = parseIcalEvents(obj.data as string, calendarId, start, end);
      return events.map((eventData) => ({
        id: calendarObjectId(obj.url),
        url: obj.url,
        etag: obj.etag ?? '',
        calendarId,
        data: eventData,
      }));
    });
}

// ── Calendar event write operations ───────────────────────────────────────────

function calendarUrl(session: SessionData, calendarId: string): string {
  return `${session.calendarHomeUrl.replace(/\/$/, '')}/${calendarId}/`;
}

function calendarObjectUrl(session: SessionData, calendarId: string, uid: string): string {
  return `${calendarUrl(session, calendarId)}${uid}.ics`;
}

export interface EventWriteResult {
  id: string;
  url: string;
  etag: string;
  calendarId: string;
  data: EventJson;
}

export async function createEvent(
  session: SessionData,
  calendarId: string,
  data: EventJson,
  _config: Config,
): Promise<EventWriteResult> {
  const uid = data.uid || crypto.randomUUID();
  const eventData: EventJson = { ...data, uid, calendarId };
  const icsStr = serializeIcalEvent(eventData);
  const url = calendarObjectUrl(session, calendarId, uid);

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      ...basicAuthHeader(session),
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-None-Match': '*',
    },
    body: icsStr,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`PUT failed: ${res.status}`), { statusCode: res.status, body });
  }

  const etag = res.headers.get('ETag') ?? `"${uid}"`;
  return { id: uid, url, etag, calendarId, data: eventData };
}

export async function updateEvent(
  session: SessionData,
  calendarId: string,
  id: string,
  data: EventJson,
  etag: string,
  _config: Config,
): Promise<EventWriteResult> {
  // Strip recurrenceId — a master VEVENT must never carry RECURRENCE-ID.
  const eventData: EventJson = { ...data, calendarId, recurrenceId: null };
  const icsStr = serializeIcalEvent(eventData);
  const url = calendarObjectUrl(session, calendarId, id);

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      ...basicAuthHeader(session),
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-Match': etag,
    },
    body: icsStr,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`PUT failed: ${res.status}`), { statusCode: res.status, body });
  }

  const newEtag = res.headers.get('ETag') ?? etag;
  return { id, url, etag: newEtag, calendarId, data: eventData };
}

export async function deleteEvent(
  session: SessionData,
  calendarId: string,
  id: string,
  etag: string,
  _config: Config,
): Promise<void> {
  const url = calendarObjectUrl(session, calendarId, id);

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

// ── Recurring-aware write helpers ─────────────────────────────────────────────

async function fetchRawEvent(
  session: SessionData,
  calendarId: string,
  id: string,
): Promise<{ raw: string; etag: string }> {
  const url = calendarObjectUrl(session, calendarId, id);
  const res = await fetch(url, { headers: basicAuthHeader(session) });
  if (!res.ok) {
    throw Object.assign(new Error(`GET failed: ${res.status}`), { statusCode: res.status });
  }
  const raw = await res.text();
  const etag = res.headers.get('ETag') ?? '';
  return { raw, etag };
}

async function putRawIcs(
  session: SessionData,
  url: string,
  ics: string,
  etag: string,
): Promise<string> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      ...basicAuthHeader(session),
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-Match': etag,
    },
    body: ics,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`PUT failed: ${res.status}`), { statusCode: res.status, body });
  }
  return res.headers.get('ETag') ?? etag;
}

/**
 * Update a (possibly recurring) event with a recurrence scope.
 *
 * scope="all"       → rewrite the master VEVENT (existing behavior).
 * scope="this"      → inject a RECURRENCE-ID exception into the existing ICS.
 * scope="following" → truncate the original series at this occurrence and
 *                     create a new master event continuing from this point.
 */
export async function updateEventScoped(
  session: SessionData,
  calendarId: string,
  id: string,
  data: EventJson,
  etag: string,
  scope: RecurrenceScope,
  _config: Config,
): Promise<EventWriteResult> {
  const url = calendarObjectUrl(session, calendarId, id);

  if (scope === 'all') {
    // Fetch the raw ICS so we can preserve existing exception VEVENTs (unless
    // the RRULE changes, in which case updateMasterVevent clears them).
    const masterData: EventJson = { ...data, recurrenceId: null };
    const { raw, etag: freshEtag } = await fetchRawEvent(session, calendarId, id);
    const updatedIcs = updateMasterVevent(raw, masterData);
    const newEtag = await putRawIcs(session, url, updatedIcs, freshEtag);
    return { id, url, etag: newEtag, calendarId, data: masterData };
  }

  if (scope === 'this') {
    const { raw, etag: freshEtag } = await fetchRawEvent(session, calendarId, id);
    const modifiedIcs = injectException(raw, data);
    const newEtag = await putRawIcs(session, url, modifiedIcs, freshEtag);
    return { id, url, etag: newEtag, calendarId, data };
  }

  // scope === 'following'
  // 1. Truncate the original series
  const { raw, etag: freshEtag } = await fetchRawEvent(session, calendarId, id);
  const truncatedIcs = truncateRrule(raw, data.start, data.allDay);
  const newEtag = await putRawIcs(session, url, truncatedIcs, freshEtag);

  // 2. Create a new event starting from this occurrence
  const newUid = crypto.randomUUID();
  const newData: EventJson = { ...data, uid: newUid, recurrenceId: null };
  const continuationResult = await createEvent(session, calendarId, newData, _config);

  const result: EventWriteResult & { continuation?: EventWriteResult } = {
    id,
    url,
    etag: newEtag,
    calendarId,
    data: { ...data, uid: data.uid },
    continuation: continuationResult,
  };
  return result;
}

/**
 * Delete a (possibly recurring) event with a recurrence scope.
 *
 * scope="all"       → DELETE the entire ICS resource (existing behavior).
 * scope="this"      → add EXDATE to master and PUT back.
 * scope="following" → truncate the series at this occurrence and PUT back.
 */
export async function deleteEventScoped(
  session: SessionData,
  calendarId: string,
  id: string,
  etag: string,
  scope: RecurrenceScope,
  occurrenceIso: string,
  allDay: boolean,
  _config: Config,
): Promise<void> {
  if (scope === 'all') {
    await deleteEvent(session, calendarId, id, etag, _config);
    return;
  }

  const { raw, etag: freshEtag } = await fetchRawEvent(session, calendarId, id);
  const url = calendarObjectUrl(session, calendarId, id);

  let modifiedIcs: string;
  if (scope === 'this') {
    modifiedIcs = addExdate(raw, occurrenceIso, allDay);
  } else {
    // following
    modifiedIcs = truncateRrule(raw, occurrenceIso, allDay);
  }

  await putRawIcs(session, url, modifiedIcs, freshEtag);
}
