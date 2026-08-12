import { createRequire } from 'node:module';
import { xml2js } from 'xml-js';
import type { DAVAccount } from 'tsdav';
import type * as TsdavTypes from 'tsdav';
import type { Config } from '../config.js';
import type { SessionData } from '../services/session.js';
import type { DbInstance } from '../db/index.js';
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
  DAVNamespaceShort,
} = _req('tsdav') as typeof TsdavTypes;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * The configured DAV server, pinned once at startup. Every authenticated request
 * is checked against it, so this is the single source of truth for "is this URL
 * somewhere we're allowed to send the user's credentials".
 *
 * Module scope rather than a threaded parameter because `davFetch` is called from
 * ~30 places, many in helpers with no access to `Config`. Making the check a
 * property of the sink is the point: it cannot be forgotten at a call site.
 */
let davBase: URL | null = null;

/** Pin the DAV origin. Call once during bootstrap, before any DAV request. */
export function initDavBase(config: Config): void {
  davBase = new URL(config.DAV_BASE_URL);
}

/**
 * Reject any URL that isn't inside the configured DAV server.
 *
 * Checks origin *and* path prefix. Origin alone is not enough: self-hosted
 * deployments routinely put the DAV server behind a reverse proxy that also
 * serves other apps, so an origin-only check still lets a caller aim a
 * credential-bearing request at a neighbour. Verified against both test stacks —
 * Baikal serves from a path (`/dav.php`) and Radicale from the root, and every
 * discovered home set nests under its base in both.
 *
 * Fails closed when uninitialized: a missing `initDavBase` must break loudly
 * rather than silently disable the guard.
 *
 * Exported for direct testing — it is the single predicate the whole SSRF
 * defense rests on, including validation of the discovery response.
 */
export function assertDavTarget(targetUrl: string): void {
  if (!davBase) {
    throw new Error('DAV base URL not initialized — call initDavBase() during bootstrap');
  }
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw Object.assign(new Error('Invalid target URL'), { statusCode: 400 });
  }
  const basePath = davBase.pathname.replace(/\/$/, '');
  const inBasePath =
    basePath === '' || parsed.pathname === basePath || parsed.pathname.startsWith(`${basePath}/`);
  if (parsed.origin !== davBase.origin || !inBasePath) {
    throw Object.assign(new Error('Target URL is not inside the configured DAV server'), {
      statusCode: 400,
    });
  }
}

/**
 * Reject a client-supplied id that isn't a single safe path segment, then encode it.
 *
 * Collection and object ids are interpolated into URLs. Fastify percent-decodes
 * route params, so `..%2F..%2F` arrives as `../../` and `fetch` resolves it —
 * escaping the user's home set and reaching arbitrary paths on the DAV host with
 * the Authorization header attached. Encoding alone would be enough for `davFetch`,
 * but tsdav's helpers build their own requests and never reach that sink, so the
 * segment has to be made safe here at construction time.
 */
function encodeSegment(id: string): string {
  if (!id || id === '.' || id === '..' || /[/\\]/.test(id)) {
    throw Object.assign(new Error('Invalid collection or object id'), { statusCode: 400 });
  }
  return encodeURIComponent(id);
}

/**
 * All authenticated DAV requests go through this wrapper so the SSRF defense is
 * the default, not something each call site has to remember.
 *
 * `redirect: 'error'` ensures a 3xx from the DAV server is never followed —
 * otherwise the user's basic-auth Authorization header could be replayed to an
 * arbitrary redirect target. Both it and the target check are applied after the
 * caller's `init` so neither can be overridden.
 */
function davFetch(url: string, init: RequestInit = {}): Promise<Response> {
  assertDavTarget(url);
  return fetch(url, { ...init, redirect: 'error' });
}

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

// ── Address book color ────────────────────────────────────────────────────────

const AB_COLOR_PALETTE = [
  '#0082C9', '#3498DB', '#1ABC9C', '#2ECC71',
  '#F1C40F', '#E67E22', '#E74C3C', '#E91E63',
  '#9B59B6', '#795548', '#607D8B', '#34495E',
];

function deterministicAddressBookColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  }
  return AB_COLOR_PALETTE[Math.abs(h) % AB_COLOR_PALETTE.length]!;
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
    serverUrl: config.DAV_BASE_URL,
    credentials: creds,
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
  const cardClient = new DAVClient({
    serverUrl: config.DAV_BASE_URL,
    credentials: creds,
    authMethod: 'Basic',
    defaultAccountType: 'carddav',
  });

  await Promise.all([calClient.login(), cardClient.login()]);

  const result: DiscoveryResult = {
    principalUrl: calClient.account?.principalUrl ?? '',
    calendarHomeUrl: calClient.account?.homeUrl ?? '',
    addressBookHomeUrl: cardClient.account?.homeUrl ?? '',
    displayName: username,
  };

  // These URLs come straight out of the server's discovery response and become
  // the base for every subsequent request, so a hostile or compromised DAV server
  // could otherwise point them at a host of its choosing and collect the user's
  // credentials on every call. Validate before they reach the session.
  assertDavTarget(result.principalUrl);
  assertDavTarget(result.calendarHomeUrl);
  assertDavTarget(result.addressBookHomeUrl);

  return result;
}

// ── Collection listing ────────────────────────────────────────────────────────

function calAccount(session: SessionData, config: Config): DAVAccount {
  return {
    accountType: 'caldav',
    serverUrl: config.DAV_BASE_URL,
    rootUrl: config.DAV_BASE_URL,
    credentials: { username: session.username, password: session.password },
    principalUrl: session.principalUrl,
    homeUrl: session.calendarHomeUrl,
  };
}

