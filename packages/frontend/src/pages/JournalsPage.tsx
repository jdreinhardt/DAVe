import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { EventInput, DatesSetArg, EventClickArg, EventContentArg } from '@fullcalendar/core';
import type { DateClickArg } from '@fullcalendar/interaction';
import {
  AlignLeft,
  ArrowUpDown,
  BookOpen,
  CalendarDays,
  ChevronDown,  List,
  MoreVertical,
  PencilLine,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Note, NoteJson, JournalsQueryParams, Calendar } from '@dave/shared';
import {
  fetchJournals,
  createJournal,
  updateJournal,
  deleteJournal,
  triggerJournalsSync,
} from '../api/journals';
import { getCalendars } from '../api/collections';
import { useCollectionVisibility } from '../contexts/CollectionVisibility';
import { useNoteDrag } from '../contexts/NoteDrag';
import { useIsMobile } from '../hooks/useIsMobile';
import { cn } from '../lib/utils';
import VJournalDetail from '../components/VJournalDetail';
import VJournalEditForm, { emptyJournalJson } from '../components/VJournalEditForm';
import BulkDeleteDialog from '../components/BulkDeleteDialog';
import DateJumpButton from '../components/DateJumper';
import NoteBulkEditModal, {
  applyNoteBulkEdit,
  type NoteBulkEditConfig,
  type NoteBulkEditFieldId,
} from '../components/NoteBulkEditModal';
import TagInput from '../components/TagInput';
import TagFilterButton from '../components/TagFilterButton';
import {
  ToolbarFilterToggle,
  ToolbarFilterGroup,
  ToolbarPrimaryEnd,
} from '../components/ToolbarFilters';
import { useSettings } from '../contexts/Settings';

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

function hex6(color: string): string {
  if (color.startsWith('#') && color.length === 9) return color.slice(0, 7);
  return color;
}

