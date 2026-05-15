// Shared types between frontend and backend.
// All shapes here are what the JSON API returns — not raw vCard/iCal.

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  ok: true;
}

export interface MeResponse {
  username: string;
  displayName: string;
  principalUrl: string;
}

// ── Collections ───────────────────────────────────────────────────────────────

export interface AddressBook {
  id: string;
  url: string;
  displayName: string;
  color: string;
  ctag: string;
  syncToken: string;
}

export interface Calendar {
  id: string;
  url: string;
  displayName: string;
  color: string;
  ctag: string;
  syncToken: string;
  components: string[]; // ['VEVENT', 'VTODO', …]
  timezone: string;
}

// ── Contacts ──────────────────────────────────────────────────────────────────

export interface VCardPhone {
  value: string;
  types: string[];
  preferred: boolean;
}

export interface VCardEmail {
  value: string;
  types: string[];
  preferred: boolean;
}

export interface VCardAddress {
  types: string[];
  street: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  preferred: boolean;
}

export interface VCardName {
  prefix: string;
  given: string;
  middle: string;
  family: string;
  suffix: string;
}

export interface VCardCustomField {
  property: string; // raw property name, e.g. "X-SIGNAL"
  value: string;
  parameters: Record<string, string>;
}

export interface ContactJson {
  uid: string;
  version: string; // '3.0' | '4.0'
  name: VCardName;
  fullName: string;
  nickname: string;
  organization: string;
  title: string;
  phones: VCardPhone[];
  emails: VCardEmail[];
  addresses: VCardAddress[];
  urls: string[];
  birthday: string | null; // ISO date string
  anniversary: string | null;
  note: string;
  photo: string | null; // base64 data URI or external URL
  customFields: VCardCustomField[];
}

export interface Contact {
  id: string; // url-safe identifier derived from the DAV URL
  url: string;
  etag: string;
  addressBookId: string;
  data: ContactJson;
}

// ── Events ────────────────────────────────────────────────────────────────────

export interface AlarmJson {
  action: 'DISPLAY' | 'EMAIL';
  trigger: string; // ISO 8601 duration (e.g. "-PT15M") or absolute datetime
  description: string;
}

export interface RecurrenceRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval?: number;
  count?: number;
  until?: string; // ISO date
  byDay?: string[];
  byMonthDay?: number[];
  byMonth?: number[];
  raw: string; // full RRULE string for round-tripping
}

export interface EventJson {
  uid: string;
  summary: string;
  description: string;
  location: string;
  start: string; // ISO datetime
  end: string;
  allDay: boolean;
  tzid: string | null; // original TZID from DTSTART
  recurrenceRule: RecurrenceRule | null;
  recurrenceId: string | null; // set on exception instances
  alarms: AlarmJson[];
  calendarId: string;
  color: string | null; // per-event color override if present
}

export interface CalendarEvent {
  id: string;
  url: string;
  etag: string;
  calendarId: string;
  data: EventJson;
}

// ── Contact write request/response shapes ─────────────────────────────────────

export interface CreateContactRequest {
  addressBookId: string;
  data: ContactJson;
}

export interface UpdateContactRequest {
  data: ContactJson;
  etag: string;
}

export interface ContactWriteResponse {
  id: string;
  url: string;
  etag: string;
  addressBookId: string;
  data: ContactJson;
}

export interface ImportContactsRequest {
  vcf: string; // raw .vcf file content
}

export interface ImportContactsResponse {
  imported: number;
  failed: number;
}

// ── API error shape ───────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  statusCode: number;
  details?: string;
}
