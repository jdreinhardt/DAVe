import { createRequire } from 'node:module';
import type { DAVAccount } from 'tsdav';
import type * as TsdavTypes from 'tsdav';
import type { Config } from '../config.js';
import type { SessionData } from '../services/session.js';
import type { Calendar, AddressBook, Contact, ContactJson, CalendarEvent, EventJson, TaskJson, NoteJson } from '@dave/shared';
import type { RecurrenceScope, CreateAddressBookRequest, UpdateAddressBookRequest, CreateCalendarRequest, UpdateCalendarRequest } from '@dave/shared';
import { parseVCard, serializeVCard } from './vcard.js';
import { parseIcalEvents, serializeIcalEvent, serializeIcalTask, serializeIcalJournal, injectException, addExdate, truncateRrule, updateMasterVevent, resetTaskToNeedsAction } from './ical.js';

// Node.js 22 treats tsdav.esm.js as CJS (no "type":"module" in tsdav's package.json)
// and fails to parse its ESM syntax. createRequire loads the proper CJS build instead.
const _req = createRequire(import.meta.url);
const {
  DAVClient,
  fetchCalendars: _fetchCalendars,
  fetchCalendarObjects: _fetchCalendarObjects,
  fetchVCards: _fetchVCards,
  getBasicAuthHeaders: _getBasicAuthHeaders,
  propfind: _propfind,
  syncCollection: _syncCollection,
  DAVNamespaceShort,
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
    description: str((cal as Record<string, unknown>).description, ''),
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
  const account = cardAccount(session, config);

  // Use a direct PROPFIND so we can request addressbook-description, which
  // fetchAddressBooks() does not include in its default prop set.
  const results = await _propfind({
    url: account.homeUrl ?? '',
    props: {
      [`${DAVNamespaceShort.DAV}:displayname`]: {},
      [`${DAVNamespaceShort.CALENDAR_SERVER}:getctag`]: {},
      [`${DAVNamespaceShort.DAV}:resourcetype`]: {},
      [`${DAVNamespaceShort.DAV}:sync-token`]: {},
      [`${DAVNamespaceShort.CARDDAV}:addressbook-description`]: {},
    },
    depth: '1',
    headers: authHeaders,
  });

  return (results as TsdavTypes.DAVResponse[])
    .filter((r) => {
      const rt = (r.props as Record<string, unknown> | undefined)?.resourcetype;
      return rt && typeof rt === 'object' && 'addressbook' in (rt as object);
    })
    .map((rs) => {
      const props = (rs.props ?? {}) as Record<string, unknown>;
      const rawUrl = typeof rs.href === 'string' ? rs.href : '';
      const fullUrl = new URL(rawUrl, account.rootUrl ?? config.BAIKAL_BASE_URL).href;
      return {
        id: collectionId(fullUrl),
        url: fullUrl,
        displayName: str(props.displayname, fullUrl),
        description: str(props.addressbookDescription, ''),
        color: '#6C757D',
        ctag: str(props.getctag),
        syncToken: str(props.syncToken),
      };
    });
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

/**
 * Move an event from one calendar to another, applying any edits in the same operation.
 *
 * scope=undefined / non-recurring: serialize updated ICS, PUT to new calendar, DELETE from old.
 * scope='all':  fetch raw ICS from old calendar, update master VEVENT, PUT to new, DELETE old.
 * scope='following': truncate original series in old calendar, create continuation in new calendar.
 * scope='this': moving a single exception between CalDAV calendars is not meaningful — the
 *               calendar change is silently ignored and the exception is injected into the
 *               original calendar as usual.
 */
export async function moveEvent(
  session: SessionData,
  oldCalendarId: string,
  id: string,
  data: EventJson,
  etag: string,
  scope: RecurrenceScope | undefined,
  config: Config,
): Promise<EventWriteResult> {
  const newCalendarId = data.calendarId;

  if (scope === 'this') {
    const sameCalData: EventJson = { ...data, calendarId: oldCalendarId };
    return updateEventScoped(session, oldCalendarId, id, sameCalData, etag, 'this', config);
  }

  if (scope === 'following') {
    // Truncate the original series in the old calendar; create the continuation in the new one.
    const { raw, etag: freshEtag } = await fetchRawEvent(session, oldCalendarId, id);
    const truncatedIcs = truncateRrule(raw, data.start, data.allDay);
    const oldUrl = calendarObjectUrl(session, oldCalendarId, id);
    const truncatedEtag = await putRawIcs(session, oldUrl, truncatedIcs, freshEtag);

    const newUid = crypto.randomUUID();
    const continuationData: EventJson = { ...data, uid: newUid, calendarId: newCalendarId, recurrenceId: null };
    const continuationResult = await createEvent(session, newCalendarId, continuationData, config);

    const result: EventWriteResult & { continuation?: EventWriteResult } = {
      id,
      url: oldUrl,
      etag: truncatedEtag,
      calendarId: oldCalendarId,
      data: { ...data, uid: data.uid },
      continuation: continuationResult,
    };
    return result;
  }

  if (scope === 'all') {
    // Fetch raw from old calendar, rewrite master VEVENT, PUT to new calendar, then DELETE old.
    const masterData: EventJson = { ...data, calendarId: newCalendarId, recurrenceId: null };
    const { raw, etag: freshEtag } = await fetchRawEvent(session, oldCalendarId, id);
    const updatedIcs = updateMasterVevent(raw, masterData);
    const newUrl = calendarObjectUrl(session, newCalendarId, id);
    const putRes = await fetch(newUrl, {
      method: 'PUT',
      headers: {
        ...basicAuthHeader(session),
        'Content-Type': 'text/calendar; charset=utf-8',
        'If-None-Match': '*',
      },
      body: updatedIcs,
    });
    if (!putRes.ok) {
      const body = await putRes.text().catch(() => '');
      throw Object.assign(new Error(`PUT failed: ${putRes.status}`), { statusCode: putRes.status, body });
    }
    const newEtag = putRes.headers.get('ETag') ?? freshEtag;
    await deleteEvent(session, oldCalendarId, id, freshEtag, config);
    return { id, url: newUrl, etag: newEtag, calendarId: newCalendarId, data: masterData };
  }

  // Non-recurring: serialize updated event, PUT to new calendar, DELETE from old.
  const eventData: EventJson = { ...data, calendarId: newCalendarId, recurrenceId: null };
  const icsStr = serializeIcalEvent(eventData);
  const newUrl = calendarObjectUrl(session, newCalendarId, id);
  const putRes = await fetch(newUrl, {
    method: 'PUT',
    headers: {
      ...basicAuthHeader(session),
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-None-Match': '*',
    },
    body: icsStr,
  });
  if (!putRes.ok) {
    const body = await putRes.text().catch(() => '');
    throw Object.assign(new Error(`PUT failed: ${putRes.status}`), { statusCode: putRes.status, body });
  }
  const newEtag = putRes.headers.get('ETag') ?? etag;
  await deleteEvent(session, oldCalendarId, id, etag, config);
  return { id, url: newUrl, etag: newEtag, calendarId: newCalendarId, data: eventData };
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

// ── Collection management (create / update / delete) ──────────────────────────

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Apple CalDAV color format is #RRGGBBAA; append full-opacity alpha if needed.
function toCalendarColor(hex: string): string {
  const h = hex.startsWith('#') ? hex : `#${hex}`;
  return h.length === 7 ? `${h}FF` : h;
}

export async function createAddressBook(
  session: SessionData,
  req: CreateAddressBookRequest,
  _config: Config,
): Promise<{ id: string; url: string }> {
  const slug = crypto.randomUUID().replace(/-/g, '');
  const url = `${session.addressBookHomeUrl.replace(/\/$/, '')}/${slug}/`;

  const descXml = req.description
    ? `<C:addressbook-description>${escapeXml(req.description)}</C:addressbook-description>`
    : '';

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<D:mkcol xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:set>
    <D:prop>
      <D:resourcetype><D:collection/><C:addressbook/></D:resourcetype>
      <D:displayname>${escapeXml(req.displayName)}</D:displayname>
      ${descXml}
    </D:prop>
  </D:set>
</D:mkcol>`;

  const res = await fetch(url, {
    method: 'MKCOL',
    headers: { ...basicAuthHeader(session), 'Content-Type': 'application/xml; charset=utf-8' },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`MKCOL failed: ${res.status}`), { statusCode: res.status, body: text });
  }

  return { id: slug, url };
}

export async function updateAddressBook(
  session: SessionData,
  id: string,
  req: UpdateAddressBookRequest,
  _config: Config,
): Promise<void> {
  const url = `${session.addressBookHomeUrl.replace(/\/$/, '')}/${id}/`;
  const descXml = req.description !== undefined
    ? `<C:addressbook-description>${escapeXml(req.description)}</C:addressbook-description>`
    : '';

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:set>
    <D:prop>
      <D:displayname>${escapeXml(req.displayName)}</D:displayname>
      ${descXml}
    </D:prop>
  </D:set>
</D:propertyupdate>`;

  const res = await fetch(url, {
    method: 'PROPPATCH',
    headers: { ...basicAuthHeader(session), 'Content-Type': 'application/xml; charset=utf-8' },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`PROPPATCH failed: ${res.status}`), { statusCode: res.status, body: text });
  }
}

export async function deleteAddressBook(
  session: SessionData,
  id: string,
  _config: Config,
): Promise<void> {
  const url = `${session.addressBookHomeUrl.replace(/\/$/, '')}/${id}/`;
  const res = await fetch(url, { method: 'DELETE', headers: basicAuthHeader(session) });

  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`DELETE failed: ${res.status}`), { statusCode: res.status, body: text });
  }
}

