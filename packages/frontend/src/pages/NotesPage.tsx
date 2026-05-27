import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, ExternalLink, Grid, List, Plus, Search, Tag, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Note, NoteJson, NotesQueryParams, Calendar } from '@dave/shared';
import { fetchNotes, createNote, updateNote, deleteNote, triggerNotesSync } from '../api/notes';
import { getCalendars } from '../api/collections';
import { useCollectionVisibility } from '../contexts/CollectionVisibility';
import { useIsMobile } from '../hooks/useIsMobile';
import { cn } from '../lib/utils';
import VJournalDetail from '../components/VJournalDetail';
import VJournalEditForm, { emptyNoteJson } from '../components/VJournalEditForm';
import BulkDeleteDialog from '../components/BulkDeleteDialog';

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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NotesPage() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

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

  const selectedNote = useMemo(
    () => notes.find((n) => n.uid === selectedUid) ?? null,
    [notes, selectedUid],
  );

  // ── All unique categories for filter chips ────────────────────────────────

  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const n of notes) {
      for (const c of n.data.categories) cats.add(c);
    }
    return [...cats].sort();
  }, [notes]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data: NoteJson) => createNote(data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      setCreatingNew(false);
      setSelectedUid(result.uid);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ uid, data, etag }: { uid: string; data: NoteJson; etag: string }) =>
      updateNote(uid, data, etag),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ uid, etag }: { uid: string; etag: string }) => deleteNote(uid, etag),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      setSelectedUid(null);
    },
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

  const clearSelection = () => setSelectedUids(new Set());

  // ── Convert note → journal ────────────────────────────────────────────────

  const handleConvertToJournal = useCallback(
    (uid: string, data: NoteJson, etag: string, dtstart: string) => {
      const updated: NoteJson = { ...data, dtstart };
      updateMutation.mutate(
        { uid, data: updated, etag },
        {
          onSuccess: () => {
            setSelectedUid(null);
            // Navigate to journals tab — the entry will appear there
            navigate('/journals');
          },
        },
      );
    },
    [updateMutation, navigate],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  // If still loading calendars, show nothing (Sidebar already has loading state)
  if (calQuery.isLoading) return null;

  // Empty state: no VJOURNAL-capable collections at all
  if (calQuery.data && vjournalCalendars.length === 0) {
    return <NoCollectionsState />;
  }

  const showDetailPanel = (selectedNote && !creatingNew) || creatingNew;
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

      {/* Bulk action bar — full width */}
      {selectedUids.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/5 border-b border-border shrink-0">
          <span className="text-xs text-muted-foreground flex-1">{selectedUids.size} selected</span>
          <button
            onClick={() => setShowBulkDelete(true)}
            className="flex items-center gap-1 text-xs text-destructive hover:text-destructive/80 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
          <button
            onClick={clearSelection}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Content row: list + detail */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* List/grid pane */}
        <div
          className={cn(
            'flex flex-col h-full overflow-hidden',
            showDetailPanel && !isMobile ? 'w-80 shrink-0 border-r border-border' : 'flex-1',
            showDetailPanel && isMobile ? 'hidden' : '',
          )}
        >
          {/* Notes list / grid */}
          <div
            className={cn(
              'flex-1 overflow-y-auto',
              view === 'grid' ? 'grid grid-cols-2 gap-2 p-3 content-start' : '',
            )}
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
                multiSelectActive={selectedUids.size > 0}
              />
            ))}
          </div>
        </div>

        {/* Detail / edit panel */}
        {showDetailPanel && (
          <div
            className={cn(
              'flex-1 flex flex-col h-full overflow-hidden bg-background relative',
              isMobile ? 'w-full absolute inset-0 z-10' : '',
            )}
          >
            {isMobile && (
              <button
                onClick={() => {
                  setSelectedUid(null);
                  setCreatingNew(false);
                }}
                className="flex items-center gap-1 px-3 py-2 text-sm text-muted-foreground hover:text-foreground border-b border-border shrink-0"
              >
                ← Back
              </button>
            )}

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
          deleting={deleteMutation.isPending}
          onConfirm={async () => {
            const toDelete = notes.filter((n) => selectedUids.has(n.uid));
            await Promise.allSettled(toDelete.map((n) => deleteNote(n.uid, n.etag)));
            queryClient.invalidateQueries({ queryKey: ['notes'] });
            clearSelection();
            setShowBulkDelete(false);
          }}
          onCancel={() => setShowBulkDelete(false)}
        />
      )}
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
  multiSelectActive: boolean;
}

function NoteCard({
  note,
  view,
  isSelected,
  isChecked,
  onSelect,
  onToggleCheck,
  multiSelectActive,
}: NoteCardProps) {
  const { data } = note;
  const preview = bodyPreview(data.description);

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || multiSelectActive) {
      onToggleCheck(note.uid, e.shiftKey);
    } else {
      onSelect(note.uid);
    }
  };

  if (view === 'grid') {
    return (
      <div
        onClick={handleClick}
        className={cn(
          'rounded-lg border border-border bg-card p-3 cursor-pointer transition-colors hover:border-primary/40',
          isSelected && 'border-primary bg-primary/5',
          isChecked && 'border-primary/60 bg-primary/10',
        )}
      >
        <p className="text-sm font-medium text-foreground mb-1 line-clamp-2 min-h-5">
          {data.summary || <span className="italic text-muted-foreground">Untitled</span>}
        </p>
        {preview && <p className="text-xs text-muted-foreground line-clamp-3 mb-2">{preview}</p>}
        <div className="flex items-center justify-between gap-2 mt-auto">
          <span className="text-xs text-muted-foreground/60">
            {formatRelative(data.lastModified)}
          </span>
          {data.categories.length > 0 && (
            <span className="text-xs text-muted-foreground/60 truncate max-w-24">
              {data.categories[0]}
              {data.categories.length > 1 ? ` +${data.categories.length - 1}` : ''}
            </span>
          )}
        </div>
      </div>
    );
  }

  // List view
  return (
    <div
      onClick={handleClick}
      className={cn(
        'flex items-start gap-3 px-3 py-2.5 border-b border-border cursor-pointer transition-colors hover:bg-muted/50',
        isSelected && 'bg-primary/5',
        isChecked && 'bg-primary/10',
      )}
    >
      {/* Multi-select check indicator */}
      {multiSelectActive && (
        <div
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition-colors',
            isChecked ? 'bg-primary border-primary' : 'border-muted-foreground/40',
          )}
        >
          {isChecked && <span className="text-primary-foreground text-[10px] font-bold">✓</span>}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {data.summary || <span className="italic text-muted-foreground">Untitled</span>}
        </p>
        {preview && <p className="text-xs text-muted-foreground truncate mt-0.5">{preview}</p>}
        <div className="flex items-center gap-2 mt-1">
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
    </div>
  );
}
