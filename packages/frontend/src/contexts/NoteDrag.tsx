import { createContext, useContext, useState } from 'react';
import type { Note } from '@dave/shared';

interface DragState {
  note: Note;
  onMove: (targetCollectionUrl: string) => void;
}

interface NoteDragContextValue {
  dragging: DragState | null;
  startDrag: (note: Note, onMove: (targetCollectionUrl: string) => void) => void;
  endDrag: () => void;
}

const NoteDragContext = createContext<NoteDragContextValue>({
  dragging: null,
  startDrag: () => {},
  endDrag: () => {},
});

export function NoteDragProvider({ children }: { children: React.ReactNode }) {
  const [dragging, setDragging] = useState<DragState | null>(null);

  return (
    <NoteDragContext.Provider
      value={{
        dragging,
        startDrag: (note, onMove) => setDragging({ note, onMove }),
        endDrag: () => setDragging(null),
      }}
    >
      {children}
    </NoteDragContext.Provider>
  );
}

export const useNoteDrag = () => useContext(NoteDragContext);
