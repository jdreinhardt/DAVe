import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpDown,
  ChevronDown,
  ExternalLink,
  Grid,
  List,
  MoreVertical,
  PencilLine,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Note, NoteJson, NotesQueryParams, Calendar } from '@dave/shared';
import { fetchNotes, createNote, updateNote, deleteNote, triggerNotesSync } from '../api/notes';
import { getCalendars } from '../api/collections';
import { useCollectionVisibility } from '../contexts/CollectionVisibility';
import { useNoteDrag } from '../contexts/NoteDrag';
import { useIsMobile } from '../hooks/useIsMobile';
import { cn } from '../lib/utils';
import VJournalDetail from '../components/VJournalDetail';
import VJournalEditForm, { emptyNoteJson } from '../components/VJournalEditForm';
import BulkDeleteDialog from '../components/BulkDeleteDialog';
import NoteBulkEditModal, {
  applyNoteBulkEdit,
  type NoteBulkEditConfig,
  type NoteBulkEditFieldId,
} from '../components/NoteBulkEditModal';
import TagInput from '../components/TagInput';

// ── localStorage helpers ──────────────────────────────────────────────────────

function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function savePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Baikal stores colors as #RRGGBBAA. Strip alpha so we can append our own opacity suffix.
function hex6(color: string): string {
  if (color.startsWith('#') && color.length === 9) return color.slice(0, 7);
  return color;
}

// ── Date formatting ───────────────────────────────────────────────────────────

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: diffDays > 365 ? 'numeric' : undefined,
  });
}

