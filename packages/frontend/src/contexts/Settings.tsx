import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import {
  SORT_BY, SORT_DIR, CONTACT_SUBTITLE_FIELDS, MAP_SERVICES,
  DARK_MODES, TASK_LAYOUTS, NOTES_VIEWS, JOURNALS_VIEWS, CALENDAR_TASK_DATES,
  CALENDAR_LAYER_TOGGLE, CALENDAR_DEFAULT_VIEWS, HOME_VIEWS,
} from '@dave/shared';
import { fetchServerSettings, pushServerSettings } from '../api/settings.js';
import type { ServerSettings } from '../api/settings.js';

// Setting value types now live in @dave/shared so the backend validation and
// these types share one definition. Re-exported here so existing
// `import { MapService } from '../contexts/Settings'` call sites keep working.
export type {
  SortBy, SortDir, ContactSubtitleField, MapService,
  DarkMode, TaskLayout, NotesView, JournalsView, CalendarTaskDate, CalendarLayerToggle,
  CalendarDefaultView, HomeView,
} from '@dave/shared';
import type {
  SortBy, SortDir, ContactSubtitleField, MapService,
  DarkMode, TaskLayout, NotesView, JournalsView, CalendarTaskDate, CalendarLayerToggle,
  CalendarDefaultView, HomeView,
} from '@dave/shared';

export interface ContactSortSettings {
  sortBy: SortBy;
  sortDir: SortDir;
}

interface SettingsContextValue {
  contactSort: ContactSortSettings;
  updateContactSort: (s: ContactSortSettings) => void;
  contactSubtitleField: ContactSubtitleField;
  updateContactSubtitleField: (f: ContactSubtitleField) => void;
  mapService: MapService;
  updateMapService: (s: MapService) => void;
  darkMode: DarkMode;
  updateDarkMode: (m: DarkMode) => void;
  taskDefaultLayout: TaskLayout;
  updateTaskDefaultLayout: (l: TaskLayout) => void;
  notesDefaultView: NotesView;
  updateNotesDefaultView: (v: NotesView) => void;
  journalsDefaultView: JournalsView;
  updateJournalsDefaultView: (v: JournalsView) => void;
  calendarTaskDate: CalendarTaskDate;
  updateCalendarTaskDate: (v: CalendarTaskDate) => void;
  calendarShowTasks: CalendarLayerToggle;
  updateCalendarShowTasks: (v: CalendarLayerToggle) => void;
  calendarShowJournals: CalendarLayerToggle;
  updateCalendarShowJournals: (v: CalendarLayerToggle) => void;
  calendarDefaultView: CalendarDefaultView;
  updateCalendarDefaultView: (v: CalendarDefaultView) => void;
  homeView: HomeView;
  updateHomeView: (v: HomeView) => void;
  /** False until the mount-time server sync has settled. Gate redirects on this
   *  so a fresh browser doesn't act on the localStorage defaults first. */
  ready: boolean;
}

const SORT_KEY         = 'dave:settings:contactSort';
const SUBTITLE_KEY     = 'dave:settings:contactSubtitleField';
const MAP_SERVICE_KEY  = 'dave:settings:mapService';
const DARK_MODE_KEY    = 'dave:settings:darkMode';
const TASK_LAYOUT_KEY  = 'dave:settings:taskDefaultLayout';
const NOTES_VIEW_KEY   = 'dave:settings:notesDefaultView';
const JOURNALS_VIEW_KEY = 'dave:settings:journalsDefaultView';
const CALENDAR_TASK_DATE_KEY = 'dave:settings:calendarTaskDate';
const CALENDAR_SHOW_TASKS_KEY = 'dave:settings:calendarShowTasks';
const CALENDAR_SHOW_JOURNALS_KEY = 'dave:settings:calendarShowJournals';
const CALENDAR_DEFAULT_VIEW_KEY = 'dave:settings:calendarDefaultView';
const HOME_VIEW_KEY    = 'dave:settings:homeView';
const UPDATED_AT_KEY   = 'dave:settings:updatedAt';

// Owned by CalendarPage, cleared from here — see updateCalendarDefaultView.
const CALENDAR_LAST_VIEW_KEY = 'calendar.view';

