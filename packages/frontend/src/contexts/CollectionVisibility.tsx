import { createContext, useContext, useState } from 'react';

interface CollectionVisibilityValue {
  hiddenAddressBooks: Set<string>;
  hiddenCalendars: Set<string>;
  toggleAddressBook: (id: string) => void;
  toggleCalendar: (id: string) => void;
  showAllAddressBooks: () => void;
  hideAllAddressBooks: (ids: string[]) => void;
  showAllCalendars: () => void;
  hideAllCalendars: (ids: string[]) => void;
}

const CollectionVisibilityContext = createContext<CollectionVisibilityValue | null>(null);

export function CollectionVisibilityProvider({ children }: { children: React.ReactNode }) {
  const [hiddenAddressBooks, setHiddenAddressBooks] = useState<Set<string>>(new Set());
  const [hiddenCalendars, setHiddenCalendars] = useState<Set<string>>(new Set());

  const toggleAddressBook = (id: string) =>
    setHiddenAddressBooks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleCalendar = (id: string) =>
    setHiddenCalendars((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <CollectionVisibilityContext.Provider
      value={{
        hiddenAddressBooks,
        hiddenCalendars,
        toggleAddressBook,
        toggleCalendar,
        showAllAddressBooks: () => setHiddenAddressBooks(new Set()),
        hideAllAddressBooks: (ids) => setHiddenAddressBooks(new Set(ids)),
        showAllCalendars: () => setHiddenCalendars(new Set()),
        hideAllCalendars: (ids) => setHiddenCalendars(new Set(ids)),
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