function bodyPreview(text: string, maxLen = 80): string {
  const stripped = text
    .replace(/#+\s+/g, '')
    .replace(/[*_`[\]]/g, '')
    .trim();
  if (stripped.length <= maxLen) return stripped;
  return stripped.substring(0, maxLen).trimEnd() + '…';
}

function formatJournalDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = isDateOnly ? new Date(iso + 'T00:00:00') : new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Timeline grouping ─────────────────────────────────────────────────────────

interface DayGroup {
  dateKey: string; // YYYY-MM-DD
  dayLabel: string; // "Wednesday, May 28"
  journals: Note[];
}

interface MonthGroup {
  yearMonth: string; // YYYY-MM (also used as scroll target id)
  monthLabel: string; // "May 2026"
  days: DayGroup[];
}

function groupByMonthDay(journals: Note[]): MonthGroup[] {
  const monthMap = new Map<string, Map<string, Note[]>>();

  for (const j of journals) {
    const dtstart = j.data.dtstart;
    if (!dtstart) continue;
    const dateKey = dtstart.substring(0, 10);
    const yearMonth = dateKey.substring(0, 7);
    if (!monthMap.has(yearMonth)) monthMap.set(yearMonth, new Map());
    const dayMap = monthMap.get(yearMonth)!;
    if (!dayMap.has(dateKey)) dayMap.set(dateKey, []);
    dayMap.get(dateKey)!.push(j);
  }

  return [...monthMap.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((yearMonth) => {
      const [yearStr, monthStr] = yearMonth.split('-');
      const year = parseInt(yearStr!, 10);
      const month = parseInt(monthStr!, 10);
      const monthLabel = new Date(year, month - 1, 1).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      });

      const dayMap = monthMap.get(yearMonth)!;
      const days: DayGroup[] = [...dayMap.keys()]
        .sort((a, b) => b.localeCompare(a))
        .map((dateKey) => {
          const [y, m, d] = dateKey.split('-').map(Number);
          const dayLabel = new Date(y!, m! - 1, d!).toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          });
          return { dateKey, dayLabel, journals: dayMap.get(dateKey)! };
        });

      return { yearMonth, monthLabel, days };
    });
}

// ── Empty state ───────────────────────────────────────────────────────────────

function NoCollectionsState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
      <div className="text-4xl mb-4">📖</div>
      <h2 className="text-base font-semibold text-foreground mb-1">
        No journals collections found
      </h2>
      <p className="text-sm text-muted-foreground max-w-xs mb-4">
        Your calendars currently don&apos;t have Journals enabled. Enable Notes on
        a calendar on your DAV server that accepts VJOURNAL, or create a new one here.
        Journals are a subcomponent of Notes.
      </p>
    </div>
  );
}

// ── Shared-values helper ──────────────────────────────────────────────────────

function computeSharedCategories(journals: Note[]): string[] {
  if (journals.length === 0) return [];
  const first = journals[0]!;
  return first.data.categories.filter((cat) =>
    journals.every((j) => j.data.categories.includes(cat)),
  );
}

// ── Multi-journal selection panel ─────────────────────────────────────────────

function JournalMultiSelectPanel({
  journals,
  journalCollections,
  deleting,
  editing,
  moving,
  onOpenBulkEdit,
  onBulkMove,
  onDelete,
  onBack,
}: {
  journals: Note[];
  journalCollections: Calendar[];
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
  const sharedCategories = computeSharedCategories(journals);

  return (
    <div className="bg-card flex flex-col overflow-hidden flex-1 border-l border-border">
      <div className="flex items-center px-4 py-2 border-b border-border shrink-0 gap-2">
        <button
          onClick={onBack}
          className="md:hidden shrink-0 rounded p-1 text-muted-foreground hover:bg-muted"
          aria-label="Back"
        >
          ←
        </button>
        <span className="text-xs text-muted-foreground flex-1">
          {journals.length} journal{journals.length !== 1 ? 's' : ''} selected
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onOpenBulkEdit()}
            disabled={busy}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <PencilLine className="h-3.5 w-3.5" /> Edit
          </button>

          {journalCollections.length > 1 && (
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
                    {journalCollections.map((col) => (
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

      {/* Selected journal cards */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-2">
          {journals.map((j) => (
            <div key={j.uid} className="flex flex-col gap-1.5 p-3 rounded-lg border border-border">
              <p className="text-sm font-medium truncate w-full leading-snug">
                {j.data.summary || <span className="italic text-muted-foreground">(no title)</span>}
              </p>
              {j.data.dtstart && (
                <p className="text-xs text-muted-foreground">{formatJournalDate(j.data.dtstart)}</p>
              )}
              {j.data.categories.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {j.data.categories.slice(0, 2).map((c) => (
                    <span
                      key={c}
                      className="text-xs bg-muted/70 text-muted-foreground px-1.5 py-0.5 rounded-full"
                    >
                      {c}
                    </span>
                  ))}
                  {j.data.categories.length > 2 && (
                    <span className="text-xs text-muted-foreground/60">
                      +{j.data.categories.length - 2}
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

// ── Journal card ──────────────────────────────────────────────────────────────

interface JournalCardProps {
  journal: Note;
  variant: 'list' | 'timeline';
  isSelected: boolean;
  isChecked: boolean;
  onSelect: (uid: string) => void;
  onToggleCheck: (uid: string, shift: boolean) => void;
  onEnterMultiSelect: (uid: string) => void;
  onConvertToNote: (journal: Note) => void;
  onInitiateTagEdit: (journal: Note) => void;
  onInitiateDelete: (journal: Note) => void;
  onMoveJournal: (journal: Note, collectionUrl: string) => void;
  onDragStart: (journal: Note) => void;
  onDragEnd: () => void;
  journalCollections: Calendar[];
  multiSelectActive: boolean;
  collectionName?: string;
  collectionColor?: string;
}

function JournalCard({
  journal,
  variant,
  isSelected,
  isChecked,
  onSelect,
  onToggleCheck,
  onEnterMultiSelect,
  onConvertToNote,
  onInitiateTagEdit,
  onInitiateDelete,
  onMoveJournal,
  onDragStart,
  onDragEnd,
  journalCollections,
  multiSelectActive,
  collectionName,
  collectionColor,
}: JournalCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showMoveSubmenu, setShowMoveSubmenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { data } = journal;
  const preview = bodyPreview(data.description);

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || multiSelectActive) {
      onToggleCheck(journal.uid, e.shiftKey);
    } else {
      onSelect(journal.uid);
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

  const kebabMenu = (
    <div
      ref={menuRef}
      className={cn(
        'relative shrink-0',
        variant === 'list'
          ? 'self-start mt-1 opacity-0 group-hover/card:opacity-100 transition-opacity'
          : 'absolute top-2 right-2 opacity-0 group-hover/card:opacity-100 transition-opacity',
      )}
    >
      <button
        onClick={handleMenuToggle}
        className={cn(
          'rounded text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted transition-colors',
          variant === 'list' ? 'p-1' : 'p-0.5',
        )}
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={closeMenu} />
          <div
            className={cn(
              'absolute z-20 w-44 rounded-md border border-border bg-background shadow-lg py-1 text-sm',
              variant === 'list' ? 'right-0' : 'right-0 top-full mt-1',
            )}
          >
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
                {journalCollections.map((col) => (
                  <button
                    key={col.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeMenu();
                      onMoveJournal(journal, col.url);
                    }}
                    disabled={journal.data.collectionUrl === col.url}
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
                    onEnterMultiSelect(journal.uid);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-muted"
                >
                  Select
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeMenu();
                    onInitiateTagEdit(journal);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-muted"
                >
                  Edit tags
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeMenu();
                    onConvertToNote(journal);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-muted"
                >
                  Convert to Note
                </button>
                {journalCollections.length > 1 && (
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
                    onInitiateDelete(journal);
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
  );

  if (variant === 'timeline') {
    return (
      <div
        draggable
        data-uid={journal.uid}
        onDragStart={(e) => {
          e.stopPropagation();
          onDragStart(journal);
        }}
        onDragEnd={onDragEnd}
        onClick={handleClick}
        className={cn(
          'group/card relative rounded-lg border border-border bg-card px-3 py-2.5 cursor-pointer transition-colors hover:border-primary/40',
          isSelected && 'border-primary bg-primary/5',
          isChecked && 'border-primary/60 bg-primary/10',
        )}
      >
        {multiSelectActive && <div className="absolute top-2 left-2">{checkbox}</div>}
        {!multiSelectActive && kebabMenu}

        <p
          className={cn(
            'text-sm font-medium text-foreground truncate',
            multiSelectActive && 'ml-5',
          )}
        >
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
    );
  }

  // List variant
  return (
    <div
      draggable
      data-uid={journal.uid}
      onDragStart={(e) => {
        e.stopPropagation();
        onDragStart(journal);
      }}
      onDragEnd={onDragEnd}
      onClick={handleClick}
      className={cn(
        'group/card flex items-start gap-3 px-3 py-3 rounded-md cursor-pointer transition-colors mx-1 my-0.5',
        isChecked ? 'bg-primary/10' : isSelected ? 'bg-primary/5' : 'hover:bg-muted',
      )}
    >
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
            {formatJournalDate(data.dtstart)}
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

      {!multiSelectActive && kebabMenu}
    </div>
  );
}

// ── Timeline view ─────────────────────────────────────────────────────────────

function TimelineView({
  monthGroups,
  selectedUid,
  selectedUids,
  multiSelectActive,
  onSelect,
  onToggleCheck,
  onEnterMultiSelect,
  onConvertToNote,
  onInitiateTagEdit,
  onInitiateDelete,
  onMoveJournal,
  onDragStart,
  onDragEnd,
  journalCollections,
  collectionNameMap,
  collectionColorMap,
  isLoading,
  isEmpty,
  hasSearch,
}: {
  monthGroups: MonthGroup[];
  selectedUid: string | null;
  selectedUids: Set<string>;
  multiSelectActive: boolean;
  onSelect: (uid: string) => void;
  onToggleCheck: (uid: string, shift: boolean) => void;
  onEnterMultiSelect: (uid: string) => void;
  onConvertToNote: (journal: Note) => void;
  onInitiateTagEdit: (journal: Note) => void;
  onInitiateDelete: (journal: Note) => void;
  onMoveJournal: (journal: Note, collectionUrl: string) => void;
  onDragStart: (journal: Note) => void;
  onDragEnd: () => void;
  journalCollections: Calendar[];
  collectionNameMap: Map<string, string>;
  collectionColorMap: Map<string, string>;
  isLoading: boolean;
  isEmpty: boolean;
  hasSearch: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-24">
        <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (isEmpty) {
    return (
      <p className="text-sm text-muted-foreground text-center py-12 px-4">
        {hasSearch
          ? 'No matching journal entries.'
          : 'No journal entries yet. Create your first one.'}
      </p>
    );
  }

  return (
    <div className="py-4 px-3">
      {monthGroups.map((mg) => (
        <div key={mg.yearMonth} id={`month-${mg.yearMonth}`} className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground shrink-0">
              {mg.monthLabel}
            </h3>
            <div className="flex-1 border-t border-border" />
          </div>

          {mg.days.map((dg) => (
            <div key={dg.dateKey} className="mb-4">
              <p className="text-xs font-medium text-muted-foreground mb-1.5 pl-0.5">
                {dg.dayLabel}
              </p>
              <div className="flex flex-col gap-1.5">
                {dg.journals.map((j) => (
                  <JournalCard
                    key={j.uid}
                    journal={j}
                    variant="timeline"
                    isSelected={selectedUid === j.uid}
                    isChecked={selectedUids.has(j.uid)}
                    onSelect={onSelect}
                    onToggleCheck={onToggleCheck}
                    onEnterMultiSelect={onEnterMultiSelect}
                    onConvertToNote={onConvertToNote}
                    onInitiateTagEdit={onInitiateTagEdit}
                    onInitiateDelete={onInitiateDelete}
                    onMoveJournal={onMoveJournal}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    journalCollections={journalCollections}
                    multiSelectActive={multiSelectActive}
                    collectionName={collectionNameMap.get(j.data.collectionUrl)}
                    collectionColor={collectionColorMap.get(j.data.collectionUrl)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Date jumper button ────────────────────────────────────────────────────────

function DateJumperButton({
  view,
  monthGroups,
  calendarRef,
}: {
  view: 'timeline' | 'list' | 'calendar';
  monthGroups: MonthGroup[];
  calendarRef: React.RefObject<FullCalendar | null>;
}) {
  function handleDateChange(date: string) {
    if (view === 'calendar') {
      calendarRef.current?.getApi().gotoDate(date);
    } else {
      const yearMonth = date.substring(0, 7);
      let target = yearMonth;
      if (!monthGroups.some((mg) => mg.yearMonth === yearMonth)) {
        const [y, m] = yearMonth.split('-').map(Number);
        const targetTotal = y! * 12 + m!;
        let minDist = Infinity;
        for (const mg of monthGroups) {
          const [gy, gm] = mg.yearMonth.split('-').map(Number);
          const dist = Math.abs(gy! * 12 + gm! - targetTotal);
          if (dist < minDist) {
            minDist = dist;
            target = mg.yearMonth;
          }
        }
      }
      document.getElementById(`month-${target}`)?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  // h-7.75 matches the neighbouring toolbar controls on this page.
  return <DateJumpButton onPick={handleDateChange} className="h-7.75" />;
}

// ── Calendar view ─────────────────────────────────────────────────────────────

function JournalCalendarView({
  journals,
  collectionColorMap,
  debouncedQuery,
  selectedUid,
  onEventClick,
  onDateClick,
  onDatesSet,
  calendarRef,
}: {
  journals: Note[];
  collectionColorMap: Map<string, string>;
  debouncedQuery: string;
  selectedUid: string | null;
  onEventClick: (uid: string) => void;
  onDateClick: (dateStr: string) => void;
  onDatesSet: (from: string, to: string) => void;
  calendarRef: React.RefObject<FullCalendar | null>;
}) {
  const events: EventInput[] = useMemo(
    () =>
      journals.map((j) => {
        const rawColor = collectionColorMap.get(j.data.collectionUrl);
        const color = rawColor ? hex6(rawColor) : undefined;
        return {
          id: j.uid,
          title: j.data.summary || '(Untitled)',
          start: j.data.dtstart?.substring(0, 10) ?? '',
          allDay: true,
          backgroundColor: color,
          borderColor: color,
          extendedProps: { componentType: 'journal', collectionUrl: j.data.collectionUrl },
        };
      }),
    [journals, collectionColorMap],
  );

  const handleEventClick = useCallback(
    (arg: EventClickArg) => onEventClick(arg.event.id),
    [onEventClick],
  );

  const handleDateClick = useCallback(
    (arg: DateClickArg) => onDateClick(arg.dateStr),
    [onDateClick],
  );

  const handleDatesSet = useCallback(
    (arg: DatesSetArg) => onDatesSet(arg.startStr.substring(0, 10), arg.endStr.substring(0, 10)),
    [onDatesSet],
  );

  const getEventClassNames = useCallback(
    (arg: EventContentArg) => {
      const classes: string[] = [];
      if (arg.event.id === selectedUid)
        classes.push('!opacity-100', 'ring-1', 'ring-inset', 'ring-white/50');
      if (debouncedQuery && !arg.event.title.toLowerCase().includes(debouncedQuery.toLowerCase())) {
        classes.push('opacity-30');
      }
      return classes;
    },
    [debouncedQuery, selectedUid],
  );

  const renderEventContent = useCallback(
    (arg: EventContentArg) => (
      <div className="flex items-center gap-0.5 px-0.5 w-full overflow-hidden">
        <BookOpen className="h-2.5 w-2.5 shrink-0 opacity-80" />
        <span className="text-[11px] leading-tight truncate">{arg.event.title}</span>
      </div>
    ),
    [],
  );

  return (
    <div className="h-full p-3 overflow-hidden">
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
        buttonText={{ today: 'Today' }}
        events={events}
        eventContent={renderEventContent}
        eventClassNames={getEventClassNames}
        eventClick={handleEventClick}
        dateClick={handleDateClick}
        datesSet={handleDatesSet}
        height="100%"
        dayMaxEvents={3}
      />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function JournalsPage() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { startDrag, endDrag } = useNoteDrag();

  const { journalsDefaultView } = useSettings();

  // Fall back to Settings default if no stored pref.
  const [view, setView] = useState<'timeline' | 'list' | 'calendar'>(() =>
    loadPref('journals.view', journalsDefaultView),
  );
  const [sort, setSort] = useState<JournalsQueryParams['sort']>(() =>
    loadPref('journals.sort', 'journal_date' as JournalsQueryParams['sort']),
  );
  const [order, setOrder] = useState<'asc' | 'desc'>(() =>
    loadPref('journals.order', 'desc' as 'asc' | 'desc'),
  );
  const [categoryFilter, setCategoryFilter] = useState<string[]>(() => {
    const v = loadPref<unknown>('journals.category', []);
    return Array.isArray(v) ? (v as string[]) : [];
  });
  const [searchQuery, setSearchQuery] = useState('');
  // Mobile-only: collapses the secondary toolbar controls. Resets on remount.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const location = useLocation();
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [pendingSelectUid, setPendingSelectUid] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);

  useEffect(() => {
    const uid = (location.state as { selectUid?: string } | null)?.selectUid;
    if (!uid) return;
    setPendingSelectUid(uid);
    navigate(location.pathname + location.search, { replace: true, state: null });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);
  const [newJournalDefaultDate, setNewJournalDefaultDate] = useState<string | null>(null);
  const [calendarViewRange, setCalendarViewRange] = useState<{ from: string; to: string } | null>(
    null,
  );
  const calendarRef = useRef<FullCalendar>(null);
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkEditInitialField, setBulkEditInitialField] = useState<NoteBulkEditFieldId | undefined>(
    undefined,
  );

  // Panel resize
  const PANEL_MIN = 240;
  const PANEL_MAX = 1500;
  const [panelWidth, setPanelWidth] = useState<number>(() => loadPref('journals.panelWidth', 440));
  useEffect(() => {
    savePref('journals.panelWidth', panelWidth);
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
    loadPref('journals.detailWidth', PANEL_MAX),
  );
  useEffect(() => {
    savePref('journals.detailWidth', detailPanelWidth);
  }, [detailPanelWidth]);

  const startDetailResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const paneEl = (e.currentTarget as HTMLElement).parentElement;
      const rowEl = paneEl?.parentElement;
      const startX = e.clientX;
      // Start from the rendered width (which may be capped below the stored value)
      // so there's no dead zone at the start of the drag.
      const startWidth = paneEl?.getBoundingClientRect().width ?? detailPanelWidth;
      const onMove = (ev: MouseEvent) => {
        const delta = startX - ev.clientX;
        // Cap to the space actually available (row width minus the list minimum)
        // so the pane can never overflow the row and clip its header buttons.
        const rowW = rowEl?.getBoundingClientRect().width ?? PANEL_MAX;
        const cap = Math.min(PANEL_MAX, rowW - 320);
        setDetailPanelWidth(Math.max(PANEL_MIN, Math.min(cap, startWidth + delta)));
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

  const [journalForTagEdit, setJournalForTagEdit] = useState<Note | null>(null);
  const [journalForDelete, setJournalForDelete] = useState<Note | null>(null);

  const [toast, setToast] = useState<{
    msg: string;
    action?: { label: string; onClick: () => void };
  } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string, action?: { label: string; onClick: () => void }) => {
    setToast({ msg, action });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // Persist preferences
  useEffect(() => {
    savePref('journals.view', view);
  }, [view]);
  useEffect(() => {
    savePref('journals.sort', sort);
  }, [sort]);
  useEffect(() => {
    savePref('journals.order', order);
  }, [order]);
  useEffect(() => {
    savePref('journals.category', categoryFilter);
  }, [categoryFilter]);

  // Calendar view is desktop-only; reset to timeline if user opens on mobile
  useEffect(() => {
    if (isMobile && view === 'calendar') setView('timeline');
  }, [isMobile, view]);

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

  // Timeline always fetches by journal_date desc; list uses user sort pref.
  // Calendar view excludes q from the main query — search is handled by dimming in the calendar.
  const params: JournalsQueryParams = {
    ...(view === 'timeline' ? { sort: 'journal_date', order: 'desc' } : { sort, order }),
    ...(categoryFilter.length > 0 ? { category: categoryFilter.join(',') } : {}),
    ...(debouncedQuery && view !== 'calendar' ? { q: debouncedQuery } : {}),
    ...(visibleCollectionUrls.length > 0 ? { collections: visibleCollectionUrls.join(',') } : {}),
  };

  const calendarParams: JournalsQueryParams | null = calendarViewRange
    ? {
        from: calendarViewRange.from,
        to: calendarViewRange.to,
        ...(categoryFilter.length > 0 ? { category: categoryFilter.join(',') } : {}),
        ...(visibleCollectionUrls.length > 0
          ? { collections: visibleCollectionUrls.join(',') }
          : {}),
      }
    : null;

  const journalsQuery = useQuery({
    queryKey: ['journals', params],
    queryFn: () => fetchJournals(params),
    enabled: hasCollections && visibleCollectionUrls.length > 0,
    staleTime: 30_000,
  });

  const journals = useMemo(() => journalsQuery.data?.journals ?? [], [journalsQuery.data]);

  useEffect(() => {
    if (!pendingSelectUid || journals.length === 0) return;
    const uid = pendingSelectUid;
    setPendingSelectUid(null);
    if (journals.some((j) => j.uid === uid)) {
      setSelectedUid(uid);
      setCreatingNew(false);
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-uid="${uid}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
  }, [pendingSelectUid, journals]);

  const calendarJournalsQuery = useQuery({
    queryKey: ['journals', 'calendar', calendarParams],
    queryFn: () => fetchJournals(calendarParams!),
    enabled:
      view === 'calendar' &&
      hasCollections &&
      visibleCollectionUrls.length > 0 &&
      calendarParams !== null,
    staleTime: 30_000,
  });

  const calendarJournals = useMemo(
    () => calendarJournalsQuery.data?.journals ?? [],
    [calendarJournalsQuery.data],
  );

  // Kick off initial sync on first load, then refetch.
  //
  // Same race as NotesPage — and the same collections, since notes and journals
  // are both VJOURNAL and share one seeding pass. Whichever view is opened first
  // is the one that reads the unseeded cache and caches an empty result, so both
  // pages need the invalidate. The prefix covers the list and calendar queries.
  useEffect(() => {
    if (hasCollections) {
      triggerJournalsSync()
        .then(() => queryClient.invalidateQueries({ queryKey: ['journals'] }))
        .catch(() => {
          /* non-fatal */
        });
    }
  }, [hasCollections, queryClient]);

  // Close detail when filtered out
  useEffect(() => {
    if (selectedUid && !journals.some((j) => j.uid === selectedUid)) {
      setSelectedUid(null);
    }
  }, [journals, selectedUid]);

  // Drop selected items that are no longer in the visible set
  useEffect(() => {
    if (selectedUids.size === 0) return;
    const visibleUids = new Set(journals.map((j) => j.uid));
    const dropped = [...selectedUids].filter((uid) => !visibleUids.has(uid));
    if (dropped.length > 0) {
      setSelectedUids((prev) => {
        const next = new Set(prev);
        for (const uid of dropped) next.delete(uid);
        return next;
      });
      showToast(
        `${dropped.length} journal${dropped.length !== 1 ? 's' : ''} removed from selection because ${dropped.length !== 1 ? 'they no longer match' : 'it no longer matches'} the filter`,
      );
    }
  }, [journals, selectedUids, showToast]);

  const selectedJournal = useMemo(
    () => journals.find((j) => j.uid === selectedUid) ?? null,
    [journals, selectedUid],
  );

  const selectedJournals = useMemo(
    () => journals.filter((j) => selectedUids.has(j.uid)),
    [journals, selectedUids],
  );

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

  const allCategories = useMemo(() => {
    const cats = new Set<string>(categoryFilter.filter((c) => c !== '__none__'));
    const source = view === 'calendar' ? calendarJournals : journals;
    for (const j of source) {
      for (const c of j.data.categories) cats.add(c);
    }
    return [...cats].sort();
  }, [journals, calendarJournals, view, categoryFilter]);

  // Timeline grouping (computed for timeline and calendar views — calendar may auto-switch to timeline)
  const monthGroups = useMemo(
    () => (view !== 'list' ? groupByMonthDay(journals) : []),
    [journals, view],
  );

  // ── Mutations ─────────────────────────────────────────────────────────────

  const invalidateJournals = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['journals'] });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (data: NoteJson) => createJournal(data),
    onSuccess: (result) => {
      invalidateJournals();
      setCreatingNew(false);
      setNewJournalDefaultDate(null);
      setSelectedUid(result.uid);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ uid, data, etag }: { uid: string; data: NoteJson; etag: string }) =>
      updateJournal(uid, data, etag),
    onSuccess: () => {
      invalidateJournals();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ uid, etag }: { uid: string; etag: string }) => deleteJournal(uid, etag),
    onSuccess: () => {
      invalidateJournals();
      setSelectedUid(null);
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (toDelete: Note[]) =>
      Promise.allSettled(toDelete.map((j) => deleteJournal(j.uid, j.etag))),
    onSuccess: (results) => {
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const fail = results.filter((r) => r.status === 'rejected').length;
      setShowBulkDelete(false);
      setSelectedUids(new Set());
      setSelectedUid(null);
      showToast(`Deleted ${ok} journal${ok !== 1 ? 's' : ''}${fail ? ` (${fail} failed)` : ''}`);
      invalidateJournals();
    },
    onError: () => {
      setShowBulkDelete(false);
      showToast('Bulk delete failed.');
    },
  });

  const bulkEditMutation = useMutation({
    mutationFn: ({
      journalsToEdit,
      config,
    }: {
      journalsToEdit: Note[];
      config: NoteBulkEditConfig;
    }) =>
      Promise.allSettled(
        journalsToEdit.map((j) => {
          const newData = applyNoteBulkEdit(j.data, config);
          return updateJournal(j.uid, newData, j.etag);
        }),
      ),
    onSuccess: (results) => {
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const fail = results.filter((r) => r.status === 'rejected').length;
      setShowBulkEdit(false);
      showToast(`Updated ${ok} journal${ok !== 1 ? 's' : ''}${fail ? ` (${fail} failed)` : ''}`);
      invalidateJournals();
    },
    onError: () => {
      setShowBulkEdit(false);
      showToast('Bulk edit failed.');
    },
  });

  const bulkMoveMutation = useMutation({
    mutationFn: ({
      journalsToMove,
      collectionUrl,
    }: {
      journalsToMove: Note[];
      collectionUrl: string;
    }) =>
      Promise.allSettled(
        journalsToMove.map((j) => {
          const newData = { ...j.data, collectionUrl };
          return updateJournal(j.uid, newData, j.etag);
        }),
      ),
    onSuccess: (results) => {
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const fail = results.filter((r) => r.status === 'rejected').length;
      setSelectedUids(new Set());
      showToast(`Moved ${ok} journal${ok !== 1 ? 's' : ''}${fail ? ` (${fail} failed)` : ''}`);
      invalidateJournals();
    },
    onError: () => showToast('Bulk move failed.'),
  });

  const singleTagEditMutation = useMutation({
    mutationFn: ({ uid, data, etag }: { uid: string; data: NoteJson; etag: string }) =>
      updateJournal(uid, data, etag),
    onSuccess: () => {
      invalidateJournals();
      setJournalForTagEdit(null);
    },
    onError: () => showToast('Failed to update tags.'),
  });

  const singleDeleteMutation = useMutation({
    mutationFn: ({ uid, etag }: { uid: string; etag: string }) => deleteJournal(uid, etag),
    onSuccess: (_, { uid }) => {
      invalidateJournals();
      setJournalForDelete(null);
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
          const ids = journals.map((j) => j.uid);
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
    [journals],
  );

  const clearSelection = useCallback(() => setSelectedUids(new Set()), []);
  const selectAll = useCallback(
    () => setSelectedUids(new Set(journals.map((j) => j.uid))),
    [journals],
  );

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
      bulkEditMutation.mutate({ journalsToEdit: selectedJournals, config });
    },
    [bulkEditMutation, selectedJournals],
  );

  const handleBulkMove = useCallback(
    (collectionUrl: string) => {
      bulkMoveMutation.mutate({ journalsToMove: selectedJournals, collectionUrl });
    },
    [bulkMoveMutation, selectedJournals],
  );

  const handleBulkDelete = useCallback(() => setShowBulkDelete(true), []);

  const handleMoveJournal = useCallback(
    (journal: Note, collectionUrl: string) => {
      updateMutation.mutate({
        uid: journal.uid,
        data: { ...journal.data, collectionUrl },
        etag: journal.etag,
      });
    },
    [updateMutation],
  );

  const handleCardDragStart = useCallback(
    (journal: Note) => {
      if (selectedUids.has(journal.uid) && selectedUids.size > 1) {
        const all = journals.filter((j) => selectedUids.has(j.uid));
        startDrag(journal, (targetCollectionUrl) =>
          bulkMoveMutation.mutate({ journalsToMove: all, collectionUrl: targetCollectionUrl }),
        );
      } else {
        startDrag(journal, (targetCollectionUrl) =>
          updateMutation.mutate({
            uid: journal.uid,
            data: { ...journal.data, collectionUrl: targetCollectionUrl },
            etag: journal.etag,
          }),
        );
      }
    },
    [startDrag, selectedUids, journals, bulkMoveMutation, updateMutation],
  );

  const handleCardDragEnd = useCallback(() => endDrag(), [endDrag]);

  const handleConvertToNote = useCallback(
    (journal: Note) => {
      const updated: NoteJson = { ...journal.data, dtstart: null };
      updateMutation.mutate(
        { uid: journal.uid, data: updated, etag: journal.etag },
        {
          onSuccess: () => {
            setSelectedUid(null);
            queryClient.invalidateQueries({ queryKey: ['notes'] });
            showToast('Moved to Notes.', {
              label: 'Open Notes',
              onClick: () => navigate('/notes'),
            });
          },
        },
      );
    },
    [updateMutation, queryClient, showToast, navigate],
  );

  const handleCalendarEventClick = useCallback(
    (uid: string) => {
      clearSelection();
      setSelectedUid(uid);
      setCreatingNew(false);
    },
    [clearSelection],
  );

  const handleCalendarDateClick = useCallback(
    (dateStr: string) => {
      setNewJournalDefaultDate(dateStr);
      setCreatingNew(true);
      setSelectedUid(null);
      clearSelection();
    },
    [clearSelection],
  );

  const handleCalendarDatesSet = useCallback((from: string, to: string) => {
    setCalendarViewRange({ from, to });
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  if (calQuery.isLoading) return null;

  if (calQuery.data && vjournalCalendars.length === 0) {
    return <NoCollectionsState />;
  }

  const isMultiSelect = selectedUids.size > 0;
  const showMultiPanel = isMultiSelect && !creatingNew;
  const showDetailPanel = (selectedJournal && !creatingNew && !isMultiSelect) || creatingNew;

  // When a journal is selected in calendar view, switch to timeline so the split layout isn't cramped.
  // The user's `view` preference is preserved — effectiveView reverts automatically when the panel closes.
  const effectiveView: 'timeline' | 'list' | 'calendar' =
    view === 'calendar' && selectedJournal && !creatingNew && !isMultiSelect ? 'timeline' : view;
  const defaultCollectionUrl =
    vjournalCalendars.find((c) => !hiddenVJournalCollections.has(c.id))?.url ??
    vjournalCalendars[0]?.url ??
    '';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0 flex-wrap">
        <button
          onClick={() => {
            setCreatingNew(true);
            setSelectedUid(null);
            clearSelection();
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          New journal
        </button>

        <ToolbarPrimaryEnd>
        {/* Search */}
        <div className="relative w-40 shrink-0 md:w-auto md:flex-1 md:min-w-40 md:max-w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search journals…"
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

        <ToolbarFilterToggle
          open={filtersOpen}
          onToggle={() => setFiltersOpen((o) => !o)}
          activeCount={categoryFilter.length}
        />
        </ToolbarPrimaryEnd>

        <ToolbarFilterGroup open={filtersOpen}>
        {/* Sort controls — list view only */}
        {effectiveView === 'list' && (
          <>
            <select
              value={sort ?? ''}
              onChange={(e) =>
                setSort((e.target.value as JournalsQueryParams['sort']) || undefined)
              }
              className="text-sm rounded-md border border-input bg-background px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">Default sort</option>
              <option value="journal_date">Journal date</option>
              <option value="modified">Modified</option>
              <option value="summary">Title</option>
              <option value="created">Created</option>
              <option value="category">Category</option>
            </select>

            {sort && (
              <button
                onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
                title={`Sort ${order === 'asc' ? 'ascending' : 'descending'} — click to toggle`}
                className="flex h-7.75 items-center justify-center rounded-md border border-input bg-background px-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <ArrowUpDown className="h-4 w-4" />
              </button>
            )}
          </>
        )}

        {/* Date jumper — timeline and calendar views */}
        {(effectiveView === 'timeline' || effectiveView === 'calendar') && (
          <DateJumperButton view={effectiveView} monthGroups={monthGroups} calendarRef={calendarRef} />
        )}

        <TagFilterButton
          allTags={allCategories}
          selected={categoryFilter}
          onChange={setCategoryFilter}
        />

        {/* View toggle */}
        <div className="flex items-center gap-0.5 rounded-md border border-input p-0.5 ml-auto shrink-0">
          <button
            onClick={() => setView('timeline')}
            className={cn(
              'p-1 rounded transition-colors',
              view === 'timeline'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title="Timeline view"
          >
            <AlignLeft className="h-4 w-4" />
          </button>
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
          {!isMobile && (
            <button
              onClick={() => setView('calendar')}
              className={cn(
                'p-1 rounded transition-colors',
                view === 'calendar'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              title="Calendar view"
            >
              <CalendarDays className="h-4 w-4" />
            </button>
          )}
        </div>
        </ToolbarFilterGroup>
      </div>


      {/* Content row: list/timeline + detail/multi-panel */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Main content pane */}
        <div
          className={cn(
            'flex flex-col h-full overflow-hidden flex-1 min-w-75',
            (showDetailPanel || showMultiPanel) && isMobile ? 'hidden' : '',
          )}
        >
          {/* Selection count bar */}
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
            className={cn('flex-1', effectiveView === 'calendar' ? 'overflow-hidden' : 'overflow-y-auto')}
          >
            {effectiveView === 'timeline' ? (
              <TimelineView
                monthGroups={monthGroups}
                selectedUid={selectedUid}
                selectedUids={selectedUids}
                multiSelectActive={isMultiSelect}
                onSelect={(uid) => {
                  setSelectedUid(uid);
                  setCreatingNew(false);
                }}
                onToggleCheck={(uid, shift) => toggleSelect(uid, shift, selectedUid)}
                onEnterMultiSelect={handleEnterMultiSelect}
                onConvertToNote={handleConvertToNote}
                onInitiateTagEdit={setJournalForTagEdit}
                onInitiateDelete={setJournalForDelete}
                onMoveJournal={handleMoveJournal}
                onDragStart={handleCardDragStart}
                onDragEnd={handleCardDragEnd}
                journalCollections={vjournalCalendars}
                collectionNameMap={collectionNameMap}
                collectionColorMap={collectionColorMap}
                isLoading={journalsQuery.isLoading}
                isEmpty={!journalsQuery.isLoading && journals.length === 0}
                hasSearch={!!(debouncedQuery || categoryFilter.length > 0)}
              />
            ) : effectiveView === 'calendar' ? (
              <JournalCalendarView
                journals={calendarJournals}
                collectionColorMap={collectionColorMap}
                debouncedQuery={debouncedQuery}
                selectedUid={selectedUid}
                onEventClick={handleCalendarEventClick}
                onDateClick={handleCalendarDateClick}
                onDatesSet={handleCalendarDatesSet}
                calendarRef={calendarRef}
              />
            ) : (
              <>
                {journalsQuery.isLoading && (
                  <div className="flex items-center justify-center h-24">
                    <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  </div>
                )}
                {!journalsQuery.isLoading && journals.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-12 px-4">
                    {debouncedQuery || categoryFilter.length > 0
                      ? 'No matching journal entries.'
                      : 'No journal entries yet. Create your first one.'}
                  </p>
                )}
                {journals.map((j) => (
                  <JournalCard
                    key={j.uid}
                    journal={j}
                    variant="list"
                    isSelected={selectedUid === j.uid}
                    isChecked={selectedUids.has(j.uid)}
                    onSelect={(uid) => {
                      setSelectedUid(uid);
                      setCreatingNew(false);
                    }}
                    onToggleCheck={(uid, shift) => toggleSelect(uid, shift, selectedUid)}
                    onEnterMultiSelect={handleEnterMultiSelect}
                    onConvertToNote={handleConvertToNote}
                    onInitiateTagEdit={setJournalForTagEdit}
                    onInitiateDelete={setJournalForDelete}
                    onMoveJournal={handleMoveJournal}
                    onDragStart={handleCardDragStart}
                    onDragEnd={handleCardDragEnd}
                    journalCollections={vjournalCalendars}
                    multiSelectActive={isMultiSelect}
                    collectionName={collectionNameMap.get(j.data.collectionUrl)}
                    collectionColor={collectionColorMap.get(j.data.collectionUrl)}
                  />
                ))}
              </>
            )}
          </div>
        </div>

        {/* Multi-select panel — desktop */}
        {showMultiPanel && !isMobile && (
          <div className="flex shrink-0" style={{ width: panelWidth }}>
            <div
              className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
              onMouseDown={startResize}
              title="Drag to resize"
            />
            <JournalMultiSelectPanel
              journals={selectedJournals}
              journalCollections={vjournalCalendars}
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
          <div className="absolute inset-0 z-20 flex flex-col bg-background">
            <JournalMultiSelectPanel
              journals={selectedJournals}
              journalCollections={vjournalCalendars}
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
          <div className="flex shrink-0 min-w-0" style={{ width: detailPanelWidth, maxWidth: 'calc(100% - 20rem)' }}>
            <div
              className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
              onMouseDown={startDetailResize}
              title="Drag to resize"
            />
            <div className="flex-1 flex flex-col h-full overflow-hidden bg-background border-l border-border relative">
              {creatingNew && (
                <VJournalEditForm
                  initial={emptyJournalJson(
                    defaultCollectionUrl,
                    newJournalDefaultDate ?? undefined,
                  )}
                  calendars={vjournalCalendars}
                  mode="journal"
                  isNew
                  saving={createMutation.isPending}
                  onSave={(data) => createMutation.mutate(data)}
                  onCancel={() => {
                    setCreatingNew(false);
                    setNewJournalDefaultDate(null);
                  }}
                />
              )}
              {selectedJournal && !creatingNew && (
                <VJournalDetail
                  note={selectedJournal}
                  mode="journal"
                  calendars={vjournalCalendars}
                  saving={updateMutation.isPending}
                  onSave={(uid, data, etag) => updateMutation.mutate({ uid, data, etag })}
                  onDelete={(uid, etag) => deleteMutation.mutate({ uid, etag })}
                  onClose={() => setSelectedUid(null)}
                  onConvertToNote={(uid, data, etag) =>
                    handleConvertToNote({
                      uid,
                      etag,
                      collectionUrl: data.collectionUrl,
                      collectionId: '',
                      data,
                    })
                  }
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
                initial={emptyJournalJson(defaultCollectionUrl, newJournalDefaultDate ?? undefined)}
                calendars={vjournalCalendars}
                mode="journal"
                isNew
                saving={createMutation.isPending}
                onSave={(data) => createMutation.mutate(data)}
                onCancel={() => {
                  setCreatingNew(false);
                  setNewJournalDefaultDate(null);
                }}
              />
            )}
            {selectedJournal && !creatingNew && (
              <VJournalDetail
                note={selectedJournal}
                mode="journal"
                calendars={vjournalCalendars}
                saving={updateMutation.isPending}
                onSave={(uid, data, etag) => updateMutation.mutate({ uid, data, etag })}
                onDelete={(uid, etag) => deleteMutation.mutate({ uid, etag })}
                onClose={() => setSelectedUid(null)}
                onConvertToNote={(uid, data, etag) =>
                  handleConvertToNote({
                    uid,
                    etag,
                    collectionUrl: data.collectionUrl,
                    collectionId: '',
                    data,
                  })
                }
              />
            )}
          </div>
        )}
      </div>

      {/* Bulk delete dialog */}
      {showBulkDelete && (
        <BulkDeleteDialog
          count={selectedUids.size}
          noun="journal"
          deleting={bulkDeleteMutation.isPending}
          onConfirm={() => bulkDeleteMutation.mutate(selectedJournals)}
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

      {/* Per-journal tag edit dialog */}
      {journalForTagEdit && (
        <EditTagsDialog
          journal={journalForTagEdit}
          saving={singleTagEditMutation.isPending}
          onSave={(categories) =>
            singleTagEditMutation.mutate({
              uid: journalForTagEdit.uid,
              data: { ...journalForTagEdit.data, categories },
              etag: journalForTagEdit.etag,
            })
          }
          onCancel={() => setJournalForTagEdit(null)}
        />
      )}

      {/* Per-journal delete dialog */}
      {journalForDelete && (
        <BulkDeleteDialog
          count={1}
          noun="journal"
          deleting={singleDeleteMutation.isPending}
          onConfirm={() =>
            singleDeleteMutation.mutate({ uid: journalForDelete.uid, etag: journalForDelete.etag })
          }
          onCancel={() => setJournalForDelete(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-20 md:bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg bg-foreground text-background text-xs px-4 py-2 shadow-lg">
          <span>{toast.msg}</span>
          {toast.action && (
            <button
              onClick={() => {
                toast.action!.onClick();
                setToast(null);
              }}
              className="font-medium underline hover:no-underline shrink-0"
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Inline dialogs ─────────────────────────────────────────────────────────────

function EditTagsDialog({
  journal,
  saving,
  onSave,
  onCancel,
}: {
  journal: Note;
  saving: boolean;
  onSave: (categories: string[]) => void;
  onCancel: () => void;
}) {
  const [categories, setCategories] = useState<string[]>(journal.data.categories);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border border-border rounded-lg shadow-xl p-6 w-full max-w-sm">
        <h2 className="text-sm font-semibold mb-0.5">Edit tags</h2>
        <p className="text-xs text-muted-foreground mb-4 truncate">
          &ldquo;{journal.data.summary || 'Untitled'}&rdquo;
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
