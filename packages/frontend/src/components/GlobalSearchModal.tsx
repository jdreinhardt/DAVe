import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookUser,
  Calendar,
  CheckSquare,
  NotebookPen,
  ScrollText,
  Search,
  X,
} from 'lucide-react';
import type { Contact, AddressBook, GlobalSearchResult } from '@dave/shared';
import { searchGlobal } from '../api/search';
import { cn } from '../lib/utils';

// ── Contact client-side search ────────────────────────────────────────────────

function matchesContact(c: Contact, terms: string[]): boolean {
  const haystack = [
    c.data.fullName,
    c.data.name.given,
    c.data.name.family,
    c.data.organization,
    c.data.title,
    c.data.note,
    ...c.data.emails.map((e) => e.value),
    ...c.data.phones.map((p) => p.value),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return terms.every((t) => haystack.includes(t.toLowerCase()));
}

// ── Result type icons + labels ────────────────────────────────────────────────

function ResultIcon({ type }: { type: GlobalSearchResult['type'] | 'contact' }) {
  const cls = 'h-3.5 w-3.5 shrink-0';
  switch (type) {
    case 'task':     return <CheckSquare className={cn(cls, 'text-blue-500')} />;
    case 'note':     return <NotebookPen className={cn(cls, 'text-amber-500')} />;
    case 'journal':  return <ScrollText  className={cn(cls, 'text-purple-500')} />;
    case 'contact':  return <BookUser    className={cn(cls, 'text-green-500')} />;
    case 'event':    return <Calendar    className={cn(cls, 'text-red-500')} />;
  }
}

const TYPE_LABELS: Record<GlobalSearchResult['type'] | 'contact', string> = {
  task: 'Tasks',
  note: 'Notes',
  journal: 'Journals',
  contact: 'Contacts',
  event: 'Events',
};

// ── Unified result item ───────────────────────────────────────────────────────

interface UnifiedResult {
  type: GlobalSearchResult['type'] | 'contact';
  uid: string;
  summary: string;
  snippet: string;
  categories: string[];
  date: string | null;
  collectionId: string;
  collectionUrl: string;
  eventStart?: string;
  // contacts only
  contactId?: string;
}

// ── Section ───────────────────────────────────────────────────────────────────

function ResultSection({
  label,
  results,
  activeIdx,
  globalOffset,
  onSelect,
  itemRefs,
}: {
  label: string;
  results: UnifiedResult[];
  activeIdx: number;
  globalOffset: number;
  onSelect: (r: UnifiedResult) => void;
  itemRefs: React.RefObject<(HTMLButtonElement | null)[]>;
}) {
  if (results.length === 0) return null;
  return (
    <div>
      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground select-none">
        {label}
      </div>
      {results.map((r, i) => {
        const idx = globalOffset + i;
        const isActive = idx === activeIdx;
        return (
          <button
            key={`${r.type}-${r.uid}-${i}`}
            ref={(el) => { if (itemRefs.current) itemRefs.current[idx] = el; }}
            onMouseDown={(e) => { e.preventDefault(); onSelect(r); }}
            className={cn(
              'w-full text-left px-3 py-2 flex items-start gap-2.5 text-sm transition-colors',
              isActive ? 'bg-primary/10 text-foreground' : 'hover:bg-muted text-foreground',
            )}
          >
            <span className="mt-0.5">
              <ResultIcon type={r.type} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block truncate font-medium leading-snug">{r.summary || '(untitled)'}</span>
              {r.snippet && (
                <span className="block truncate text-xs text-muted-foreground leading-snug mt-0.5">
                  {r.snippet}
                </span>
              )}
              {r.categories.length > 0 && (
                <span className="mt-1 flex flex-wrap gap-1">
                  {r.categories.slice(0, 3).map((cat) => (
                    <span
                      key={cat}
                      className="inline-flex items-center rounded px-1 py-0 text-[10px] bg-muted text-muted-foreground"
                    >
                      {cat}
                    </span>
                  ))}
                </span>
              )}
            </span>
            {r.date && (
              <span className="shrink-0 text-xs text-muted-foreground mt-0.5">
                {new Date(r.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function GlobalSearchModal({ open, onClose }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Debounce the search query 200ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  // Reset active index when results change
  useEffect(() => { setActiveIdx(0); }, [debouncedQ]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setDebouncedQ('');
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  // ── Server search (tasks, notes, journals, events) ────────────────────────
  const serverQuery = useQuery({
    queryKey: ['globalSearch', debouncedQ],
    queryFn: () => searchGlobal(debouncedQ),
    enabled: debouncedQ.length >= 1,
    staleTime: 30_000,
  });

  // ── Client-side contact search ────────────────────────────────────────────
  const addressBooks = queryClient.getQueryData<AddressBook[]>(['addressbooks']) ?? [];
  const allContacts: Contact[] = useMemo(
    () => addressBooks.flatMap((ab) => queryClient.getQueryData<Contact[]>(['contacts', ab.id]) ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addressBooks, debouncedQ], // re-derive on query change so memoisation doesn't stale
  );

  const contactResults: UnifiedResult[] = useMemo(() => {
    if (!debouncedQ) return [];
    const terms = debouncedQ.split(/\s+/).filter(Boolean);
    return allContacts
      .filter((c) => matchesContact(c, terms))
      .slice(0, 10)
      .map((c) => ({
        type: 'contact' as const,
        uid: c.id,
        summary: c.data.fullName ||
          [c.data.name.given, c.data.name.family].filter(Boolean).join(' ') ||
          c.id,
        snippet: [c.data.organization, c.data.emails[0]?.value].filter(Boolean).join(' · '),
        categories: [],
        date: null,
        collectionId: c.addressBookId,
        collectionUrl: '',
        contactId: c.id,
      }));
  }, [allContacts, debouncedQ]);

  // ── Flatten all results for keyboard nav ─────────────────────────────────
  const serverData = serverQuery.data;

  const sections: Array<{ type: GlobalSearchResult['type'] | 'contact'; items: UnifiedResult[] }> =
    useMemo(() => {
      if (!debouncedQ || !serverData) {
        return contactResults.length > 0
          ? [{ type: 'contact', items: contactResults }]
          : [];
      }
      const toUnified = (r: GlobalSearchResult): UnifiedResult => ({
        type: r.type,
        uid: r.uid,
        summary: r.summary,
        snippet: r.snippet,
        categories: r.categories,
        date: r.date,
        collectionId: r.collectionId,
        collectionUrl: r.collectionUrl,
        eventStart: r.eventStart,
      });
      return [
        { type: 'task'    as const, items: serverData.tasks.map(toUnified) },
        { type: 'note'    as const, items: serverData.notes.map(toUnified) },
        { type: 'journal' as const, items: serverData.journals.map(toUnified) },
        { type: 'contact' as const, items: contactResults },
        { type: 'event'   as const, items: serverData.events.map(toUnified) },
      ].filter((s) => s.items.length > 0);
    }, [debouncedQ, serverData, contactResults]);

  const flatResults: UnifiedResult[] = useMemo(
    () => sections.flatMap((s) => s.items),
    [sections],
  );

  const totalResults = flatResults.length;

  // ── Navigation on select ──────────────────────────────────────────────────
  const handleSelect = useCallback(
    (r: UnifiedResult) => {
      onClose();
      switch (r.type) {
        case 'task':
          navigate('/tasks', { state: { selectUid: r.uid } });
          break;
        case 'note':
          navigate('/notes', { state: { selectUid: r.uid } });
          break;
        case 'journal':
          navigate('/journals', { state: { selectUid: r.uid } });
          break;
        case 'contact':
          navigate('/contacts', { state: { selectId: r.contactId ?? r.uid } });
          break;
        case 'event':
          navigate('/calendar', { state: { selectEventId: r.uid, eventStart: r.eventStart } });
          break;
      }
    },
    [navigate, onClose],
  );

  // ── Keyboard navigation ───────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (totalResults === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => {
          const next = Math.min(i + 1, totalResults - 1);
          itemRefs.current[next]?.scrollIntoView({ block: 'nearest' });
          return next;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => {
          const next = Math.max(i - 1, 0);
          itemRefs.current[next]?.scrollIntoView({ block: 'nearest' });
          return next;
        });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const result = flatResults[activeIdx];
        if (result) handleSelect(result);
      }
    },
    [totalResults, flatResults, activeIdx, handleSelect, onClose],
  );

  // ── Backdrop click ────────────────────────────────────────────────────────
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  if (!open) return null;

  const hasQuery = debouncedQ.length > 0;
  const isLoading = hasQuery && serverQuery.isFetching;
  const isEmpty = hasQuery && !isLoading && totalResults === 0;
  const hasEvents = serverData && serverData.events.length > 0;

  // Compute per-section global offsets for keyboard nav
  const offsets: number[] = [];
  let running = 0;
  for (const s of sections) {
    offsets.push(running);
    running += s.items.length;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4 bg-black/40"
      onClick={handleBackdropClick}
      aria-modal="true"
      role="dialog"
      aria-label="Global search"
    >
      <div
        className="w-full max-w-xl bg-card border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '70vh' }}
      >
        {/* Input */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tasks, notes, journals, contacts, events…"
            className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button
              onClick={() => { setQuery(''); setDebouncedQ(''); inputRef.current?.focus(); }}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Clear"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Results */}
        <div className="overflow-y-auto flex-1">
          {!hasQuery && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Type to search across all your data
            </p>
          )}

          {isLoading && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Searching…</p>
          )}

          {isEmpty && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No results for &ldquo;{debouncedQ}&rdquo;
            </p>
          )}

          {!isLoading && sections.map((section, si) => (
            <ResultSection
              key={section.type}
              label={TYPE_LABELS[section.type]}
              results={section.items}
              activeIdx={activeIdx}
              globalOffset={offsets[si] ?? 0}
              onSelect={handleSelect}
              itemRefs={itemRefs}
            />
          ))}

          {hasEvents && (
            <p className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border">
              Events: searching ±{60} days from today. Results may not include all recurring occurrences.
            </p>
          )}
        </div>

        {/* Footer hint */}
        {totalResults > 0 && (
          <div className="flex items-center gap-3 px-3 py-1.5 border-t border-border shrink-0 text-[10px] text-muted-foreground">
            <span><kbd className="font-mono">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono">↵</kbd> open</span>
            <span><kbd className="font-mono">Esc</kbd> close</span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