// Aliases to the shared value sets (kept under the original names so the
// load*/validate call sites below read unchanged).
const VALID_SUBTITLE_FIELDS = CONTACT_SUBTITLE_FIELDS;
const VALID_MAP_SERVICES = MAP_SERVICES;
const VALID_DARK_MODES = DARK_MODES;
const VALID_TASK_LAYOUTS = TASK_LAYOUTS;
const VALID_NOTES_VIEWS = NOTES_VIEWS;
const VALID_JOURNALS_VIEWS = JOURNALS_VIEWS;
const VALID_CALENDAR_TASK_DATES = CALENDAR_TASK_DATES;
const VALID_CALENDAR_LAYER_TOGGLE = CALENDAR_LAYER_TOGGLE;
const VALID_CALENDAR_DEFAULT_VIEWS = CALENDAR_DEFAULT_VIEWS;
const VALID_HOME_VIEWS = HOME_VIEWS;

// ── localStorage helpers ───────────────────────────────────────────────────────

function loadDarkMode(): DarkMode {
  try {
    const raw = localStorage.getItem(DARK_MODE_KEY);
    if (raw !== null && VALID_DARK_MODES.includes(raw as DarkMode)) return raw as DarkMode;
  } catch { /* ignore corrupt storage */ }
  return 'system';
}

function loadMapService(): MapService {
  try {
    const raw = localStorage.getItem(MAP_SERVICE_KEY);
    if (raw !== null && VALID_MAP_SERVICES.includes(raw as MapService)) return raw as MapService;
  } catch { /* ignore corrupt storage */ }
  return 'osm';
}

function loadContactSort(): ContactSortSettings {
  try {
    const raw = localStorage.getItem(SORT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ContactSortSettings>;
      const sortBy = parsed.sortBy === 'first' || parsed.sortBy === 'last' ? parsed.sortBy : 'last';
      const sortDir = parsed.sortDir === 'asc' || parsed.sortDir === 'desc' ? parsed.sortDir : 'asc';
      return { sortBy, sortDir };
    }
  } catch { /* ignore corrupt storage */ }
  return { sortBy: 'last', sortDir: 'asc' };
}

function loadContactSubtitleField(): ContactSubtitleField {
  try {
    const raw = localStorage.getItem(SUBTITLE_KEY);
    if (raw !== null && VALID_SUBTITLE_FIELDS.includes(raw as ContactSubtitleField)) return raw as ContactSubtitleField;
  } catch { /* ignore corrupt storage */ }
  return '';
}

function loadTaskDefaultLayout(): TaskLayout {
  try {
    const raw = localStorage.getItem(TASK_LAYOUT_KEY);
    if (raw !== null && VALID_TASK_LAYOUTS.includes(raw as TaskLayout)) return raw as TaskLayout;
  } catch { /* ignore corrupt storage */ }
  return 'list';
}

function loadNotesDefaultView(): NotesView {
  try {
    const raw = localStorage.getItem(NOTES_VIEW_KEY);
    if (raw !== null && VALID_NOTES_VIEWS.includes(raw as NotesView)) return raw as NotesView;
  } catch { /* ignore corrupt storage */ }
  return 'list';
}

function loadJournalsDefaultView(): JournalsView {
  try {
    const raw = localStorage.getItem(JOURNALS_VIEW_KEY);
    if (raw !== null && VALID_JOURNALS_VIEWS.includes(raw as JournalsView)) return raw as JournalsView;
  } catch { /* ignore corrupt storage */ }
  return 'timeline';
}

function loadCalendarTaskDate(): CalendarTaskDate {
  try {
    const raw = localStorage.getItem(CALENDAR_TASK_DATE_KEY);
    if (raw !== null && VALID_CALENDAR_TASK_DATES.includes(raw as CalendarTaskDate)) return raw as CalendarTaskDate;
  } catch { /* ignore corrupt storage */ }
  return 'due';
}

function loadCalendarShowTasks(): CalendarLayerToggle {
  try {
    const raw = localStorage.getItem(CALENDAR_SHOW_TASKS_KEY);
    if (raw !== null && VALID_CALENDAR_LAYER_TOGGLE.includes(raw as CalendarLayerToggle)) return raw as CalendarLayerToggle;
  } catch { /* ignore corrupt storage */ }
  return 'on';
}

function loadCalendarShowJournals(): CalendarLayerToggle {
  try {
    const raw = localStorage.getItem(CALENDAR_SHOW_JOURNALS_KEY);
    if (raw !== null && VALID_CALENDAR_LAYER_TOGGLE.includes(raw as CalendarLayerToggle)) return raw as CalendarLayerToggle;
  } catch { /* ignore corrupt storage */ }
  return 'on';
}