function bodyPreview(text: string, maxLen = 100): string {
  const stripped = text
    .replace(/#+\s+/g, '')
    .replace(/[*_`[\]]/g, '')
    .trim();
  if (stripped.length <= maxLen) return stripped;
  return stripped.substring(0, maxLen).trimEnd() + '…';
}

// ── Empty state ───────────────────────────────────────────────────────────────

function NoCollectionsState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
      <div className="text-4xl mb-4">📝</div>
      <h2 className="text-base font-semibold text-foreground mb-1">No notes collections found</h2>
      <p className="text-sm text-muted-foreground max-w-xs mb-4">
        Your Baikal calendars don&apos;t currently support VJOURNAL components. Enable VJOURNAL on
        an existing collection or create a new one.
      </p>
      <a
        href="https://sabre.io/baikal/"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
      >
        Set up in Baikal <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

// ── Shared-values helper ──────────────────────────────────────────────────────

function computeSharedCategories(notes: Note[]): string[] {
  if (notes.length === 0) return [];
  const first = notes[0]!;
  return first.data.categories.filter((cat) => notes.every((n) => n.data.categories.includes(cat)));
}

// ── Multi-note selection panel ────────────────────────────────────────────────

function NoteMultiSelectPanel({
  notes,
  noteCollections,
  deleting,
  editing,
  moving,
  onOpenBulkEdit,
  onBulkMove,
  onDelete,
  onBack,
}: {
  notes: Note[];
  noteCollections: Calendar[];
  deleting: boolean;
  editing: boolean;
  moving: boolean;
  onOpenBulkEdit: (field?: NoteBulkEditFieldId) => void;
  onBulkMove: (collectionUrl: string) => void;
  onDelete: () => void;
  onBack: () => void;
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  const busy = deleting || editing || moving;
  const sharedCategories = computeSharedCategories(notes);

  return (
    <div className="bg-card flex flex-col overflow-hidden flex-1 border-l border-border">
      {/* Action header */}
      <div className="flex items-center px-4 py-2 border-b border-border shrink-0 gap-2">
        <button
          onClick={onBack}
          className="md:hidden shrink-0 rounded p-1 text-muted-foreground hover:bg-muted"
          aria-label="Back"
        >
          ←
        </button>
        <span className="text-xs text-muted-foreground flex-1">
          {notes.length} note{notes.length !== 1 ? 's' : ''} selected
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onOpenBulkEdit()}
            disabled={busy}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <PencilLine className="h-3.5 w-3.5" /> Edit
          </button>

          {noteCollections.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setMoveOpen((o) => !o)}
                disabled={busy}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                Move <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {moveOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMoveOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 w-48 rounded-md border border-border bg-background shadow-lg py-1 text-sm">
                    {noteCollections.map((col) => (
                      <button
                        key={col.id}
                        onClick={() => {
                          setMoveOpen(false);
                          onBulkMove(col.url);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted truncate"
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: hex6(col.color) || '#6C757D' }}
                        />
                        {col.displayName}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <button
            onClick={onDelete}
            disabled={busy}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      </div>

      {/* Shared values */}
      <div className="px-4 py-3 border-b border-border shrink-0 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Shared
        </p>

        {/* Categories */}
        <div className="flex items-start gap-2">
          <span className="w-24 shrink-0 text-xs text-muted-foreground mt-0.5">Categories</span>
          <div className="flex-1 min-w-0 flex flex-wrap gap-1">
            {sharedCategories.length > 0 ? (
              sharedCategories.map((c) => (
                <span
                  key={c}
                  className="text-xs bg-muted/70 text-muted-foreground px-1.5 py-0.5 rounded-full"
                >
                  {c}
                </span>
              ))
            ) : (
              <span className="text-xs text-muted-foreground/60 italic">None shared</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => onOpenBulkEdit('categories_add')}
              className="text-xs text-primary hover:underline"
            >
              Add
            </button>
            {sharedCategories.length > 0 && (
              <button
                onClick={() => onOpenBulkEdit('categories_remove')}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Selected note cards */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-2">
          {notes.map((n) => (
            <div key={n.uid} className="flex flex-col gap-1.5 p-3 rounded-lg border border-border">
              <p className="text-sm font-medium truncate w-full leading-snug">
                {n.data.summary || <span className="italic text-muted-foreground">(no title)</span>}
              </p>
              {n.data.description && (
                <p className="text-xs text-muted-foreground line-clamp-2 leading-snug">
                  {bodyPreview(n.data.description, 80)}
                </p>
              )}
              {n.data.categories.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {n.data.categories.slice(0, 2).map((c) => (
                    <span
                      key={c}
                      className="text-xs bg-muted/70 text-muted-foreground px-1.5 py-0.5 rounded-full"
                    >
                      {c}
                    </span>
                  ))}
                  {n.data.categories.length > 2 && (
                    <span className="text-xs text-muted-foreground/60">
                      +{n.data.categories.length - 2}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NotesPage() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { startDrag, endDrag } = useNoteDrag();

  // Preferences persisted in localStorage
  const [view, setView] = useState<'list' | 'grid'>(() =>
    loadPref('notes.view', 'list' as 'list' | 'grid'),
  );
  const [sort, setSort] = useState<NotesQueryParams['sort']>(() =>
    loadPref('notes.sort', 'modified' as NotesQueryParams['sort']),
  );
  const [order, setOrder] = useState<'asc' | 'desc'>(() =>
    loadPref('notes.order', 'desc' as 'asc' | 'desc'),
  );
  const [categoryFilter, setCategoryFilter] = useState<string>(() =>
    loadPref('notes.category', ''),
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // UI state
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkEditInitialField, setBulkEditInitialField] = useState<NoteBulkEditFieldId | undefined>(
    undefined,
  );

  // ── Panel resize ──────────────────────────────────────────────────────────
  const PANEL_MIN = 240;
  const PANEL_MAX = 1500;
  const [panelWidth, setPanelWidth] = useState<number>(() => loadPref('notes.panelWidth', 440));
  useEffect(() => {
    savePref('notes.panelWidth', panelWidth);
  }, [panelWidth]);

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = panelWidth;
      const onMove = (ev: MouseEvent) => {
        const delta = startX - ev.clientX;
        setPanelWidth(Math.max(PANEL_MIN, Math.min(PANEL_MAX, startWidth + delta)));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [panelWidth],
  );

  const [detailPanelWidth, setDetailPanelWidth] = useState<number>(() =>
    loadPref('notes.detailPanelWidth', 440),
  );
  useEffect(() => {
    savePref('notes.detailPanelWidth', detailPanelWidth);
  }, [detailPanelWidth]);

  const startDetailResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = detailPanelWidth;
      const onMove = (ev: MouseEvent) => {
        const delta = startX - ev.clientX;
        setDetailPanelWidth(Math.max(PANEL_MIN, Math.min(PANEL_MAX, startWidth + delta)));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [detailPanelWidth],
  );

  // Per-note kebab actions
  const [noteForConvert, setNoteForConvert] = useState<Note | null>(null);
  const [noteForTagEdit, setNoteForTagEdit] = useState<Note | null>(null);
  const [noteForDelete, setNoteForDelete] = useState<Note | null>(null);

  // Toast
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // Persist preferences
  useEffect(() => {
    savePref('notes.view', view);
  }, [view]);
  useEffect(() => {
    savePref('notes.sort', sort);
  }, [sort]);
  useEffect(() => {
    savePref('notes.order', order);
  }, [order]);
  useEffect(() => {
    savePref('notes.category', categoryFilter);
  }, [categoryFilter]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 150);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const { hiddenVJournalCollections } = useCollectionVisibility();

  const calQuery = useQuery({
    queryKey: ['calendars'],
    queryFn: getCalendars,
    staleTime: 5 * 60_000,
  });

  const vjournalCalendars: Calendar[] = useMemo(
    () => (calQuery.data ?? []).filter((c) => c.components.includes('VJOURNAL')),
    [calQuery.data],
  );

  const visibleCollectionUrls = useMemo(
    () => vjournalCalendars.filter((c) => !hiddenVJournalCollections.has(c.id)).map((c) => c.url),
    [vjournalCalendars, hiddenVJournalCollections],
  );

  const hasCollections = calQuery.data !== undefined && vjournalCalendars.length > 0;

  const params: NotesQueryParams = {
    sort,
    order,
    ...(categoryFilter ? { category: categoryFilter } : {}),
    ...(debouncedQuery ? { q: debouncedQuery } : {}),
    ...(visibleCollectionUrls.length > 0 ? { collections: visibleCollectionUrls.join(',') } : {}),
  };

  const notesQuery = useQuery({
    queryKey: ['notes', params],
    queryFn: () => fetchNotes(params),
    enabled: hasCollections,
    staleTime: 30_000,
  });

  const notes = useMemo(() => notesQuery.data?.notes ?? [], [notesQuery.data]);

  // Kick off initial sync on first load
  useEffect(() => {
    if (hasCollections) {
      triggerNotesSync().catch(() => {
        /* non-fatal */
      });
    }
  }, [hasCollections]);

  // Close detail when filtered out
  useEffect(() => {
    if (selectedUid && !notes.some((n) => n.uid === selectedUid)) {
      setSelectedUid(null);
    }
  }, [notes, selectedUid]);

  // Drop selected items that are no longer in the visible set
  useEffect(() => {
    if (selectedUids.size === 0) return;
    const visibleUids = new Set(notes.map((n) => n.uid));
    const dropped = [...selectedUids].filter((uid) => !visibleUids.has(uid));
    if (dropped.length > 0) {
      setSelectedUids((prev) => {
        const next = new Set(prev);
        for (const uid of dropped) next.delete(uid);
        return next;
      });
      showToast(
        `${dropped.length} note${dropped.length !== 1 ? 's' : ''} removed from selection because ${dropped.length !== 1 ? 'they no longer match' : 'it no longer matches'} the filter`,
      );
    }
  }, [notes, selectedUids, showToast]);

  const selectedNote = useMemo(
    () => notes.find((n) => n.uid === selectedUid) ?? null,
    [notes, selectedUid],
  );

  const selectedNotes = useMemo(
    () => notes.filter((n) => selectedUids.has(n.uid)),
    [notes, selectedUids],
  );

  // ── Collection display maps ───────────────────────────────────────────────

  const collectionNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const cal of vjournalCalendars) map.set(cal.url, cal.displayName);
    return map;
  }, [vjournalCalendars]);

  const collectionColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const cal of vjournalCalendars) map.set(cal.url, cal.color);
    return map;
  }, [vjournalCalendars]);

  // ── All unique categories for filter chips ────────────────────────────────

  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const n of notes) {
      for (const c of n.data.categories) cats.add(c);
    }
    return [...cats].sort();
  }, [notes]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const invalidateNotes = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['notes'] });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (data: NoteJson) => createNote(data),
    onSuccess: (result) => {
      invalidateNotes();
      setCreatingNew(false);
      setSelectedUid(result.uid);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ uid, data, etag }: { uid: string; data: NoteJson; etag: string }) =>
      updateNote(uid, data, etag),
    onSuccess: () => {
      invalidateNotes();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ uid, etag }: { uid: string; etag: string }) => deleteNote(uid, etag),
    onSuccess: () => {
      invalidateNotes();
      setSelectedUid(null);
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (toDelete: Note[]) =>
      Promise.allSettled(toDelete.map((n) => deleteNote(n.uid, n.etag))),
    onSuccess: (results) => {
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const fail = results.filter((r) => r.status === 'rejected').length;
      setShowBulkDelete(false);
      setSelectedUids(new Set());
      setSelectedUid(null);
      showToast(`Deleted ${ok} note${ok !== 1 ? 's' : ''}${fail ? ` (${fail} failed)` : ''}`);
      invalidateNotes();
    },
    onError: () => {
      setShowBulkDelete(false);
      showToast('Bulk delete failed.');
    },
  });

  const bulkEditMutation = useMutation({
    mutationFn: ({ notesToEdit, config }: { notesToEdit: Note[]; config: NoteBulkEditConfig }) =>
      Promise.allSettled(
        notesToEdit.map((n) => {
          const newData = applyNoteBulkEdit(n.data, config);
          return updateNote(n.uid, newData, n.etag);
        }),
      ),
    onSuccess: (results) => {
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const fail = results.filter((r) => r.status === 'rejected').length;
      setShowBulkEdit(false);
      showToast(`Updated ${ok} note${ok !== 1 ? 's' : ''}${fail ? ` (${fail} failed)` : ''}`);
      invalidateNotes();
    },
    onError: () => {
      setShowBulkEdit(false);
      showToast('Bulk edit failed.');
    },
  });

  const bulkMoveMutation = useMutation({
    mutationFn: ({ notesToMove, collectionUrl }: { notesToMove: Note[]; collectionUrl: string }) =>
      Promise.allSettled(
        notesToMove.map((n) => {
          const newData = { ...n.data, collectionUrl };
          return updateNote(n.uid, newData, n.etag);
        }),
      ),
    onSuccess: (results) => {
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const fail = results.filter((r) => r.status === 'rejected').length;
      setSelectedUids(new Set());
      showToast(`Moved ${ok} note${ok !== 1 ? 's' : ''}${fail ? ` (${fail} failed)` : ''}`);
      invalidateNotes();
    },
    onError: () => showToast('Bulk move failed.'),
  });

  const singleTagEditMutation = useMutation({
    mutationFn: ({ uid, data, etag }: { uid: string; data: NoteJson; etag: string }) =>
      updateNote(uid, data, etag),
    onSuccess: () => {
      invalidateNotes();
      setNoteForTagEdit(null);
    },
    onError: () => showToast('Failed to update tags.'),
  });

  const singleDeleteMutation = useMutation({
    mutationFn: ({ uid, etag }: { uid: string; etag: string }) => deleteNote(uid, etag),
    onSuccess: (_, { uid }) => {
      invalidateNotes();
      setNoteForDelete(null);
      if (selectedUid === uid) setSelectedUid(null);
    },
    onError: () => showToast('Delete failed.'),
  });

  // ── Multi-select helpers ──────────────────────────────────────────────────

  const toggleSelect = useCallback(
    (uid: string, shift?: boolean, lastSelected?: string | null) => {
      setSelectedUids((prev) => {
        const next = new Set(prev);
        if (shift && lastSelected) {
          const ids = notes.map((n) => n.uid);
          const a = ids.indexOf(lastSelected);
          const b = ids.indexOf(uid);
          const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
          for (let i = lo; i <= hi; i++) {
            const id = ids[i];
            if (id === undefined) continue;
            if (!prev.has(id)) next.add(id);
            else next.delete(id);
          }
        } else {
          if (next.has(uid)) next.delete(uid);
          else next.add(uid);
        }
        return next;
      });
    },
    [notes],
  );

  const clearSelection = useCallback(() => setSelectedUids(new Set()), []);

  const selectAll = useCallback(() => {
    setSelectedUids(new Set(notes.map((n) => n.uid)));
  }, [notes]);

  const handleEnterMultiSelect = useCallback((uid: string) => {
    setSelectedUids(new Set([uid]));
    setSelectedUid(null);
    setCreatingNew(false);
  }, []);

  const handleOpenBulkEdit = useCallback((field?: NoteBulkEditFieldId) => {
    setBulkEditInitialField(field);
    setShowBulkEdit(true);
  }, []);

  const handleBulkEdit = useCallback(
    (config: NoteBulkEditConfig) => {
      bulkEditMutation.mutate({ notesToEdit: selectedNotes, config });
    },
    [bulkEditMutation, selectedNotes],
  );

  const handleBulkMove = useCallback(
    (collectionUrl: string) => {
      bulkMoveMutation.mutate({ notesToMove: selectedNotes, collectionUrl });
    },
    [bulkMoveMutation, selectedNotes],
  );

  const handleBulkDelete = useCallback(() => {
    setShowBulkDelete(true);
  }, []);

  const handleMoveNote = useCallback(
    (note: Note, collectionUrl: string) => {
      updateMutation.mutate({
        uid: note.uid,
        data: { ...note.data, collectionUrl },
        etag: note.etag,
      });
    },
    [updateMutation],
  );

  const handleCardDragStart = useCallback(
    (note: Note) => {
      if (selectedUids.has(note.uid) && selectedUids.size > 1) {
        const all = notes.filter((n) => selectedUids.has(n.uid));
        startDrag(note, (targetCollectionUrl) =>
          bulkMoveMutation.mutate({ notesToMove: all, collectionUrl: targetCollectionUrl }),
        );
      } else {
        startDrag(note, (targetCollectionUrl) =>
          updateMutation.mutate({
            uid: note.uid,
            data: { ...note.data, collectionUrl: targetCollectionUrl },
            etag: note.etag,
          }),
        );
      }
    },
    [startDrag, selectedUids, notes, bulkMoveMutation, updateMutation],
  );

  const handleCardDragEnd = useCallback(() => {
    endDrag();
  }, [endDrag]);

  const handleInitiateConvert = useCallback((note: Note) => {
    setNoteForConvert(note);
  }, []);

  const handleInitiateTagEdit = useCallback((note: Note) => {
    setNoteForTagEdit(note);
  }, []);

  const handleInitiateDelete = useCallback((note: Note) => {
    setNoteForDelete(note);
  }, []);

  // ── Convert note → journal ────────────────────────────────────────────────

  const handleConvertToJournal = useCallback(
    (uid: string, data: NoteJson, etag: string, dtstart: string) => {
      const updated: NoteJson = { ...data, dtstart };
      updateMutation.mutate(
        { uid, data: updated, etag },
        {
          onSuccess: () => {
            setSelectedUid(null);
            navigate('/journals');
          },
        },
      );
    },
    [updateMutation, navigate],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (calQuery.isLoading) return null;

  if (calQuery.data && vjournalCalendars.length === 0) {
    return <NoCollectionsState />;
  }

  const isMultiSelect = selectedUids.size > 0;
  const showMultiPanel = isMultiSelect && !creatingNew;
  const showDetailPanel = (selectedNote && !creatingNew && !isMultiSelect) || creatingNew;
  const defaultCollectionUrl =
    vjournalCalendars.find((c) => !hiddenVJournalCollections.has(c.id))?.url ??
    vjournalCalendars[0]?.url ??
    '';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar — full width */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0 flex-wrap">
        {/* New note — left */}
        <button
          onClick={() => {
            setCreatingNew(true);
            setSelectedUid(null);
            clearSelection();
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          New note
        </button>

        {/* Search */}
        <div className="relative flex-1 min-w-40 max-w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search notes…"
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Sort */}
        <select
          value={sort ?? ''}
          onChange={(e) => setSort((e.target.value as NotesQueryParams['sort']) || undefined)}
          className="text-sm rounded-md border border-input bg-background px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="">Default sort</option>
          <option value="modified">Modified</option>
          <option value="summary">Title</option>
          <option value="created">Created</option>
          <option value="category">Category</option>
        </select>

        {sort && (
          <button
            onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
            title={`Sort ${order === 'asc' ? 'ascending' : 'descending'} — click to toggle`}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowUpDown className="h-4 w-4" />
          </button>
        )}

        {/* View toggle — right */}
        <div className="flex items-center gap-0.5 rounded-md border border-input p-0.5 ml-auto shrink-0">
          <button
            onClick={() => setView('list')}
            className={cn(
              'p-1 rounded transition-colors',
              view === 'list'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title="List view"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            onClick={() => setView('grid')}
            className={cn(
              'p-1 rounded transition-colors',
              view === 'grid'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title="Grid view"
          >
            <Grid className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Category filter chips — full width */}
      {allCategories.length > 0 && (
        <div className="flex gap-1.5 px-3 py-1.5 overflow-x-auto shrink-0 border-b border-border">
          <button
            onClick={() => setCategoryFilter('')}
            className={cn(
              'text-xs px-2 py-0.5 rounded-full border transition-colors shrink-0',
              !categoryFilter
                ? 'bg-primary/10 border-primary/30 text-primary'
                : 'border-input text-muted-foreground hover:border-primary/30 hover:text-foreground',
            )}
          >
            All
          </button>
          {allCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat === categoryFilter ? '' : cat)}
              className={cn(
                'text-xs px-2 py-0.5 rounded-full border transition-colors shrink-0 flex items-center gap-1',
                cat === categoryFilter
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'border-input text-muted-foreground hover:border-primary/30 hover:text-foreground',
              )}
            >
              <Tag className="h-2.5 w-2.5" /> {cat}
            </button>
          ))}
        </div>
      )}

      {/* Content row: list + detail/multi-panel */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* List/grid pane */}
        <div
          className={cn(
            'flex flex-col h-full overflow-hidden flex-1 min-w-75',
            (showDetailPanel || showMultiPanel) && isMobile ? 'hidden' : '',
          )}
        >
          {/* Selection count + All / None / Cancel bar */}
          {isMultiSelect && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/5 border-b border-border shrink-0">
              <span className="text-xs text-muted-foreground flex-1">
                {selectedUids.size} selected
              </span>
              <button
                onClick={selectAll}
                className="text-xs text-primary hover:underline transition-colors"
              >
                All
              </button>
              <span className="text-muted-foreground/40 text-xs">·</span>
              <button
                onClick={clearSelection}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                None
              </button>
              <button
                onClick={clearSelection}
                title="Clear selection"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div
            className={cn(
              'flex-1 overflow-y-auto',
              view === 'grid' ? 'grid gap-2 p-3 content-start' : '',
            )}
            style={view === 'grid' ? { gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' } : undefined}
          >
            {notesQuery.isLoading && (
              <div className="flex items-center justify-center h-24">
                <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              </div>
            )}

            {!notesQuery.isLoading && notes.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-12 px-4">
                {debouncedQuery || categoryFilter
                  ? 'No matching notes.'
                  : 'No notes yet. Create your first one.'}
              </p>
            )}

            {notes.map((note) => (
              <NoteCard
                key={note.uid}
                note={note}
                view={view}
                isSelected={selectedUid === note.uid}
                isChecked={selectedUids.has(note.uid)}
                onSelect={(uid) => {
                  setSelectedUid(uid);
                  setCreatingNew(false);
                }}
                onToggleCheck={(uid, shift) => toggleSelect(uid, shift, selectedUid)}
                onEnterMultiSelect={handleEnterMultiSelect}
                onInitiateConvert={handleInitiateConvert}
                onInitiateTagEdit={handleInitiateTagEdit}
                onInitiateDelete={handleInitiateDelete}
                onMoveNote={handleMoveNote}
                onDragStart={handleCardDragStart}
                onDragEnd={handleCardDragEnd}
                noteCollections={vjournalCalendars}
                multiSelectActive={isMultiSelect}
                collectionName={collectionNameMap.get(note.data.collectionUrl)}
                collectionColor={collectionColorMap.get(note.data.collectionUrl)}
              />
            ))}
          </div>
        </div>

        {/* Multi-select panel */}
        {showMultiPanel && !isMobile && (
          <div className="flex shrink-0" style={{ width: panelWidth }}>
            <div
              className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
              onMouseDown={startResize}
              title="Drag to resize"
            />
            <NoteMultiSelectPanel
              notes={selectedNotes}
              noteCollections={vjournalCalendars}
              deleting={bulkDeleteMutation.isPending}
              editing={bulkEditMutation.isPending}
              moving={bulkMoveMutation.isPending}
              onOpenBulkEdit={handleOpenBulkEdit}
              onBulkMove={handleBulkMove}
              onDelete={handleBulkDelete}
              onBack={clearSelection}
            />
          </div>
        )}
        {showMultiPanel && isMobile && (
          <div className="fixed inset-0 z-50 flex flex-col bg-background">
            <NoteMultiSelectPanel
              notes={selectedNotes}
              noteCollections={vjournalCalendars}
              deleting={bulkDeleteMutation.isPending}
              editing={bulkEditMutation.isPending}
              moving={bulkMoveMutation.isPending}
              onOpenBulkEdit={handleOpenBulkEdit}
              onBulkMove={handleBulkMove}
              onDelete={handleBulkDelete}
              onBack={clearSelection}
            />
          </div>
        )}

        {/* Detail / edit panel — desktop */}
        {showDetailPanel && !isMobile && (
          <div className="flex shrink-0" style={{ width: detailPanelWidth }}>
            <div
              className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
              onMouseDown={startDetailResize}
              title="Drag to resize"
            />
            <div className="flex-1 flex flex-col h-full overflow-hidden bg-background border-l border-border">
              {creatingNew && (
                <VJournalEditForm
                  initial={emptyNoteJson(defaultCollectionUrl)}
                  calendars={vjournalCalendars}
                  mode="note"
                  isNew
                  saving={createMutation.isPending}
                  onSave={(data) => createMutation.mutate(data)}
                  onCancel={() => setCreatingNew(false)}
                />
              )}
              {selectedNote && !creatingNew && (
                <VJournalDetail
                  note={selectedNote}
                  mode="note"
                  calendars={vjournalCalendars}
                  saving={updateMutation.isPending}
                  onSave={(uid, data, etag) => updateMutation.mutate({ uid, data, etag })}
                  onDelete={(uid, etag) => deleteMutation.mutate({ uid, etag })}
                  onClose={() => setSelectedUid(null)}
                  onConvertToJournal={handleConvertToJournal}
                />
              )}
            </div>
          </div>
        )}

        {/* Detail / edit panel — mobile */}
        {showDetailPanel && isMobile && (
          <div className="w-full absolute inset-0 z-10 flex flex-col h-full overflow-hidden bg-background">
            <button
              onClick={() => {
                setSelectedUid(null);
                setCreatingNew(false);
              }}
              className="flex items-center gap-1 px-3 py-2 text-sm text-muted-foreground hover:text-foreground border-b border-border shrink-0"
            >
              ← Back
            </button>
            {creatingNew && (
              <VJournalEditForm
                initial={emptyNoteJson(defaultCollectionUrl)}
                calendars={vjournalCalendars}
                mode="note"
                isNew
                saving={createMutation.isPending}
                onSave={(data) => createMutation.mutate(data)}
                onCancel={() => setCreatingNew(false)}
              />
            )}
            {selectedNote && !creatingNew && (
              <VJournalDetail
                note={selectedNote}
                mode="note"
                calendars={vjournalCalendars}
                saving={updateMutation.isPending}
                onSave={(uid, data, etag) => updateMutation.mutate({ uid, data, etag })}
                onDelete={(uid, etag) => deleteMutation.mutate({ uid, etag })}
                onClose={() => setSelectedUid(null)}
                onConvertToJournal={handleConvertToJournal}
              />
            )}
          </div>
        )}
      </div>

      {/* Bulk delete dialog */}
      {showBulkDelete && (
        <BulkDeleteDialog
          count={selectedUids.size}
          deleting={bulkDeleteMutation.isPending}
          onConfirm={() => {
            bulkDeleteMutation.mutate(selectedNotes);
          }}
          onCancel={() => setShowBulkDelete(false)}
        />
      )}

      {/* Bulk edit modal */}
      {showBulkEdit && (
        <NoteBulkEditModal
          count={selectedUids.size}
          initialField={bulkEditInitialField}
          applying={bulkEditMutation.isPending}
          onApply={handleBulkEdit}
          onCancel={() => setShowBulkEdit(false)}
        />
      )}

      {/* Convert to journal dialog */}
      {noteForConvert && (
        <ConvertToJournalDialog
          note={noteForConvert}
          converting={updateMutation.isPending}
          onConfirm={(dtstart) =>
            handleConvertToJournal(
              noteForConvert.uid,
              noteForConvert.data,
              noteForConvert.etag,
              dtstart,
            )
          }
          onCancel={() => setNoteForConvert(null)}
        />
      )}

      {/* Edit tags dialog */}
      {noteForTagEdit && (
        <EditTagsDialog
          note={noteForTagEdit}
          saving={singleTagEditMutation.isPending}
          onSave={(categories) =>
            singleTagEditMutation.mutate({
              uid: noteForTagEdit.uid,
              data: { ...noteForTagEdit.data, categories },
              etag: noteForTagEdit.etag,
            })
          }
          onCancel={() => setNoteForTagEdit(null)}
        />
      )}

      {/* Per-note delete dialog */}
      {noteForDelete && (
        <BulkDeleteDialog
          count={1}
          noun="note"
          deleting={singleDeleteMutation.isPending}
          onConfirm={() =>
            singleDeleteMutation.mutate({ uid: noteForDelete.uid, etag: noteForDelete.etag })
          }
          onCancel={() => setNoteForDelete(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-foreground text-background text-xs px-4 py-2 shadow-lg pointer-events-none">
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Inline per-note dialogs ───────────────────────────────────────────────────

function ConvertToJournalDialog({
  note,
  converting,
  onConfirm,
  onCancel,
}: {
  note: Note;
  converting: boolean;
  onConfirm: (dtstart: string) => void;
  onCancel: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border border-border rounded-lg shadow-xl p-6 w-full max-w-sm">
        <h2 className="text-sm font-semibold mb-0.5">Convert to Journal</h2>
        <p className="text-xs text-muted-foreground mb-4 truncate">
          &ldquo;{note.data.summary || 'Untitled'}&rdquo; will move to the Journals tab.
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Journal date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={converting}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (date) onConfirm(date);
            }}
            disabled={converting || !date}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {converting ? 'Converting…' : 'Convert'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditTagsDialog({
  note,
  saving,
  onSave,
  onCancel,
}: {
  note: Note;
  saving: boolean;
  onSave: (categories: string[]) => void;
  onCancel: () => void;
}) {
  const [categories, setCategories] = useState<string[]>(note.data.categories);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border border-border rounded-lg shadow-xl p-6 w-full max-w-sm">
        <h2 className="text-sm font-semibold mb-0.5">Edit tags</h2>
        <p className="text-xs text-muted-foreground mb-4 truncate">
          &ldquo;{note.data.summary || 'Untitled'}&rdquo;
        </p>
        <TagInput value={categories} onChange={setCategories} />
        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(categories)}
            disabled={saving}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Note card ─────────────────────────────────────────────────────────────────

interface NoteCardProps {
  note: Note;
  view: 'list' | 'grid';
  isSelected: boolean;
  isChecked: boolean;
  onSelect: (uid: string) => void;
  onToggleCheck: (uid: string, shift: boolean) => void;
  onEnterMultiSelect: (uid: string) => void;
  onInitiateConvert: (note: Note) => void;
  onInitiateTagEdit: (note: Note) => void;
  onInitiateDelete: (note: Note) => void;
  onMoveNote: (note: Note, collectionUrl: string) => void;
  onDragStart: (note: Note) => void;
  onDragEnd: () => void;
  noteCollections: Calendar[];
  multiSelectActive: boolean;
  collectionName?: string;
  collectionColor?: string;
}

function NoteCard({
  note,
  view,
  isSelected,
  isChecked,
  onSelect,
  onToggleCheck,
  onEnterMultiSelect,
  onInitiateConvert,
  onInitiateTagEdit,
  onInitiateDelete,
  onMoveNote,
  onDragStart,
  onDragEnd,
  noteCollections,
  multiSelectActive,
  collectionName,
  collectionColor,
}: NoteCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showMoveSubmenu, setShowMoveSubmenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { data } = note;
  const preview = bodyPreview(data.description);

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || multiSelectActive) {
      onToggleCheck(note.uid, e.shiftKey);
    } else {
      onSelect(note.uid);
    }
  };

  const handleMenuToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen((o) => {
      if (o) setShowMoveSubmenu(false);
      return !o;
    });
  };

  const closeMenu = () => {
    setMenuOpen(false);
    setShowMoveSubmenu(false);
  };

  const checkbox = (
    <div
      className={cn(
        'h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition-colors',
        isChecked ? 'bg-primary border-primary' : 'border-muted-foreground/40',
      )}
    >
      {isChecked && <span className="text-primary-foreground text-[10px] font-bold">✓</span>}
    </div>
  );

  if (view === 'grid') {
    return (
      <div
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          onDragStart(note);
        }}
        onDragEnd={onDragEnd}
        onClick={handleClick}
        className={cn(
          'group/card relative rounded-lg border border-border bg-card p-3 cursor-pointer transition-colors hover:border-primary/40',
          isSelected && 'border-primary bg-primary/5',
          isChecked && 'border-primary/60 bg-primary/10',
        )}
      >
        {/* Checkbox overlay — top-left */}
        {multiSelectActive && <div className="absolute top-2 left-2">{checkbox}</div>}

        {/* Context menu button — hover only */}
        {!multiSelectActive && (
          <div
            ref={menuRef}
            className="absolute top-2 right-2 opacity-0 group-hover/card:opacity-100 transition-opacity"
          >
            <button
              onClick={handleMenuToggle}
              className="rounded p-0.5 text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted transition-colors"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={closeMenu} />
                <div className="absolute right-0 top-full mt-1 z-20 w-44 rounded-md border border-border bg-background shadow-lg py-1 text-sm">
                  {showMoveSubmenu ? (
                    <>
                      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border mb-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowMoveSubmenu(false);
                          }}
                          className="text-muted-foreground hover:text-foreground leading-none"
                        >
                          ←
                        </button>
                        <span className="text-xs text-muted-foreground">Move to</span>
                      </div>
                      {noteCollections.map((col) => (
                        <button
                          key={col.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            closeMenu();
                            onMoveNote(note, col.url);
                          }}
                          disabled={note.data.collectionUrl === col.url}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted disabled:opacity-40 disabled:cursor-default"
                        >
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: hex6(col.color) || '#6C757D' }}
                          />
                          {col.displayName}
                        </button>
                      ))}
                    </>
                  ) : (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          closeMenu();
                          onEnterMultiSelect(note.uid);
                        }}
                        className="w-full px-3 py-1.5 text-left hover:bg-muted"
                      >
                        Select
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          closeMenu();
                          onInitiateTagEdit(note);
                        }}
                        className="w-full px-3 py-1.5 text-left hover:bg-muted"
                      >
                        Edit tags
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          closeMenu();
                          onInitiateConvert(note);
                        }}
                        className="w-full px-3 py-1.5 text-left hover:bg-muted"
                      >
                        Convert to Journal
                      </button>
                      {noteCollections.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowMoveSubmenu(true);
                          }}
                          className="w-full px-3 py-1.5 text-left hover:bg-muted"
                        >
                          Move to…
                        </button>
                      )}
                      <div className="border-t border-border my-1" />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          closeMenu();
                          onInitiateDelete(note);
                        }}
                        className="w-full px-3 py-1.5 text-left text-destructive hover:bg-destructive/10"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <p
          className={cn(
            'text-sm font-medium text-foreground mb-1 line-clamp-2 min-h-5',
            multiSelectActive && 'ml-5',
          )}
        >
          {data.summary || <span className="italic text-muted-foreground">Untitled</span>}
        </p>
        {preview && <p className="text-xs text-muted-foreground line-clamp-3 mb-2">{preview}</p>}
        <div className="flex items-center gap-2 mt-auto flex-wrap">
          {collectionName && (
            <span
              className={cn(
                'text-xs px-1.5 py-0.5 rounded font-medium shrink-0',
                !collectionColor && 'bg-muted text-muted-foreground',
              )}
              style={
                collectionColor
                  ? { backgroundColor: hex6(collectionColor) + '33', color: hex6(collectionColor) }
                  : undefined
              }
            >
              {collectionName}
            </span>
          )}
          <span className="text-xs text-muted-foreground/60 ml-auto">
            {formatRelative(data.lastModified)}
          </span>
        </div>
      </div>
    );
  }

  // List view
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        onDragStart(note);
      }}
      onDragEnd={onDragEnd}
      onClick={handleClick}
      className={cn(
        'group/card flex items-start gap-3 px-3 py-3 rounded-md cursor-pointer transition-colors mx-1 my-0.5',
        isChecked ? 'bg-primary/10' : isSelected ? 'bg-primary/5' : 'hover:bg-muted',
      )}
    >
      {/* Multi-select check indicator */}
      {multiSelectActive && <div className="mt-0.5">{checkbox}</div>}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {data.summary || <span className="italic text-muted-foreground">Untitled</span>}
        </p>
        {preview && <p className="text-xs text-muted-foreground truncate mt-0.5">{preview}</p>}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {collectionName && (
            <span
              className={cn(
                'text-xs px-1.5 py-0.5 rounded font-medium shrink-0',
                !collectionColor && 'bg-muted text-muted-foreground',
              )}
              style={
                collectionColor
                  ? { backgroundColor: hex6(collectionColor) + '33', color: hex6(collectionColor) }
                  : undefined
              }
            >
              {collectionName}
            </span>
          )}
          <span className="text-xs text-muted-foreground/60">
            {formatRelative(data.lastModified)}
          </span>
          {data.categories.slice(0, 2).map((c) => (
            <span
              key={c}
              className="text-xs bg-muted/70 text-muted-foreground px-1.5 py-0.5 rounded-full"
            >
              {c}
            </span>
          ))}
          {data.categories.length > 2 && (
            <span className="text-xs text-muted-foreground/60">+{data.categories.length - 2}</span>
          )}
        </div>
      </div>

      {/* Context menu — hover only */}
      {!multiSelectActive && (
        <div
          ref={menuRef}
          className="relative shrink-0 self-start mt-1 opacity-0 group-hover/card:opacity-100 transition-opacity"
        >
          <button
            onClick={handleMenuToggle}
            className="rounded p-1 text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted transition-colors"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={closeMenu} />
              <div className="absolute right-0 z-20 w-44 rounded-md border border-border bg-background shadow-lg py-1 text-sm">
                {showMoveSubmenu ? (
                  <>
                    <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border mb-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowMoveSubmenu(false);
                        }}
                        className="text-muted-foreground hover:text-foreground leading-none"
                      >
                        ←
                      </button>
                      <span className="text-xs text-muted-foreground">Move to</span>
                    </div>
                    {noteCollections.map((col) => (
                      <button
                        key={col.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          closeMenu();
                          onMoveNote(note, col.url);
                        }}
                        disabled={note.data.collectionUrl === col.url}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted disabled:opacity-40 disabled:cursor-default"
                      >
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: hex6(col.color) || '#6C757D' }}
                        />
                        {col.displayName}
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeMenu();
                        onEnterMultiSelect(note.uid);
                      }}
                      className="w-full px-3 py-1.5 text-left hover:bg-muted"
                    >
                      Select
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeMenu();
                        onInitiateTagEdit(note);
                      }}
                      className="w-full px-3 py-1.5 text-left hover:bg-muted"
                    >
                      Edit tags
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeMenu();
                        onInitiateConvert(note);
                      }}
                      className="w-full px-3 py-1.5 text-left hover:bg-muted"
                    >
                      Convert to Journal
                    </button>
                    {noteCollections.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowMoveSubmenu(true);
                        }}
                        className="w-full px-3 py-1.5 text-left hover:bg-muted"
                      >
                        Move to…
                      </button>
                    )}
                    <div className="border-t border-border my-1" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeMenu();
                        onInitiateDelete(note);
                      }}
                      className="w-full px-3 py-1.5 text-left text-destructive hover:bg-destructive/10"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
