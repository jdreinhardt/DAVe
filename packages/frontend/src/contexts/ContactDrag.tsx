import { createContext, useContext, useState } from 'react';
import type { Contact } from '@dave/shared';

interface DragState {
  contact: Contact;
  onMove: (targetAbId: string) => void;
}

interface ContactDragContextValue {
  dragging: DragState | null;
  startDrag: (contact: Contact, onMove: (targetAbId: string) => void) => void;
  endDrag: () => void;
}

const ContactDragContext = createContext<ContactDragContextValue>({
  dragging: null,
  startDrag: () => {},
  endDrag: () => {},
});

export function ContactDragProvider({ children }: { children: React.ReactNode }) {
  const [dragging, setDragging] = useState<DragState | null>(null);

  return (
    <ContactDragContext.Provider
      value={{
        dragging,
        startDrag: (contact, onMove) => setDragging({ contact, onMove }),
        endDrag: () => setDragging(null),
      }}
    >
      {children}
    </ContactDragContext.Provider>
  );
}

export const useContactDrag = () => useContext(ContactDragContext);