function loadCalendarDefaultView(): CalendarDefaultView {
  try {
    const raw = localStorage.getItem(CALENDAR_DEFAULT_VIEW_KEY);
    if (raw !== null && VALID_CALENDAR_DEFAULT_VIEWS.includes(raw as CalendarDefaultView)) return raw as CalendarDefaultView;
  } catch { /* ignore corrupt storage */ }
  return 'dayGridMonth';
}

function loadHomeView(): HomeView {
  try {
    const raw = localStorage.getItem(HOME_VIEW_KEY);
    if (raw !== null && VALID_HOME_VIEWS.includes(raw as HomeView)) return raw as HomeView;
  } catch { /* ignore corrupt storage */ }
  return 'contacts';
}

function loadUpdatedAt(): number {
  try {
    const raw = localStorage.getItem(UPDATED_AT_KEY);
    if (raw !== null) return parseInt(raw, 10) || 0;
  } catch { /* ignore */ }
  return 0;
}

function saveUpdatedAt(ts: number): void {
  try { localStorage.setItem(UPDATED_AT_KEY, String(ts)); } catch { /* ignore */ }
}

// Reads the current snapshot of all settings from localStorage to build a server push payload.
// Called after writing the triggering key, so the new value is always included.
function readAllFromStorage(): Omit<ServerSettings, 'updatedAt'> {
  const sort = loadContactSort();
  return {
    contactSortBy:   sort.sortBy,
    contactSortDir:  sort.sortDir,
    contactSubtitle: loadContactSubtitleField(),
    mapService:      loadMapService(),
    darkMode:        loadDarkMode(),
    taskLayout:      loadTaskDefaultLayout(),
    notesView:       loadNotesDefaultView(),
    journalsView:    loadJournalsDefaultView(),
    calendarTaskDate: loadCalendarTaskDate(),
    calendarShowTasks: loadCalendarShowTasks(),
    calendarShowJournals: loadCalendarShowJournals(),
    calendarDefaultView: loadCalendarDefaultView(),
    homeView:        loadHomeView(),
  };
}

function validateOr<T extends string>(val: string, valid: readonly T[], fallback: T): T {
  return valid.includes(val as T) ? (val as T) : fallback;
}

// Debounce timer for server pushes. SettingsModal calls all 7 updateXxx callbacks
// synchronously in handleSave, so without debouncing, 7 concurrent PUTs race to
// the server — each carrying a partially-written localStorage snapshot. The debounce
// collapses them into one push after all writes have landed.
let pushDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedPush(): void {
  if (pushDebounceTimer !== null) clearTimeout(pushDebounceTimer);
  pushDebounceTimer = setTimeout(() => {
    pushDebounceTimer = null;
    pushServerSettings({ ...readAllFromStorage(), updatedAt: loadUpdatedAt() }).catch(() => {});
  }, 300);
}

