import { useState, useMemo } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { Search, UserRound } from 'lucide-react';
import type { Contact } from '@dave/shared';
import { getAddressBooks, getContacts } from '../api/collections';
import { useCollectionVisibility } from '../contexts/CollectionVisibility';
import { cn } from '../lib/utils';
import ContactDetail, { Avatar } from '../components/ContactDetail';

// ── Sort / group helpers ──────────────────────────────────────────────────────

function sortKey(c: Contact): string {
  const { family, given } = c.data.name;
  if (family) return `${family}\x00${given}`.toLowerCase();
  return c.data.fullName.toLowerCase();
}

function groupLetter(c: Contact): string {
  const key = sortKey(c);
  const ch = key[0] ?? '#';
  return /[a-z]/i.test(ch) ? ch.toUpperCase() : '#';
}

function contactSubtitle(c: Contact): string {
  const email = c.data.emails[0]?.value;
  if (email) return email;
  const phone = c.data.phones[0]?.value;
  if (phone) return phone;
  return c.data.organization;
}

function matchesSearch(c: Contact, term: string): boolean {
  const t = term.toLowerCase();
  const { data } = c;
  return (
    data.fullName.toLowerCase().includes(t) ||
    data.name.family.toLowerCase().includes(t) ||
    data.name.given.toLowerCase().includes(t) ||
    data.organization.toLowerCase().includes(t) ||
    data.emails.some((e) => e.value.toLowerCase().includes(t)) ||
    data.phones.some((p) => p.value.includes(t)) ||
    data.note.toLowerCase().includes(t)
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ContactsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const { hiddenAddressBooks } = useCollectionVisibility();

  // Address books (shared cache with sidebar)
  const abQuery = useQuery({
    queryKey: ['addressbooks'],
    queryFn: getAddressBooks,
    staleTime: 5 * 60_000,
  });

  // Contacts from each address book in parallel
  const contactQueries = useQueries({
    queries: (abQuery.data ?? []).map((ab) => ({
      queryKey: ['contacts', ab.id],
      queryFn: () => getContacts(ab.id),
      staleTime: 2 * 60_000,
      enabled: !!abQuery.data,
    })),
  });

  const isLoadingContacts =
    abQuery.isLoading || contactQueries.some((q) => q.isLoading);

  const allContacts: Contact[] = useMemo(() => {
    const flat = contactQueries.flatMap((q) => q.data ?? []);
    return flat.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  }, [contactQueries]);

  const filtered = useMemo(() => {
    let result = allContacts.filter((c) => !hiddenAddressBooks.has(c.addressBookId));
    if (search.trim()) result = result.filter((c) => matchesSearch(c, search.trim()));
    return result;
  }, [allContacts, search, hiddenAddressBooks]);

  // Group by first letter
  const groups = useMemo(() => {
    const map = new Map<string, Contact[]>();
    for (const c of filtered) {
      const letter = groupLetter(c);
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter)!.push(c);
    }
    // Sort keys: letters first (A-Z), then '#'
    return [...map.entries()].sort(([a], [b]) => {
      if (a === '#') return 1;
      if (b === '#') return -1;
      return a.localeCompare(b);
    });
  }, [filtered]);

  const selectedContact = allContacts.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: list pane ── */}
      <div className="w-72 shrink-0 border-r border-border flex flex-col overflow-hidden">
        {/* Search */}
        <div className="px-3 py-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              placeholder="Search contacts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn(
                'w-full rounded-md border border-input bg-background pl-8 pr-3 py-1.5 text-sm',
                'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring',
              )}
            />
          </div>
        </div>

        {/* Count */}
        {!isLoadingContacts && (
          <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border">
            {filtered.length} {filtered.length === 1 ? 'contact' : 'contacts'}
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoadingContacts && <LoadingSkeleton />}

          {!isLoadingContacts && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
              <UserRound className="h-8 w-8 opacity-40" />
              <p className="text-sm">
                {search ? 'No matches' : 'No contacts'}
              </p>
            </div>
          )}

          {groups.map(([letter, contacts]) => (
            <div key={letter}>
              <div className="sticky top-0 z-10 px-3 py-1 text-xs font-semibold text-muted-foreground bg-background/90 backdrop-blur-sm border-b border-border/50">
                {letter}
              </div>
              {contacts.map((c) => (
                <ContactListItem
                  key={c.id}
                  contact={c}
                  selected={c.id === selectedId}
                  onClick={() => setSelectedId(c.id)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── Right: detail pane ── */}
      <div className="flex-1 overflow-y-auto">
        {selectedContact ? (
          <ContactDetail contact={selectedContact} />
        ) : (
          <EmptyState hasContacts={allContacts.length > 0} isLoading={isLoadingContacts} />
        )}
      </div>
    </div>
  );
}

// ── List item ─────────────────────────────────────────────────────────────────

function ContactListItem({
  contact,
  selected,
  onClick,
}: {
  contact: Contact;
  selected: boolean;
  onClick: () => void;
}) {
  const name =
    contact.data.fullName ||
    [contact.data.name.given, contact.data.name.family].filter(Boolean).join(' ') ||
    '(No name)';
  const subtitle = contactSubtitle(contact);

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors',
        selected ? 'bg-primary/10' : 'hover:bg-muted',
      )}
    >
      <Avatar contact={contact} size="sm" />
      <div className="min-w-0">
        <p
          className={cn(
            'text-sm font-medium truncate',
            selected ? 'text-primary' : 'text-foreground',
          )}
        >
          {name}
        </p>
        {subtitle && (
          <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
        )}
      </div>
    </button>
  );
}

// ── Supporting components ─────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-px py-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <div className="h-8 w-8 rounded-full bg-muted animate-pulse shrink-0" />
          <div className="space-y-1.5 flex-1">
            <div className="h-3 rounded bg-muted animate-pulse w-3/4" />
            <div className="h-2.5 rounded bg-muted animate-pulse w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  hasContacts,
  isLoading,
}: {
  hasContacts: boolean;
  isLoading: boolean;
}) {
  if (isLoading) return null;
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
      <UserRound className="h-12 w-12 opacity-20" />
      <p className="text-sm">
        {hasContacts ? 'Select a contact to view details' : 'No contacts yet'}
      </p>
    </div>
  );
}
