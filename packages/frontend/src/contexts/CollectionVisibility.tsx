import { createContext, useContext, useState } from 'react';

interface CollectionVisibilityValue {
  hiddenAddressBooks: Set<string>;
  hiddenCalendars: Set<string>;
  // Per-calendar task-layer visibility on the Calendar view. Distinct from
  // hiddenCalendars (which controls events) so a calendar's events and its tasks
  // can be toggled independently. Toggling the parent calendar cascades to both.
  hiddenCalendarTasks: Set<string>;
  hiddenTaskCollections: Set<string>;
  // Notes and Journals share the same VJOURNAL collections — one toggle state per collection.
  hiddenVJournalCollections: Set<string>;
  toggleAddressBook: (id: string) => void;
  toggleCalendar: (id: string) => void;
  toggleCalendarTasks: (id: string) => void;
  toggleTaskCollection: (id: string) => void;
  toggleVJournalCollection: (id: string) => void;
  showAllAddressBooks: () => void;
  hideAllAddressBooks: (ids: string[]) => void;
  showAllCalendars: () => void;
  hideAllCalendars: (ids: string[]) => void;
  showAllTaskCollections: () => void;
  hideAllTaskCollections: (ids: string[]) => void;
  showAllVJournalCollections: () => void;
  hideAllVJournalCollections: (ids: string[]) => void;
}

const CollectionVisibilityContext = createContext<CollectionVisibilityValue | null>(null);

function makeToggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>) {
  return (id: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
}

function withId(set: Set<string>, id: string, present: boolean): Set<string> {
  const next = new Set(set);
  if (present) next.add(id); else next.delete(id);
  return next;
}

export function CollectionVisibilityProvider({ children }: { children: React.ReactNode }) {
  const [hiddenAddressBooks, setHiddenAddressBooks] = useState<Set<string>>(new Set());
  const [hiddenCalendars, setHiddenCalendars] = useState<Set<string>>(new Set());
  const [hiddenCalendarTasks, setHiddenCalendarTasks] = useState<Set<string>>(new Set());
  const [hiddenTaskCollections, setHiddenTaskCollections] = useState<Set<string>>(new Set());
  const [hiddenVJournalCollections, setHiddenVJournalCollections] = useState<Set<string>>(new Set());

  // The parent calendar toggle cascades to its task layer: hiding a calendar
  // hides both its events and its tasks; showing it shows both. The nested Tasks
  // toggle (toggleCalendarTasks) then lets the user override just the task layer.
  const toggleCalendar = (id: string) => {
    const willHide = !hiddenCalendars.has(id);
    setHiddenCalendars((prev) => withId(prev, id, willHide));
    setHiddenCalendarTasks((prev) => withId(prev, id, willHide));
  };

  return (
    <CollectionVisibilityContext.Provider
      value={{
        hiddenAddressBooks,
        hiddenCalendars,
        hiddenCalendarTasks,
        hiddenTaskCollections,
        hiddenVJournalCollections,
        toggleAddressBook: makeToggle(setHiddenAddressBooks),
        toggleCalendar,
        toggleCalendarTasks: makeToggle(setHiddenCalendarTasks),
        toggleTaskCollection: makeToggle(setHiddenTaskCollections),
        toggleVJournalCollection: makeToggle(setHiddenVJournalCollections),
        showAllAddressBooks: () => setHiddenAddressBooks(new Set()),
        hideAllAddressBooks: (ids) => setHiddenAddressBooks(new Set(ids)),
        showAllCalendars: () => { setHiddenCalendars(new Set()); setHiddenCalendarTasks(new Set()); },
        hideAllCalendars: (ids) => { setHiddenCalendars(new Set(ids)); setHiddenCalendarTasks(new Set(ids)); },
        showAllTaskCollections: () => setHiddenTaskCollections(new Set()),
        hideAllTaskCollections: (ids) => setHiddenTaskCollections(new Set(ids)),
        showAllVJournalCollections: () => setHiddenVJournalCollections(new Set()),
        hideAllVJournalCollections: (ids) => setHiddenVJournalCollections(new Set(ids)),
      }}
    >
      {children}
    </CollectionVisibilityContext.Provider>
  );
}

export function useCollectionVisibility() {
  const ctx = useContext(CollectionVisibilityContext);
  if (!ctx) throw new Error('useCollectionVisibility must be used within CollectionVisibilityProvider');
  return ctx;
}