// ── Context ────────────────────────────────────────────────────────────────────

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [contactSort, setContactSort] = useState<ContactSortSettings>(loadContactSort);
  const [contactSubtitleField, setContactSubtitleField] = useState<ContactSubtitleField>(loadContactSubtitleField);
  const [mapService, setMapService] = useState<MapService>(loadMapService);
  const [darkMode, setDarkMode] = useState<DarkMode>(loadDarkMode);
  const [taskDefaultLayout, setTaskDefaultLayout] = useState<TaskLayout>(loadTaskDefaultLayout);
  const [notesDefaultView, setNotesDefaultView] = useState<NotesView>(loadNotesDefaultView);
  const [journalsDefaultView, setJournalsDefaultView] = useState<JournalsView>(loadJournalsDefaultView);
  const [calendarTaskDate, setCalendarTaskDate] = useState<CalendarTaskDate>(loadCalendarTaskDate);
  const [calendarShowTasks, setCalendarShowTasks] = useState<CalendarLayerToggle>(loadCalendarShowTasks);
  const [calendarShowJournals, setCalendarShowJournals] = useState<CalendarLayerToggle>(loadCalendarShowJournals);
  const [calendarDefaultView, setCalendarDefaultView] = useState<CalendarDefaultView>(loadCalendarDefaultView);
  const [homeView, setHomeView] = useState<HomeView>(loadHomeView);
  const [ready, setReady] = useState(false);

  // ── Update callbacks ─────────────────────────────────────────────────────────
  // Each writes to localStorage first (fast), then stamps the timestamp and
  // pushes the full settings blob to the server in the background.

  const updateContactSort = useCallback((s: ContactSortSettings) => {
    setContactSort(s);
    try { localStorage.setItem(SORT_KEY, JSON.stringify(s)); } catch { /* ignore */ }
    saveUpdatedAt(Date.now());
    debouncedPush();
  }, []);

  const updateContactSubtitleField = useCallback((f: ContactSubtitleField) => {
    setContactSubtitleField(f);
    try { localStorage.setItem(SUBTITLE_KEY, f); } catch { /* ignore */ }
    saveUpdatedAt(Date.now());
    debouncedPush();
  }, []);

  const updateMapService = useCallback((s: MapService) => {
    setMapService(s);
    try { localStorage.setItem(MAP_SERVICE_KEY, s); } catch { /* ignore */ }
    saveUpdatedAt(Date.now());
    debouncedPush();
  }, []);

  const updateDarkMode = useCallback((m: DarkMode) => {
    setDarkMode(m);
    try { localStorage.setItem(DARK_MODE_KEY, m); } catch { /* ignore */ }
    saveUpdatedAt(Date.now());
    debouncedPush();
  }, []);

  const updateTaskDefaultLayout = useCallback((l: TaskLayout) => {
    setTaskDefaultLayout(l);
    try { localStorage.setItem(TASK_LAYOUT_KEY, l); } catch { /* ignore */ }
    saveUpdatedAt(Date.now());
    debouncedPush();
  }, []);

  const updateNotesDefaultView = useCallback((v: NotesView) => {
    setNotesDefaultView(v);
    try { localStorage.setItem(NOTES_VIEW_KEY, v); } catch { /* ignore */ }
    saveUpdatedAt(Date.now());
    debouncedPush();
  }, []);

  const updateJournalsDefaultView = useCallback((v: JournalsView) => {
    setJournalsDefaultView(v);
    try { localStorage.setItem(JOURNALS_VIEW_KEY, v); } catch { /* ignore */ }
    saveUpdatedAt(Date.now());
    debouncedPush();
  }, []);

  const updateCalendarTaskDate = useCallback((v: CalendarTaskDate) => {
    setCalendarTaskDate(v);
    try { localStorage.setItem(CALENDAR_TASK_DATE_KEY, v); } catch { /* ignore */ }
    saveUpdatedAt(Date.now());
    debouncedPush();
  }, []);

  const updateCalendarShowTasks = useCallback((v: CalendarLayerToggle) => {
    setCalendarShowTasks(v);
    try { localStorage.setItem(CALENDAR_SHOW_TASKS_KEY, v); } catch { /* ignore */ }
    saveUpdatedAt(Date.now());
    debouncedPush();
  }, []);

  const updateCalendarShowJournals = useCallback((v: CalendarLayerToggle) => {
    setCalendarShowJournals(v);
    try { localStorage.setItem(CALENDAR_SHOW_JOURNALS_KEY, v); } catch { /* ignore */ }
    saveUpdatedAt(Date.now());
    debouncedPush();
  }, []);

  const updateCalendarDefaultView = useCallback((v: CalendarDefaultView) => {
    setCalendarDefaultView(v);
    try {
      localStorage.setItem(CALENDAR_DEFAULT_VIEW_KEY, v);
      // CalendarPage remembers the last view you were on and only falls back to
      // this default when nothing is remembered. Drop that memory so picking a
      // new default takes effect on the next visit instead of silently losing
      // to a months-old sticky value.
      localStorage.removeItem(CALENDAR_LAST_VIEW_KEY);
    } catch { /* ignore */ }
    saveUpdatedAt(Date.now());
    debouncedPush();
  }, []);

  const updateHomeView = useCallback((v: HomeView) => {
    setHomeView(v);
    try { localStorage.setItem(HOME_VIEW_KEY, v); } catch { /* ignore */ }
    saveUpdatedAt(Date.now());
    debouncedPush();
  }, []);

  // ── Server sync (apply server values when server timestamp is newer) ──────────

  const applyFromServer = useCallback((server: ServerSettings) => {
    const sort: ContactSortSettings = {
      sortBy:  validateOr(server.contactSortBy,  SORT_BY, 'last'),
      sortDir: validateOr(server.contactSortDir, SORT_DIR, 'asc'),
    };
    setContactSort(sort);
    try { localStorage.setItem(SORT_KEY, JSON.stringify(sort)); } catch { /* ignore */ }

    const subtitle = validateOr(server.contactSubtitle, VALID_SUBTITLE_FIELDS, '' as ContactSubtitleField);
    setContactSubtitleField(subtitle);
    try { localStorage.setItem(SUBTITLE_KEY, subtitle); } catch { /* ignore */ }

    const mapSvc = validateOr(server.mapService, VALID_MAP_SERVICES, 'osm');
    setMapService(mapSvc);
    try { localStorage.setItem(MAP_SERVICE_KEY, mapSvc); } catch { /* ignore */ }

    const dm = validateOr(server.darkMode, VALID_DARK_MODES, 'system');
    setDarkMode(dm);
    try { localStorage.setItem(DARK_MODE_KEY, dm); } catch { /* ignore */ }

    const tl = validateOr(server.taskLayout, VALID_TASK_LAYOUTS, 'list');
    setTaskDefaultLayout(tl);
    try { localStorage.setItem(TASK_LAYOUT_KEY, tl); } catch { /* ignore */ }

    const nv = validateOr(server.notesView, VALID_NOTES_VIEWS, 'list');
    setNotesDefaultView(nv);
    try { localStorage.setItem(NOTES_VIEW_KEY, nv); } catch { /* ignore */ }

    const jv = validateOr(server.journalsView, VALID_JOURNALS_VIEWS, 'timeline');
    setJournalsDefaultView(jv);
    try { localStorage.setItem(JOURNALS_VIEW_KEY, jv); } catch { /* ignore */ }

    const ctd = validateOr(server.calendarTaskDate, VALID_CALENDAR_TASK_DATES, 'due');
    setCalendarTaskDate(ctd);
    try { localStorage.setItem(CALENDAR_TASK_DATE_KEY, ctd); } catch { /* ignore */ }

    const cst = validateOr(server.calendarShowTasks, VALID_CALENDAR_LAYER_TOGGLE, 'on');
    setCalendarShowTasks(cst);
    try { localStorage.setItem(CALENDAR_SHOW_TASKS_KEY, cst); } catch { /* ignore */ }

    const csj = validateOr(server.calendarShowJournals, VALID_CALENDAR_LAYER_TOGGLE, 'on');
    setCalendarShowJournals(csj);
    try { localStorage.setItem(CALENDAR_SHOW_JOURNALS_KEY, csj); } catch { /* ignore */ }

    const cdv = validateOr(server.calendarDefaultView, VALID_CALENDAR_DEFAULT_VIEWS, 'dayGridMonth');
    setCalendarDefaultView(cdv);
    try { localStorage.setItem(CALENDAR_DEFAULT_VIEW_KEY, cdv); } catch { /* ignore */ }

    const hv = validateOr(server.homeView, VALID_HOME_VIEWS, 'contacts');
    setHomeView(hv);
    try { localStorage.setItem(HOME_VIEW_KEY, hv); } catch { /* ignore */ }

    saveUpdatedAt(server.updatedAt);
  }, []); // state setters are stable references

  // On mount: fetch server settings and apply last-write-wins.
  // localStorage is already loaded synchronously above, so the UI is never blocked.
  useEffect(() => {
    fetchServerSettings()
      .then((server) => {
        const localTs = loadUpdatedAt();
        if (!server) {
          // Not logged in, no server record, or network error.
          // If we have local settings, push them so the server is seeded on next fetch.
          if (localTs > 0) {
            pushServerSettings({ ...readAllFromStorage(), updatedAt: localTs }).catch(() => {});
          }
          return;
        }
        if (server.updatedAt > localTs) {
          // Server is newer — apply and cache locally.
          applyFromServer(server);
        } else if (localTs > server.updatedAt) {
          // Local is newer — push to server.
          pushServerSettings({ ...readAllFromStorage(), updatedAt: localTs }).catch(() => {});
        }
        // Equal timestamps: in sync, nothing to do.
      })
      .catch(() => {}) // silently ignore unexpected errors
      .finally(() => setReady(true));
  }, [applyFromServer]);

  // ── Dark mode effect ──────────────────────────────────────────────────────────

  useEffect(() => {
    const apply = () => {
      const resolved =
        darkMode === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : darkMode;
      document.documentElement.classList.toggle('dark', resolved === 'dark');
    };
    apply();
    if (darkMode === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [darkMode]);

  return (
    <SettingsContext.Provider value={{ contactSort, updateContactSort, contactSubtitleField, updateContactSubtitleField, mapService, updateMapService, darkMode, updateDarkMode, taskDefaultLayout, updateTaskDefaultLayout, notesDefaultView, updateNotesDefaultView, journalsDefaultView, updateJournalsDefaultView, calendarTaskDate, updateCalendarTaskDate, calendarShowTasks, updateCalendarShowTasks, calendarShowJournals, updateCalendarShowJournals, calendarDefaultView, updateCalendarDefaultView, homeView, updateHomeView, ready }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