export async function createCalendar(
  session: SessionData,
  req: CreateCalendarRequest,
  _config: Config,
): Promise<{ id: string; url: string }> {
  const slug = crypto.randomUUID().replace(/-/g, '');
  const url = `${session.calendarHomeUrl.replace(/\/$/, '')}/${slug}/`;

  const descXml = req.description
    ? `<C:calendar-description>${escapeXml(req.description)}</C:calendar-description>`
    : '';
  const components = (req.components.length > 0 ? req.components : ['VEVENT'])
    .map((c) => `<C:comp name="${escapeXml(c)}"/>`)
    .join('');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<C:mkcalendar xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:" xmlns:A="http://apple.com/ns/ical/">
  <D:set>
    <D:prop>
      <D:displayname>${escapeXml(req.displayName)}</D:displayname>
      ${descXml}
      <C:supported-calendar-component-set>${components}</C:supported-calendar-component-set>
      <A:calendar-color>${escapeXml(toCalendarColor(req.color))}</A:calendar-color>
    </D:prop>
  </D:set>
</C:mkcalendar>`;

  const res = await fetch(url, {
    method: 'MKCALENDAR',
    headers: { ...basicAuthHeader(session), 'Content-Type': 'application/xml; charset=utf-8' },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`MKCALENDAR failed: ${res.status}`), { statusCode: res.status, body: text });
  }

  return { id: slug, url };
}

export async function updateCalendar(
  session: SessionData,
  id: string,
  req: UpdateCalendarRequest,
  _config: Config,
): Promise<void> {
  const url = `${session.calendarHomeUrl.replace(/\/$/, '')}/${id}/`;
  const descXml = req.description !== undefined
    ? `<C:calendar-description>${escapeXml(req.description)}</C:calendar-description>`
    : '';

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/">
  <D:set>
    <D:prop>
      <D:displayname>${escapeXml(req.displayName)}</D:displayname>
      ${descXml}
      <A:calendar-color>${escapeXml(toCalendarColor(req.color))}</A:calendar-color>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

  const res = await fetch(url, {
    method: 'PROPPATCH',
    headers: { ...basicAuthHeader(session), 'Content-Type': 'application/xml; charset=utf-8' },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`PROPPATCH failed: ${res.status}`), { statusCode: res.status, body: text });
  }
}

export async function deleteCalendar(
  session: SessionData,
  id: string,
  _config: Config,
): Promise<void> {
  const url = `${session.calendarHomeUrl.replace(/\/$/, '')}/${id}/`;
  const res = await fetch(url, { method: 'DELETE', headers: basicAuthHeader(session) });

  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`DELETE failed: ${res.status}`), { statusCode: res.status, body: text });
  }
}

// ── Incremental sync via sync-collection REPORT ───────────────────────────────

export interface AddressBookSyncResult {
  syncToken: string;
  changed: Contact[];
  deleted: string[];
}

export interface CalendarSyncResult {
  syncToken: string;
  dirty: boolean;
}

// Extract the new sync-token from a tsdav sync-collection REPORT response.
// tsdav puts it at result[n].raw.multistatus.syncToken for the response that
// carries the root <D:multistatus> element.
function extractSyncToken(results: TsdavTypes.DAVResponse[]): string | undefined {
  for (const r of results) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = (r as any).raw?.multistatus?.syncToken;
    if (token) return String(token);
  }
  return undefined;
}

export async function syncAddressBook(
  session: SessionData,
  abId: string,
  currentSyncToken: string,
  _config: Config,
): Promise<AddressBookSyncResult> {
  const homeUrl = session.addressBookHomeUrl.replace(/\/$/, '');
  const abUrl = `${homeUrl}/${abId}/`;
  const authHeaders = _getBasicAuthHeaders({ username: session.username, password: session.password });

  const results = await _syncCollection({
    url: abUrl,
    props: { [`${DAVNamespaceShort.DAV}:getetag`]: {} },
    syncLevel: 1,
    syncToken: currentSyncToken,
    headers: authHeaders,
  });

  const newSyncToken = extractSyncToken(results) ?? currentSyncToken;

  const changedHrefs = results.filter((r) => r.ok && r.href).map((r) => r.href as string);
  const deletedHrefs = results.filter((r) => r.status === 404 && r.href).map((r) => r.href as string);
  const deleted = deletedHrefs.map(contactId);

  let changed: Contact[] = [];
  if (changedHrefs.length > 0) {
    const vcards = await _fetchVCards({
      addressBook: { url: abUrl },
      objectUrls: changedHrefs,
      headers: authHeaders,
    });
    changed = vcards
      .filter((v) => v.data)
      .map((v) => ({
        id: contactId(v.url),
        url: v.url,
        etag: v.etag ?? '',
        addressBookId: abId,
        data: parseVCard(v.data as string),
      }));
  }

  return { syncToken: newSyncToken, changed, deleted };
}

export async function syncCalendar(
  session: SessionData,
  calId: string,
  currentSyncToken: string,
  _config: Config,
): Promise<CalendarSyncResult> {
  const calUrl = `${session.calendarHomeUrl.replace(/\/$/, '')}/${calId}/`;
  const authHeaders = _getBasicAuthHeaders({ username: session.username, password: session.password });

  const results = await _syncCollection({
    url: calUrl,
    props: { [`${DAVNamespaceShort.DAV}:getetag`]: {} },
    syncLevel: 1,
    syncToken: currentSyncToken,
    headers: authHeaders,
  });

  const newSyncToken = extractSyncToken(results) ?? currentSyncToken;
  const dirty = results.some((r) => (r.ok && r.href) || r.status === 404);

  return { syncToken: newSyncToken, dirty };
}

// ── Cache sync helpers ────────────────────────────────────────────────────────

export interface CalendarObjectRaw {
  url: string;
  etag: string;
  rawIcs: string;
}

export interface CalendarCacheSyncResult {
  syncToken: string;
  changed: CalendarObjectRaw[];
  deleted: string[]; // resolved absolute URLs of deleted objects
}

/**
 * Fetch every calendar object in a collection (no time-range filter).
 * Used for the initial cache population of VTODO/VJOURNAL collections.
 */
export async function fetchAllCalendarObjects(
  session: SessionData,
  calUrl: string,
  _config: Config,
  componentType: 'VTODO' | 'VJOURNAL' = 'VTODO',
): Promise<CalendarObjectRaw[]> {
  const authHeaders = _getBasicAuthHeaders({ username: session.username, password: session.password });
  const objects = await _fetchCalendarObjects({
    calendar: { url: calUrl },
    headers: authHeaders,
    filters: [
      {
        'comp-filter': {
          _attributes: { name: 'VCALENDAR' },
          'comp-filter': { _attributes: { name: componentType } },
        },
      },
    ],
  });
  return objects
    .filter((obj: TsdavTypes.DAVCalendarObject) => obj.data)
    .map((obj: TsdavTypes.DAVCalendarObject) => ({
      url: obj.url,
      etag: obj.etag ?? '',
      rawIcs: obj.data as string,
    }));
}

/**
 * Incremental sync via sync-collection REPORT.
 * Unlike syncCalendar(), this also fetches the bodies of changed objects
 * so the cache can be updated without a second round-trip.
 */
export async function syncCalendarForCache(
  session: SessionData,
  calUrl: string,
  currentSyncToken: string,
  _config: Config,
): Promise<CalendarCacheSyncResult> {
  const authHeaders = _getBasicAuthHeaders({ username: session.username, password: session.password });

  const results = await _syncCollection({
    url: calUrl,
    props: { [`${DAVNamespaceShort.DAV}:getetag`]: {} },
    syncLevel: 1,
    syncToken: currentSyncToken,
    headers: authHeaders,
  });

  const newSyncToken = extractSyncToken(results) ?? currentSyncToken;
  const changedHrefs = results.filter((r) => r.ok && r.href).map((r) => r.href as string);
  const deletedHrefs = results.filter((r) => r.status === 404 && r.href).map((r) => r.href as string);

  // Resolve relative hrefs to absolute URLs so they match what is stored in the cache.
  const resolveHref = (href: string): string => {
    try { return new URL(href, calUrl).href; } catch { return href; }
  };
  const deleted = deletedHrefs.map(resolveHref);

  let changed: CalendarObjectRaw[] = [];
  if (changedHrefs.length > 0) {
    const objects = await _fetchCalendarObjects({
      calendar: { url: calUrl },
      objectUrls: changedHrefs,
      headers: authHeaders,
    });
    changed = objects
      .filter((obj: TsdavTypes.DAVCalendarObject) => obj.data)
      .map((obj: TsdavTypes.DAVCalendarObject) => ({
        url: obj.url,
        etag: obj.etag ?? '',
        rawIcs: obj.data as string,
      }));
  }

  return { syncToken: newSyncToken, changed, deleted };
}

// ── Task write operations ─────────────────────────────────────────────────────

export interface TaskWriteResult {
  uid: string;
  url: string;
  etag: string;
  collectionUrl: string;
  rawIcs: string;
}

export async function createTask(
  session: SessionData,
  collectionUrl: string,
  data: TaskJson,
): Promise<TaskWriteResult> {
  const uid = data.uid || crypto.randomUUID();
  const taskData: TaskJson = { ...data, uid };
  const icsStr = serializeIcalTask(taskData);
  const url = `${collectionUrl.replace(/\/$/, '')}/${uid}.ics`;

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
  return { uid, url, etag, collectionUrl, rawIcs: icsStr };
}

export async function updateTask(
  session: SessionData,
  objectUrl: string,
  collectionUrl: string,
  data: TaskJson,
  etag: string,
  rawIcs: string,
): Promise<TaskWriteResult> {
  const updatedIcs = serializeIcalTask(data, rawIcs);

  const res = await fetch(objectUrl, {
    method: 'PUT',
    headers: {
      ...basicAuthHeader(session),
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-Match': etag,
    },
    body: updatedIcs,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`PUT failed: ${res.status}`), { statusCode: res.status, body });
  }

  const newEtag = res.headers.get('ETag') ?? etag;
  return { uid: data.uid, url: objectUrl, etag: newEtag, collectionUrl, rawIcs: updatedIcs };
}

export async function deleteTask(
  session: SessionData,
  objectUrl: string,
  etag: string,
): Promise<void> {
  const res = await fetch(objectUrl, {
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

// ── Baikal archive search ─────────────────────────────────────────────────────

/**
 * Fetch VTODO objects whose COMPLETED timestamp falls strictly between the
 * retention window and the max archive age — i.e. tasks that have been evicted
 * from the local cache but are still within the Baikal search cap.
 *
 * time-range start = now - BAIKAL_ARCHIVE_SEARCH_MAX_AGE_DAYS  (oldest to fetch)
 * time-range end   = now - COMPLETED_TASK_RETENTION_DAYS       (exclude still-cached tasks)
 *
 * Per-collection failures are caught and logged so one bad collection
 * doesn't abort the entire search.
 */
export async function fetchArchivedCompletedTasks(
  session: SessionData,
  collectionUrls: string[],
  config: Config,
): Promise<CalendarObjectRaw[]> {
  const authHeaders = basicAuthHeader(session);
  const toIso = (ms: number): string =>
    new Date(ms).toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';

  // Oldest tasks to include
  const startStr = toIso(Date.now() - config.BAIKAL_ARCHIVE_SEARCH_MAX_AGE_DAYS * 86_400_000);
  // Exclude tasks still within the retention window (they're in the local cache)
  const endStr = toIso(Date.now() - config.COMPLETED_TASK_RETENTION_DAYS * 86_400_000);

  const results: CalendarObjectRaw[] = [];
  for (const calUrl of collectionUrls) {
    try {
      const objects = await _fetchCalendarObjects({
        calendar: { url: calUrl },
        headers: authHeaders,
        filters: [
          {
            'comp-filter': {
              _attributes: { name: 'VCALENDAR' },
              'comp-filter': {
                _attributes: { name: 'VTODO' },
                'prop-filter': {
                  _attributes: { name: 'COMPLETED' },
                  'time-range': { _attributes: { start: startStr, end: endStr } },
                },
              },
            },
          },
        ],
      });
      for (const obj of objects as TsdavTypes.DAVCalendarObject[]) {
        if (obj.data) {
          results.push({ url: obj.url, etag: obj.etag ?? '', rawIcs: obj.data as string });
        }
      }
    } catch (err) {
      console.warn(`fetchArchivedCompletedTasks: collection ${calUrl} failed`, err);
    }
  }
  return results;
}

/**
 * Fetch VEVENT objects from the given calendar collections within ±rangeDays of
 * today. Used by the global search endpoint to search calendar events.
 *
 * Each collection failure is caught individually so one bad calendar doesn't
 * abort the entire search. The caller is responsible for text-filtering and
 * capping results.
 */
export async function fetchEventsForSearch(
  session: SessionData,
  calendars: Array<{ id: string; url: string }>,
  rangeDays: number,
): Promise<Array<{ url: string; etag: string; rawIcs: string; calendarId: string }>> {
  const authHeaders = basicAuthHeader(session);
  const toIso = (ms: number): string =>
    new Date(ms).toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';

  const now = Date.now();
  const startStr = toIso(now - rangeDays * 86_400_000);
  const endStr = toIso(now + rangeDays * 86_400_000);

  const results: Array<{ url: string; etag: string; rawIcs: string; calendarId: string }> = [];
  for (const cal of calendars) {
    try {
      const objects = await _fetchCalendarObjects({
        calendar: { url: cal.url },
        headers: authHeaders,
        filters: [
          {
            'comp-filter': {
              _attributes: { name: 'VCALENDAR' },
              'comp-filter': {
                _attributes: { name: 'VEVENT' },
                'time-range': { _attributes: { start: startStr, end: endStr } },
              },
            },
          },
        ],
      });
      for (const obj of objects as TsdavTypes.DAVCalendarObject[]) {
        if (obj.data) {
          results.push({ url: obj.url, etag: obj.etag ?? '', rawIcs: obj.data as string, calendarId: cal.id });
        }
      }
    } catch (err) {
      console.warn(`fetchEventsForSearch: collection ${cal.url} failed`, err);
    }
  }
  return results;
}

/**
 * Restore an archived completed task: GET the current ICS from Baikal,
 * reset STATUS to NEEDS-ACTION, clear COMPLETED and PERCENT-COMPLETE,
 * then PUT it back. Returns the TaskWriteResult for the caller to cache.
 */
export async function restoreArchivedTask(
  session: SessionData,
  objectUrl: string,
  collectionUrl: string,
  etag: string,
): Promise<TaskWriteResult> {
  const authHeaders = basicAuthHeader(session);

  // Fetch latest ICS (in case it changed since the search was run)
  const getRes = await fetch(objectUrl, { headers: authHeaders });
  if (!getRes.ok) {
    throw Object.assign(new Error(`GET failed: ${getRes.status}`), { statusCode: getRes.status });
  }
  const rawIcs = await getRes.text();
  const currentEtag = getRes.headers.get('ETag') ?? etag;

  const restoredIcs = resetTaskToNeedsAction(rawIcs);

  const putRes = await fetch(objectUrl, {
    method: 'PUT',
    headers: {
      ...authHeaders,
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-Match': currentEtag,
    },
    body: restoredIcs,
  });

  if (!putRes.ok) {
    const body = await putRes.text().catch(() => '');
    throw Object.assign(new Error(`PUT failed: ${putRes.status}`), { statusCode: putRes.status, body });
  }

  const newEtag = putRes.headers.get('ETag') ?? currentEtag;

  // Extract UID with a simple regex — UUIDs never fold across lines.
  const uidMatch = restoredIcs.match(/^UID:(.+)$/m);
  const uid = uidMatch?.[1]?.trim() ?? '';

  return { uid, url: objectUrl, etag: newEtag, collectionUrl, rawIcs: restoredIcs };
}

// ── Journal (VJOURNAL) write operations ───────────────────────────────────────

export interface JournalWriteResult {
  uid: string;
  url: string;
  etag: string;
  collectionUrl: string;
  rawIcs: string;
}

export async function createJournal(
  session: SessionData,
  collectionUrl: string,
  data: NoteJson,
): Promise<JournalWriteResult> {
  const uid = data.uid || crypto.randomUUID();
  const entryData: NoteJson = { ...data, uid };
  const icsStr = serializeIcalJournal(entryData);
  const url = `${collectionUrl.replace(/\/$/, '')}/${uid}.ics`;

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
  return { uid, url, etag, collectionUrl, rawIcs: icsStr };
}

export async function updateJournal(
  session: SessionData,
  objectUrl: string,
  collectionUrl: string,
  data: NoteJson,
  etag: string,
  rawIcs: string,
): Promise<JournalWriteResult> {
  const updatedIcs = serializeIcalJournal(data, rawIcs);

  const res = await fetch(objectUrl, {
    method: 'PUT',
    headers: {
      ...basicAuthHeader(session),
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-Match': etag,
    },
    body: updatedIcs,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`PUT failed: ${res.status}`), { statusCode: res.status, body });
  }

  const newEtag = res.headers.get('ETag') ?? etag;
  return { uid: data.uid, url: objectUrl, etag: newEtag, collectionUrl, rawIcs: updatedIcs };
}

export async function deleteJournal(
  session: SessionData,
  objectUrl: string,
  etag: string,
): Promise<void> {
  const res = await fetch(objectUrl, {
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

// PUT existing raw ICS content into a new collection URL (used for cascade moves).
export async function createTaskRaw(
  session: SessionData,
  collectionUrl: string,
  uid: string,
  rawIcs: string,
): Promise<{ url: string; etag: string; collectionUrl: string }> {
  const url = `${collectionUrl.replace(/\/$/, '')}/${uid}.ics`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      ...basicAuthHeader(session),
      'Content-Type': 'text/calendar; charset=utf-8',
      'If-None-Match': '*',
    },
    body: rawIcs,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`PUT failed: ${res.status}`), { statusCode: res.status, body });
  }

  const etag = res.headers.get('ETag') ?? `"${uid}"`;
  return { url, etag, collectionUrl };
}
