import { createContext, useContext, useState } from 'react';

interface CollectionVisibilityValue {
  hiddenAddressBooks: Set<string>;
  hiddenCalendars: Set<string>;
  hiddenTaskCollections: Set<string>;
  toggleAddressBook: (id: string) => void;
  toggleCalendar: (id: string) => void;
  toggleTaskCollection: (id: string) => void;
  showAllAddressBooks: () => void;
  hideAllAddressBooks: (ids: string[]) => void;
  showAllCalendars: () => void;
  hideAllCalendars: (ids: string[]) => void;
  showAllTaskCollections: () => void;
  hideAllTaskCollections: (ids: string[]) => void;
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

export function CollectionVisibilityProvider({ children }: { children: React.ReactNode }) {
  const [hiddenAddressBooks, setHiddenAddressBooks] = useState<Set<string>>(new Set());
  const [hiddenCalendars, setHiddenCalendars] = useState<Set<string>>(new Set());
  const [hiddenTaskCollections, setHiddenTaskCollections] = useState<Set<string>>(new Set());

  return (
    <CollectionVisibilityContext.Provider
      value={{
        hiddenAddressBooks,
        hiddenCalendars,
        hiddenTaskCollections,
        toggleAddressBook: makeToggle(setHiddenAddressBooks),
        toggleCalendar: makeToggle(setHiddenCalendars),
        toggleTaskCollection: makeToggle(setHiddenTaskCollections),
        showAllAddressBooks: () => setHiddenAddressBooks(new Set()),
        hideAllAddressBooks: (ids) => setHiddenAddressBooks(new Set(ids)),
        showAllCalendars: () => setHiddenCalendars(new Set()),
        hideAllCalendars: (ids) => setHiddenCalendars(new Set(ids)),
        showAllTaskCollections: () => setHiddenTaskCollections(new Set()),
        hideAllTaskCollections: (ids) => setHiddenTaskCollections(new Set(ids)),
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
