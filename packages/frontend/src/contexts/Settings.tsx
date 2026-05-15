import { createContext, useContext, useState, useCallback } from 'react';

export type SortBy = 'first' | 'last';
export type SortDir = 'asc' | 'desc';
export type ContactSubtitleField = 'nickname' | 'email' | 'phone' | 'organization' | 'title' | '';

export interface ContactSortSettings {
  sortBy: SortBy;
  sortDir: SortDir;
}

interface SettingsContextValue {
  contactSort: ContactSortSettings;
  updateContactSort: (s: ContactSortSettings) => void;
  contactSubtitleField: ContactSubtitleField;
  updateContactSubtitleField: (f: ContactSubtitleField) => void;
}

const SORT_KEY = 'dave:settings:contactSort';
const SUBTITLE_KEY = 'dave:settings:contactSubtitleField';

const VALID_SUBTITLE_FIELDS: ContactSubtitleField[] = ['nickname', 'email', 'phone', 'organization', 'title', ''];

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

  return (
    <SettingsContext.Provider value={{ contactSort, updateContactSort, contactSubtitleField, updateContactSubtitleField }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
