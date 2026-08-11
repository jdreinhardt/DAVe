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

// ── User-settings value sets ───────────────────────────────────────────────────
// Single source of truth for the allowed values of each user setting. The union
// types are derived from these arrays, and both the frontend (type + runtime
// validation) and the backend (PUT /api/settings JSON-schema enums) consume them,
// so the two can't drift. Add a new value here once and both sides pick it up.

export const SORT_BY = ['first', 'last'] as const;
export const SORT_DIR = ['asc', 'desc'] as const;
export const CONTACT_SUBTITLE_FIELDS = ['nickname', 'email', 'phone', 'organization', 'title', ''] as const;
export const MAP_SERVICES = ['osm', 'google', 'apple'] as const;
export const DARK_MODES = ['light', 'dark', 'system'] as const;
export const TASK_LAYOUTS = ['list', 'compact', 'kanban'] as const;
export const NOTES_VIEWS = ['list', 'grid'] as const;
export const JOURNALS_VIEWS = ['timeline', 'list', 'calendar'] as const;
// Which task date positions a task on the Calendar view's tasks layer.
export const CALENDAR_TASK_DATES = ['due', 'dtstart', 'span'] as const;
// Whether the Calendar view shows the tasks / journals overlay layer at all.
export const CALENDAR_LAYER_TOGGLE = ['on', 'off'] as const;
// FullCalendar view names the Calendar page opens in. Must stay in sync with the
// views CalendarPage registers in its toolbar.
export const CALENDAR_DEFAULT_VIEWS = ['dayGridMonth', 'timeGridWeek', 'timeGridDay'] as const;
// Which top-level view "/" redirects to after login. Values are route paths
// without the leading slash.
export const HOME_VIEWS = ['contacts', 'calendar', 'tasks', 'notes', 'journals'] as const;

export type SortBy = (typeof SORT_BY)[number];
export type SortDir = (typeof SORT_DIR)[number];
export type ContactSubtitleField = (typeof CONTACT_SUBTITLE_FIELDS)[number];
export type MapService = (typeof MAP_SERVICES)[number];
export type DarkMode = (typeof DARK_MODES)[number];
export type TaskLayout = (typeof TASK_LAYOUTS)[number];
export type NotesView = (typeof NOTES_VIEWS)[number];
export type JournalsView = (typeof JOURNALS_VIEWS)[number];
export type CalendarTaskDate = (typeof CALENDAR_TASK_DATES)[number];
export type CalendarLayerToggle = (typeof CALENDAR_LAYER_TOGGLE)[number];
export type CalendarDefaultView = (typeof CALENDAR_DEFAULT_VIEWS)[number];
export type HomeView = (typeof HOME_VIEWS)[number];

// ── Collections ───────────────────────────────────────────────────────────────

export interface AddressBook {
  id: string;
  url: string;
  displayName: string;
  description: string;
  /** Resolved display color. null = no color preference (gray/default styling). */
  color: string | null;
  /** true = color was auto-generated from the address book ID; false = user-set or user-removed. */
  colorIsAuto: boolean;
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
  /** null = reset to auto; 'none' = remove color (gray); '#RRGGBB' = custom color. Absent = no change. */
  color?: string | null;
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
  // True when the server rejected our sync token and `changed` is therefore the
  // whole collection rather than a delta. Clients must replace, not merge.
  full: boolean;
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

/** A completed task found via server-side archive search (not in the local cache). */
export interface ArchivedTask {
  uid: string;
  etag: string;
  url: string;           // full DAV object URL — required for the restore PUT
  collectionUrl: string;
  collectionId: string;
  data: TaskJson;
}

export interface ArchivedTasksResponse {
  tasks: ArchivedTask[];
}

export interface RestoreArchivedTaskRequest {
  url: string;
  etag: string;
  collectionUrl: string;
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

// ── Global search ─────────────────────────────────────────────────────────────

export type SearchResultType = 'task' | 'note' | 'journal' | 'event';

export interface GlobalSearchResult {
  type: SearchResultType;
  uid: string;
  summary: string;
  /** First ~120 chars of description; empty string if none. */
  snippet: string;
  categories: string[];
  /** due for tasks, dtstart for journals/events, null for notes */
  date: string | null;
  collectionId: string;
  collectionUrl: string;
  /** ISO datetime of event start — only set when type='event', for CalendarPage navigation. */
  eventStart?: string;
}

export interface GlobalSearchResponse {
  tasks: GlobalSearchResult[];
  notes: GlobalSearchResult[];
  journals: GlobalSearchResult[];
  events: GlobalSearchResult[];
}

// ── API error shape ───────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  statusCode: number;
  details?: string;
}