function cardAccount(session: SessionData, config: Config): DAVAccount {
  return {
    accountType: 'carddav',
    serverUrl: config.DAV_BASE_URL,
    rootUrl: config.DAV_BASE_URL,
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
  db: DbInstance,
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

  const colorRows = db.prepare(
    'SELECT address_book_id, color FROM address_book_colors WHERE username = ?',
  ).all(session.username) as Array<{ address_book_id: string; color: string }>;
  const colorMap = new Map(colorRows.map((r) => [r.address_book_id, r.color]));

  return (results as TsdavTypes.DAVResponse[])
    .filter((r) => {
      const rt = (r.props as Record<string, unknown> | undefined)?.resourcetype;
      return rt && typeof rt === 'object' && 'addressbook' in (rt as object);
    })
    .map((rs) => {
      const props = (rs.props ?? {}) as Record<string, unknown>;
      const rawUrl = typeof rs.href === 'string' ? rs.href : '';
      const fullUrl = new URL(rawUrl, account.rootUrl ?? config.DAV_BASE_URL).href;
      const id = collectionId(fullUrl);

      const stored = colorMap.get(id);
      const colorIsAuto = stored === undefined;
      const color = stored === undefined
        ? deterministicAddressBookColor(id)   // auto: deterministic from ID
        : stored === 'none'
          ? null                               // user removed color
          : stored;                            // user-set custom hex

      return {
        id,
        url: fullUrl,
        displayName: str(props.displayname, fullUrl),
        description: str(props.addressbookDescription, ''),
        color,
        colorIsAuto,
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
  const addressBookUrl = `${homeUrl}/${encodeSegment(addressBookId)}/`;
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
  return `${session.addressBookHomeUrl.replace(/\/$/, '')}/${encodeSegment(addressBookId)}/`;
}

function contactUrl(session: SessionData, addressBookId: string, id: string): string {
  return `${addressBookUrl(session, addressBookId)}${encodeSegment(id)}.vcf`;
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

  const res = await davFetch(url, {
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

  const res = await davFetch(url, {
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

  const res = await davFetch(url, {
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
  const abUrl = `${homeUrl}/${encodeSegment(addressBookId)}/`;
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
  const calUrl = `${session.calendarHomeUrl.replace(/\/$/, '')}/${encodeSegment(calendarId)}/`;
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
  return `${session.calendarHomeUrl.replace(/\/$/, '')}/${encodeSegment(calendarId)}/`;
}

function calendarObjectUrl(session: SessionData, calendarId: string, uid: string): string {
  return `${calendarUrl(session, calendarId)}${encodeSegment(uid)}.ics`;
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

  const res = await davFetch(url, {
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

  const res = await davFetch(url, {
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
    const updatedIcs = updateMasterVevent(raw, { ...data, calendarId: newCalendarId });
    const newUrl = calendarObjectUrl(session, newCalendarId, id);
    const putRes = await davFetch(newUrl, {
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
  const putRes = await davFetch(newUrl, {
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

  const res = await davFetch(url, {
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
  const res = await davFetch(url, { headers: basicAuthHeader(session) });
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
  const res = await davFetch(url, {
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
    // Keep data.recurrenceId — updateMasterVevent needs the occurrence's
    // original start to compute the time shift the user made.
    const masterData: EventJson = { ...data, recurrenceId: null };
    const { raw, etag: freshEtag } = await fetchRawEvent(session, calendarId, id);
    const updatedIcs = updateMasterVevent(raw, data);
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

  const res = await davFetch(url, {
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

  const res = await davFetch(url, {
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
  const res = await davFetch(url, { method: 'DELETE', headers: basicAuthHeader(session) });

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

  const res = await davFetch(url, {
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

  const res = await davFetch(url, {
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
  const res = await davFetch(url, { method: 'DELETE', headers: basicAuthHeader(session) });

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
  /** True when `changed` is the entire collection, not a delta. See syncAddressBook. */
  full: boolean;
}

export interface CalendarSyncResult {
  syncToken: string;
  dirty: boolean;
}

/**
 * The server refused our sync-token and wants a fresh start.
 *
 * RFC 6578 §3.2 defines this as a 403 carrying the DAV:valid-sync-token
 * precondition. It is not an exotic case: Radicale prunes tokens older than
 * `max_sync_token_age` (30 days by default), and sabre/dav does the same for
 * tokens it has forgotten, so any collection that goes unsynced for long enough
 * lands here. Callers must discard the stored token and re-sync from scratch.
 */
export class SyncTokenInvalidError extends Error {
  constructor(public readonly collectionUrl: string) {
    super(`Server rejected the sync token for ${collectionUrl}`);
    this.name = 'SyncTokenInvalidError';
  }
}

export interface SyncCollectionResult {
  /** The server's new token, or undefined if it omitted one (spec violation). */
  syncToken: string | undefined;
  /** hrefs of added/modified members. */
  changed: string[];
  /** hrefs of removed members. */
  deleted: string[];
}

/** One element of xml-js compact output: child elements plus an optional `_text`. */
type XmlNode = Record<string, unknown>;

// xml-js compact output puts character data under `_text`.
function xmlText(node: unknown): string | undefined {
  if (node === null || node === undefined) return undefined;
  if (typeof node === 'string') return node;
  if (typeof node === 'object') {
    const t = (node as Record<string, unknown>)['_text'];
    if (typeof t === 'string') return t;
    if (typeof t === 'number') return String(t);
  }
  return undefined;
}

// '<D:status>HTTP/1.1 404 Not Found</D:status>' → 404
function parseStatusCode(status: unknown): number | undefined {
  const text = xmlText(status);
  if (!text) return undefined;
  const m = /\s(\d{3})(?:\s|$)/.exec(text);
  return m ? Number.parseInt(m[1]!, 10) : undefined;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Run a sync-collection REPORT (RFC 6578) and parse the multistatus ourselves.
 *
 * This deliberately bypasses tsdav's `syncCollection`, for two reasons:
 *
 *  1. Reading the token out of `raw.multistatus.syncToken` depended on tsdav's
 *     internal parse shape, which a version bump could change silently — and the
 *     failure mode is invisible, since a missing token just looks like "nothing
 *     changed".
 *  2. tsdav attaches the parsed document as `raw` only to *member* responses, so
 *     when a REPORT reports no changes there are no `<D:response>` elements, no
 *     `raw`, and the `<D:sync-token>` is unrecoverable. We then had to guess by
 *     reusing the previous token. Both Baikal and Radicale happen to return the
 *     same token in that case (sabre's is a changelog sequence, Radicale's a hash
 *     of collection state), so the guess was right on both — but RFC 6578 does
 *     not require a content-derived token, and a server that issues a fresh one
 *     per REPORT would have had it silently dropped.
 *
 * The response is small and rigidly specified, so parsing it directly is less
 * fragile than either. Namespace prefixes are stripped because servers disagree:
 * Radicale serves a default `xmlns="DAV:"` with unprefixed names, Baikal uses
 * `d:`.
 */
async function runSyncCollection(
  url: string,
  syncToken: string,
  authHeaders: Record<string, string>,
): Promise<SyncCollectionResult> {
  // An empty <sync-token/> is RFC 6578's "send me everything".
  const body =
    `<?xml version="1.0" encoding="utf-8" ?>` +
    `<D:sync-collection xmlns:D="DAV:">` +
    `<D:sync-token>${escapeXml(syncToken)}</D:sync-token>` +
    `<D:sync-level>1</D:sync-level>` +
    `<D:prop><D:getetag/></D:prop>` +
    `</D:sync-collection>`;

  const res = await davFetch(url, {
    method: 'REPORT',
    headers: { ...authHeaders, 'Content-Type': 'text/xml;charset=UTF-8', Depth: '0' },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // 409 is not what the RFC specifies, but some servers use it for the same
    // precondition, so accept both. A 403 without the precondition element is
    // treated the same way: the only other plausible cause is a permission
    // change, and the resulting full re-sync will surface that as a real error
    // instead of hiding it behind a stalled token. Log which of the two it was,
    // since that is the first thing worth knowing if this shows up in the wild.
    if (res.status === 403 || res.status === 409) {
      const declared = /valid-sync-token/i.test(text);
      console.warn(
        `sync-collection for ${url} rejected with ${res.status}` +
          `${declared ? ' (DAV:valid-sync-token)' : ' without a DAV:valid-sync-token precondition'}`,
      );
      throw new SyncTokenInvalidError(url);
    }
    throw Object.assign(
      new Error(`sync-collection REPORT failed: ${res.status} ${res.statusText ?? ''}`.trim()),
      { statusCode: res.status },
    );
  }

  const text = await res.text();
  let doc: Record<string, unknown>;
  try {
    doc = xml2js(text, {
      compact: true,
      trim: true,
      ignoreDeclaration: true,
      ignoreAttributes: true,
      elementNameFn: (name) => name.replace(/^.+:/, ''),
    }) as Record<string, unknown>;
  } catch (err) {
    throw Object.assign(new Error(`sync-collection REPORT returned unparseable XML for ${url}`), {
      cause: err,
    });
  }

  const multistatus = doc.multistatus as Record<string, unknown> | undefined;
  if (!multistatus) {
    throw new Error(`sync-collection REPORT for ${url} returned no DAV:multistatus element`);
  }

  const token = xmlText(multistatus['sync-token']);
  if (!token) {
    console.warn(`sync-collection for ${url} returned no sync-token; reusing the previous one`);
  }

  const changed: string[] = [];
  const deleted: string[] = [];

  for (const response of asArray<XmlNode>(multistatus.response as XmlNode | XmlNode[])) {
    const href = xmlText(response?.href);
    if (!href) continue;

    // Removals carry a response-level <status>; survivors carry their status
    // inside <propstat>. Fall back to the first propstat when there is no
    // response-level status.
    const firstPropstat = asArray<XmlNode>(response.propstat as XmlNode | XmlNode[])[0];
    const status = parseStatusCode(response.status) ?? parseStatusCode(firstPropstat?.status);

    if (status === 404 || status === 410) {
      deleted.push(href);
    } else if (status === undefined || (status >= 200 && status < 300)) {
      // No parseable status at all still means "this member exists" — the href
      // was listed. Treating it as changed re-fetches it, which is harmless;
      // dropping it would silently lose an update.
      changed.push(href);
    }
  }

  return { syncToken: token, changed, deleted };
}

export async function syncAddressBook(
  session: SessionData,
  abId: string,
  currentSyncToken: string,
  _config: Config,
): Promise<AddressBookSyncResult> {
  const homeUrl = session.addressBookHomeUrl.replace(/\/$/, '');
  const abUrl = `${homeUrl}/${encodeSegment(abId)}/`;
  const authHeaders = _getBasicAuthHeaders({ username: session.username, password: session.password });

  // An empty sync-token means "send me everything" (RFC 6578 §3.2), so recovery
  // from a rejected token is just the same REPORT with the token dropped. The
  // `full` flag tells the client to replace its contact list rather than merge a
  // delta into it — the response is the whole collection, and anything deleted
  // while our token was stale is absent rather than reported as a deletion.
  let full = false;
  let result: SyncCollectionResult;
  try {
    result = await runSyncCollection(abUrl, currentSyncToken, authHeaders);
  } catch (err) {
    if (!(err instanceof SyncTokenInvalidError)) throw err;
    full = true;
    result = await runSyncCollection(abUrl, '', authHeaders);
  }

  const newSyncToken = result.syncToken ?? currentSyncToken;

  const changedHrefs = result.changed;
  // Resolve before deriving the id: servers report members as relative hrefs
  // ("/dav.php/…/x.vcf"), and contactId's `new URL(href)` throws on those and
  // falls back to returning the href verbatim. That yields ids that match no
  // cached contact, so deletions would silently never apply.
  const deleted = result.deleted.map((href) => contactId(new URL(href, abUrl).href));

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

  return { syncToken: newSyncToken, changed, deleted, full };
}

export async function syncCalendar(
  session: SessionData,
  calId: string,
  currentSyncToken: string,
  _config: Config,
): Promise<CalendarSyncResult> {
  const calUrl = `${session.calendarHomeUrl.replace(/\/$/, '')}/${encodeSegment(calId)}/`;
  const authHeaders = _getBasicAuthHeaders({ username: session.username, password: session.password });

  // Calendars only report a dirty bit, so a rejected token needs no special
  // result shape: refetch with an empty token and force `dirty` so the client
  // reloads the collection outright.
  let forceDirty = false;
  let result: SyncCollectionResult;
  try {
    result = await runSyncCollection(calUrl, currentSyncToken, authHeaders);
  } catch (err) {
    if (!(err instanceof SyncTokenInvalidError)) throw err;
    forceDirty = true;
    result = await runSyncCollection(calUrl, '', authHeaders);
  }

  const newSyncToken = result.syncToken ?? currentSyncToken;
  const dirty = forceDirty || result.changed.length > 0 || result.deleted.length > 0;

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
 *
 * Unlike the other two sync helpers this one does *not* recover from a rejected
 * token on its own: it throws SyncTokenInvalidError so the caller can clear the
 * collection's cached rows before refetching. Retrying here would repopulate the
 * cache while leaving rows for objects deleted in the meantime.
 */
export async function syncCalendarForCache(
  session: SessionData,
  calUrl: string,
  currentSyncToken: string,
  _config: Config,
): Promise<CalendarCacheSyncResult> {
  const authHeaders = _getBasicAuthHeaders({ username: session.username, password: session.password });

  const result = await runSyncCollection(calUrl, currentSyncToken, authHeaders);

  const newSyncToken = result.syncToken ?? currentSyncToken;
  const changedHrefs = result.changed;

  // Resolve relative hrefs to absolute URLs so they match what is stored in the cache.
  const resolveHref = (href: string): string => {
    try { return new URL(href, calUrl).href; } catch { return href; }
  };
  const deleted = result.deleted.map(resolveHref);

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
  _config: Config,
): Promise<TaskWriteResult> {
  assertDavTarget(collectionUrl);
  const uid = data.uid || crypto.randomUUID();
  const taskData: TaskJson = { ...data, uid };
  const icsStr = serializeIcalTask(taskData);
  const url = `${collectionUrl.replace(/\/$/, '')}/${encodeSegment(uid)}.ics`;

  const res = await davFetch(url, {
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

  const res = await davFetch(objectUrl, {
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
  const res = await davFetch(objectUrl, {
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

// ── DAV archive search ─────────────────────────────────────────────────────

/**
 * The COMPLETED window the archive search covers, as epoch milliseconds.
 *
 * start = now - DAV_ARCHIVE_SEARCH_MAX_AGE_DAYS  (oldest to fetch)
 * end   = now - COMPLETED_TASK_RETENTION_DAYS    (exclude still-cached tasks)
 *
 * Exported so callers can re-check what the server returned against the same
 * bounds that were asked for.
 */
export function archiveSearchWindow(config: Config): { startMs: number; endMs: number } {
  const now = Date.now();
  return {
    startMs: now - config.DAV_ARCHIVE_SEARCH_MAX_AGE_DAYS * 86_400_000,
    endMs: now - config.COMPLETED_TASK_RETENTION_DAYS * 86_400_000,
  };
}

/**
 * Fetch VTODO objects whose COMPLETED timestamp falls strictly between the
 * retention window and the max archive age — i.e. tasks that have been evicted
 * from the local cache but are still within the server-side search cap.
 *
 * The time-range filter is only a request. Radicale and sabre/dav both evaluate
 * `time-range` inside a `prop-filter`, but a server that ignores it answers with
 * every VTODO in the collection, which would flood the archive UI with tasks the
 * user can already see. Callers must re-check COMPLETED against
 * archiveSearchWindow() rather than trusting the result set.
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

  const { startMs, endMs } = archiveSearchWindow(config);
  const startStr = toIso(startMs);
  const endStr = toIso(endMs);

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
 * Restore an archived completed task: GET the current ICS from the server,
 * reset STATUS to NEEDS-ACTION, clear COMPLETED and PERCENT-COMPLETE,
 * then PUT it back. Returns the TaskWriteResult for the caller to cache.
 */
export async function restoreArchivedTask(
  session: SessionData,
  objectUrl: string,
  collectionUrl: string,
  etag: string,
  _config: Config,
): Promise<TaskWriteResult> {
  assertDavTarget(objectUrl);
  const authHeaders = basicAuthHeader(session);

  // Fetch latest ICS (in case it changed since the search was run)
  const getRes = await davFetch(objectUrl, { headers: authHeaders });
  if (!getRes.ok) {
    throw Object.assign(new Error(`GET failed: ${getRes.status}`), { statusCode: getRes.status });
  }
  const rawIcs = await getRes.text();
  const currentEtag = getRes.headers.get('ETag') ?? etag;

  const restoredIcs = resetTaskToNeedsAction(rawIcs);

  const putRes = await davFetch(objectUrl, {
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
  _config: Config,
): Promise<JournalWriteResult> {
  assertDavTarget(collectionUrl);
  const uid = data.uid || crypto.randomUUID();
  const entryData: NoteJson = { ...data, uid };
  const icsStr = serializeIcalJournal(entryData);
  const url = `${collectionUrl.replace(/\/$/, '')}/${encodeSegment(uid)}.ics`;

  const res = await davFetch(url, {
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

  const res = await davFetch(objectUrl, {
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
  const res = await davFetch(objectUrl, {
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
  _config: Config,
): Promise<{ url: string; etag: string; collectionUrl: string }> {
  assertDavTarget(collectionUrl);
  const url = `${collectionUrl.replace(/\/$/, '')}/${encodeSegment(uid)}.ics`;
  const res = await davFetch(url, {
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
