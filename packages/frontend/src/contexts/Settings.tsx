import { createContext, useContext, useState, useCallback, useEffect } from 'react';

export type SortBy = 'first' | 'last';
export type SortDir = 'asc' | 'desc';
export type ContactSubtitleField = 'nickname' | 'email' | 'phone' | 'organization' | 'title' | '';
export type MapService = 'osm' | 'google' | 'apple';
export type DarkMode = 'light' | 'dark' | 'system';

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
}

const SORT_KEY = 'dave:settings:contactSort';
const SUBTITLE_KEY = 'dave:settings:contactSubtitleField';
const MAP_SERVICE_KEY = 'dave:settings:mapService';
const DARK_MODE_KEY = 'dave:settings:darkMode';

const VALID_SUBTITLE_FIELDS: ContactSubtitleField[] = ['nickname', 'email', 'phone', 'organization', 'title', ''];
const VALID_MAP_SERVICES: MapService[] = ['osm', 'google', 'apple'];
const VALID_DARK_MODES: DarkMode[] = ['light', 'dark', 'system'];

function loadDarkMode(): DarkMode {
  try {
    const raw = localStorage.getItem(DARK_MODE_KEY);
    if (raw !== null && VALID_DARK_MODES.includes(raw as DarkMode)) {
      return raw as DarkMode;
    }
  } catch {
    // ignore corrupt storage
  }
  return 'system';
}

function loadMapService(): MapService {
  try {
    const raw = localStorage.getItem(MAP_SERVICE_KEY);
    if (raw !== null && VALID_MAP_SERVICES.includes(raw as MapService)) {
      return raw as MapService;
    }
  } catch {
    // ignore corrupt storage
  }
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
  } catch {
    // ignore corrupt storage
  }
  return { sortBy: 'last', sortDir: 'asc' };
}

function loadContactSubtitleField(): ContactSubtitleField {
  try {
    const raw = localStorage.getItem(SUBTITLE_KEY);
    if (raw !== null && VALID_SUBTITLE_FIELDS.includes(raw as ContactSubtitleField)) {
      return raw as ContactSubtitleField;
    }
  } catch {
    // ignore corrupt storage
  }
  return '';
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [contactSort, setContactSort] = useState<ContactSortSettings>(loadContactSort);
  const [contactSubtitleField, setContactSubtitleField] = useState<ContactSubtitleField>(loadContactSubtitleField);
  const [mapService, setMapService] = useState<MapService>(loadMapService);
  const [darkMode, setDarkMode] = useState<DarkMode>(loadDarkMode);

  const updateContactSort = useCallback((s: ContactSortSettings) => {
    setContactSort(s);
    try {
      localStorage.setItem(SORT_KEY, JSON.stringify(s));
    } catch {
      // ignore write failures (private browsing quota)
    }
  }, []);

  const updateContactSubtitleField = useCallback((f: ContactSubtitleField) => {
    setContactSubtitleField(f);
    try {
      localStorage.setItem(SUBTITLE_KEY, f);
    } catch {
      // ignore write failures (private browsing quota)
    }
  }, []);

  const updateMapService = useCallback((s: MapService) => {
    setMapService(s);
    try {
      localStorage.setItem(MAP_SERVICE_KEY, s);
    } catch {
      // ignore write failures (private browsing quota)
    }
  }, []);

  const updateDarkMode = useCallback((m: DarkMode) => {
    setDarkMode(m);
    try {
      localStorage.setItem(DARK_MODE_KEY, m);
    } catch {
      // ignore write failures (private browsing quota)
    }
  }, []);

  // Apply .dark class to <html> and keep it in sync with system preference.
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
    <SettingsContext.Provider value={{ contactSort, updateContactSort, contactSubtitleField, updateContactSubtitleField, mapService, updateMapService, darkMode, updateDarkMode }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
