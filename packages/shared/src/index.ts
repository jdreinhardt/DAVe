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
  description: string;
  color: string;
  ctag: string;
  syncToken: string;
}

export interface Calendar {
  id: string;
  url: string;
  displayName: string;
  description: string;
  color: string;
  ctag: string;
  syncToken: string;
  components: string[]; // ['VEVENT', 'VTODO', …]
  timezone: string;
}

export interface CreateAddressBookRequest {
  displayName: string;
  description?: string;
}

export interface UpdateAddressBookRequest {
  displayName: string;
  description?: string;
}

export interface CreateCalendarRequest {
  displayName: string;
  description?: string;
  color: string;
  components: string[];
}

export interface UpdateCalendarRequest {
  displayName: string;
  description?: string;
  color: string;
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

export interface AttendeeJson {
  email: string;
  name: string;   // CN parameter; empty string if absent
  partstat: string; // ACCEPTED | DECLINED | TENTATIVE | NEEDS-ACTION | DELEGATED | …
  role: string;   // CHAIR | REQ-PARTICIPANT | OPT-PARTICIPANT | NON-PARTICIPANT | …
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
  attendees: AttendeeJson[];
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

// ── Event write request/response shapes ───────────────────────────────────────

export interface CreateEventRequest {
  data: EventJson;
}

export type RecurrenceScope = 'this' | 'following' | 'all';

export interface UpdateEventRequest {
  data: EventJson;
  etag: string;
  scope?: RecurrenceScope;
  oldCalendarId?: string;
}

export interface DeleteEventRequest {
  etag: string;
  calendarId: string;
  scope?: RecurrenceScope;
  recurrenceId?: string;
  allDay?: boolean;
}

export interface EventWriteResponse {
  id: string;
  url: string;
  etag: string;
  calendarId: string;
  data: EventJson;
  // Populated for scope="following": the newly-created continuation event
  continuation?: EventWriteResponse;
}

// ── Sync request / response shapes ───────────────────────────────────────────

export interface SyncAddressBookRequest {
  id: string;
  syncToken: string;
}

export interface SyncCalendarRequest {
  id: string;
  syncToken: string;
}

export interface CollectionSyncRequest {
  addressbooks: SyncAddressBookRequest[];
  calendars: SyncCalendarRequest[];
}

export interface AddressBookSyncResult {
  id: string;
  syncToken: string;
  changed: Contact[];  // added + modified contacts
  deleted: string[];   // IDs of deleted contacts
}

export interface CalendarSyncResult {
  id: string;
  syncToken: string;
  dirty: boolean;  // true if any events were added, modified, or deleted
}

export interface CollectionSyncResponse {
  addressbooks: AddressBookSyncResult[];
  calendars: CalendarSyncResult[];
}

// ── Sync cache ────────────────────────────────────────────────────────────────

export interface SyncWorkerHealth {
  running: boolean;
  lastRunAt: string | null; // ISO timestamp or null
  consecutiveErrors: number;
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export interface TaskRelation {
  relatedUid: string;
  reltype: string; // 'PARENT' | 'CHILD' | 'UNKNOWN'
}

export interface TaskJson {
  uid: string;
  summary: string;
  description: string;
  status: string | null;        // NEEDS-ACTION | IN-PROCESS | COMPLETED | CANCELLED
  priority: number | null;      // 1–9 per RFC 5545; null = no priority
  dtstart: string | null;       // ISO datetime
  due: string | null;
  completed: string | null;
  percentComplete: number | null;
  lastModified: string | null;  // ISO datetime from LAST-MODIFIED
  categories: string[];
  relations: TaskRelation[];
  collectionUrl: string;
  alarms: AlarmJson[];          // VALARM components; empty array in list responses
  rrule: string | null;         // raw RRULE string; editable via the recurrence editor
  recurringInstance?: boolean;  // true when this task is a completed history copy of a recurring task
}

export interface Task {
  uid: string;
  etag: string;
  collectionUrl: string;
  collectionId: string;  // last path segment of collectionUrl; matches Calendar.id
  data: TaskJson;
}

export interface TasksResponse {
  tasks: Task[];
  total: number;
}

export interface TasksQueryParams {
  status?: string;                                              // NEEDS-ACTION | IN-PROCESS | COMPLETED | CANCELLED | active
  category?: string;
  due?: 'overdue' | 'today' | 'this_week' | 'no_due_date';
  priority?: 'high' | 'medium' | 'low' | 'none';
  q?: string;
  sort?: 'summary' | 'due' | 'priority' | 'category' | 'modified';
  order?: 'asc' | 'desc';
  collections?: string;  // comma-separated collection URLs
}

// ── Task write request/response shapes ───────────────────────────────────────

export interface CreateTaskRequest {
  data: TaskJson;
}

export interface UpdateTaskRequest {
  data: TaskJson;
  etag: string;
}

export interface TaskWriteResponse {
  uid: string;
  url: string;
  etag: string;
  collectionId: string;
  collectionUrl: string;
  data: TaskJson;
  childMoveErrors?: Array<{ uid: string; error: string }>;
}

export interface DeleteTaskResponse {
  childErrors?: Array<{ uid: string; error: string }>;
}

// ── Notes and Journals ────────────────────────────────────────────────────────

// Both Notes (undated VJOURNAL) and Journals (dated VJOURNAL) share this type.
// The presence of dtstart is the sole discriminator: null = note, non-null = journal.
export interface NoteJson {
  uid: string;
  summary: string;
  description: string;
  dtstart: string | null;        // null → note; ISO date string → journal
  lastModified: string | null;
  categories: string[];
  relations: TaskRelation[];     // RELATED-TO entries; preserved on round-trip
  collectionUrl: string;
}

export interface Note {
  uid: string;
  etag: string;
  collectionUrl: string;
  collectionId: string;          // last path segment of collectionUrl
  data: NoteJson;
}

export interface NotesResponse {
  notes: Note[];
  total: number;
}

export interface NotesQueryParams {
  category?: string;
  q?: string;
  sort?: 'summary' | 'created' | 'modified' | 'category';
  order?: 'asc' | 'desc';
  collections?: string;          // comma-separated collection URLs
}

// ── Note write request/response shapes ────────────────────────────────────────

export interface CreateNoteRequest {
  data: NoteJson;
}

export interface UpdateNoteRequest {
  data: NoteJson;
  etag: string;
}

export interface NoteWriteResponse {
  uid: string;
  url: string;
  etag: string;
  collectionId: string;
  collectionUrl: string;
  data: NoteJson;
}

// ── Journals query / response shapes ─────────────────────────────────────────

// Journals are dated VJOURNAL entries (dtstart present).
// They share the Note / NoteJson data shape — dtstart is always non-null here.
export interface JournalsQueryParams {
  category?: string;
  q?: string;
  sort?: 'summary' | 'created' | 'modified' | 'journal_date' | 'category';
  order?: 'asc' | 'desc';
  collections?: string;       // comma-separated collection URLs
  from?: string;              // YYYY-MM-DD — inclusive lower bound on DTSTART (calendar view, milestone 9)
  to?: string;                // YYYY-MM-DD — inclusive upper bound on DTSTART (calendar view, milestone 9)
}

export interface JournalsResponse {
  journals: Note[];
  total: number;
}

// ── API error shape ───────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  statusCode: number;
  details?: string;
}
