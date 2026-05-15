import { useState, useMemo, useRef, useCallback } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, UserRound, Plus, Download, Upload, Pencil, Trash2, ChevronDown, X, PencilLine } from 'lucide-react';
import type { AddressBook, Contact, ContactJson } from '@dave/shared';
import { getAddressBooks, getContacts } from '../api/collections';
import {
  createContact,
  updateContact,
  deleteContact,
  importContacts,
  exportContactsUrl,
  writeResponseToContact,
} from '../api/contacts';
import { ApiError } from '../api/client';
import { useCollectionVisibility } from '../contexts/CollectionVisibility';
import { useContactDrag } from '../contexts/ContactDrag';
import { cn } from '../lib/utils';
import ContactDetail, { Avatar } from '../components/ContactDetail';
import ContactEditForm, { emptyContactJson } from '../components/ContactEditForm';
import DeleteContactDialog from '../components/DeleteContactDialog';
import BulkDeleteDialog from '../components/BulkDeleteDialog';
import BulkEditModal, { applyBulkEdit } from '../components/BulkEditModal';
import type { BulkEditConfig } from '../components/BulkEditModal';

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

// ── Panel modes ───────────────────────────────────────────────────────────────

type Panel =
  | { mode: 'detail'; contact: Contact }
  | { mode: 'create' }
  | { mode: 'edit'; contact: Contact }
  | { mode: 'empty' };

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ContactsPage() {
  const queryClient = useQueryClient();
  const { startDrag, endDrag } = useContactDrag();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [panel, setPanel] = useState<Panel>({ mode: 'empty' });
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [createAbId, setCreateAbId] = useState<string>('');
  const [editAbId, setEditAbId] = useState<string>('');
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const { hiddenAddressBooks } = useCollectionVisibility();

  const isMultiSelect = selectedIds.size > 0;

  // ── Selection helpers ────────────────────────────────────────────────────

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // ── Data fetching ────────────────────────────────────────────────────────

  const abQuery = useQuery({
    queryKey: ['addressbooks'],
    queryFn: getAddressBooks,
    staleTime: 5 * 60_000,
  });

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

  const groups = useMemo(() => {
    const map = new Map<string, Contact[]>();
    for (const c of filtered) {
      const letter = groupLetter(c);
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter)!.push(c);
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === '#') return 1;
      if (b === '#') return -1;
      return a.localeCompare(b);
    });
  }, [filtered]);

  const selectedContact = allContacts.find((c) => c.id === selectedId) ?? null;

  // ── Toast helper ─────────────────────────────────────────────────────────

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Mutations ────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: ({ abId, data }: { abId: string; data: ContactJson }) =>
      createContact(abId, data),
    onSuccess: (result) => {
      queryClient.setQueryData<Contact[]>(
        ['contacts', result.addressBookId],
        (old) => [...(old ?? []), writeResponseToContact(result)],
      );
      setSelectedId(result.id);
      setPanel({ mode: 'detail', contact: writeResponseToContact(result) });
      showToast('Contact created');
    },
    onError: (e) => showToast(errorMessage(e), 'err'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ contact, data }: { contact: Contact; data: ContactJson }) =>
      updateContact(contact.addressBookId, contact.id, data, contact.etag),
    onSuccess: (result, { contact }) => {
      const updated = writeResponseToContact(result);
      queryClient.setQueryData<Contact[]>(
        ['contacts', contact.addressBookId],
        (old) => (old ?? []).map((c) => (c.id === updated.id ? updated : c)),
      );
      setPanel({ mode: 'detail', contact: updated });
      showToast('Contact saved');
    },
    onError: (e) => showToast(errorMessage(e, true), 'err'),
  });

  const deleteMutation = useMutation({
    mutationFn: (c: Contact) => deleteContact(c.addressBookId, c.id, c.etag),
    onSuccess: (_, contact) => {
      queryClient.setQueryData<Contact[]>(
        ['contacts', contact.addressBookId],
        (old) => (old ?? []).filter((c) => c.id !== contact.id),
      );
      setDeleteTarget(null);
      setSelectedId(null);
      setPanel({ mode: 'empty' });
      showToast('Contact deleted');
    },
    onError: (e) => { setDeleteTarget(null); showToast(errorMessage(e, true), 'err'); },
  });

  // Single-contact move: create in new AB + delete from old AB
  const moveMutation = useMutation({
    mutationFn: async ({
      contact,
      data,
      newAbId,
    }: {
      contact: Contact;
      data: ContactJson;
      newAbId: string;
    }) => {
      const created = await createContact(newAbId, data);
      await deleteContact(contact.addressBookId, contact.id, contact.etag);
      return { created, oldAbId: contact.addressBookId, oldId: contact.id };
    },
    onSuccess: ({ created, oldAbId, oldId }) => {
      queryClient.setQueryData<Contact[]>(
        ['contacts', oldAbId],
        (old) => (old ?? []).filter((c) => c.id !== oldId),
      );
      const newContact = writeResponseToContact(created);
      queryClient.setQueryData<Contact[]>(
        ['contacts', created.addressBookId],
        (old) => [...(old ?? []), newContact],
      );
      setSelectedId(newContact.id);
      setPanel({ mode: 'detail', contact: newContact });
      showToast('Contact moved');
    },
    onError: (e) => showToast(errorMessage(e, true), 'err'),
  });

  // Bulk move: fires all moves in parallel, updates each cache entry
  const bulkMoveMutation = useMutation({
    mutationFn: ({ contacts, newAbId }: { contacts: Contact[]; newAbId: string }) =>
      Promise.allSettled(
        contacts.map(async (contact) => {
          const created = await createContact(newAbId, contact.data);
          await deleteContact(contact.addressBookId, contact.id, contact.etag);
          return { created, oldAbId: contact.addressBookId, oldId: contact.id };
        }),
      ),
    onSuccess: (results) => {
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const { created, oldAbId, oldId } = r.value;
          queryClient.setQueryData<Contact[]>(
            ['contacts', oldAbId],
            (old) => (old ?? []).filter((c) => c.id !== oldId),
          );
          queryClient.setQueryData<Contact[]>(
            ['contacts', created.addressBookId],
            (old) => [...(old ?? []), writeResponseToContact(created)],
          );
        }
      }
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const fail = results.filter((r) => r.status === 'rejected').length;
      clearSelection();
      showToast(`Moved ${ok} contact${ok !== 1 ? 's' : ''}${fail ? ` (${fail} failed)` : ''}`);
    },
    onError: (e) => showToast(errorMessage(e), 'err'),
  });

  const importMutation = useMutation({
    mutationFn: ({ abId, vcf }: { abId: string; vcf: string }) =>
      importContacts(abId, vcf),
    onSuccess: (result, { abId }) => {
      void queryClient.invalidateQueries({ queryKey: ['contacts', abId] });
      showToast(`Imported ${result.imported} contact${result.imported !== 1 ? 's' : ''}${result.failed ? ` (${result.failed} failed)` : ''}`);
    },
    onError: (e) => showToast(errorMessage(e), 'err'),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (contacts: Contact[]) =>
      Promise.allSettled(contacts.map((c) => deleteContact(c.addressBookId, c.id, c.etag))),
    onSuccess: (results, contacts) => {
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          const c = contacts[i]!;
          queryClient.setQueryData<Contact[]>(
            ['contacts', c.addressBookId],
            (old) => (old ?? []).filter((x) => x.id !== c.id),
          );
        }
      });
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const fail = results.filter((r) => r.status === 'rejected').length;
      setShowBulkDelete(false);
      clearSelection();
      setSelectedId(null);
      setPanel({ mode: 'empty' });
      showToast(`Deleted ${ok} contact${ok !== 1 ? 's' : ''}${fail ? ` (${fail} failed)` : ''}`);
    },
    onError: (e) => { setShowBulkDelete(false); showToast(errorMessage(e), 'err'); },
  });

  const bulkEditMutation = useMutation({
    mutationFn: ({ contacts, config }: { contacts: Contact[]; config: BulkEditConfig }) =>
      Promise.allSettled(
        contacts.map((contact) => {
          const newData = applyBulkEdit(contact.data, config);
          return updateContact(contact.addressBookId, contact.id, newData, contact.etag)
            .then((result) => ({ result, contact }));
        }),
      ),
    onSuccess: (results) => {
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const updated = writeResponseToContact(r.value.result);
          queryClient.setQueryData<Contact[]>(
            ['contacts', updated.addressBookId],
            (old) => (old ?? []).map((c) => (c.id === updated.id ? updated : c)),
          );
        }
      }
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const fail = results.filter((r) => r.status === 'rejected').length;
      setShowBulkEdit(false);
      showToast(`Updated ${ok} contact${ok !== 1 ? 's' : ''}${fail ? ` (${fail} failed)` : ''}`);
    },
    onError: (e) => { setShowBulkEdit(false); showToast(errorMessage(e), 'err'); },
  });

  // ── UI handlers ──────────────────────────────────────────────────────────

  const defaultAbId = (): string => {
    const visible = (abQuery.data ?? []).filter((ab) => !hiddenAddressBooks.has(ab.id));
    return visible[0]?.id ?? abQuery.data?.[0]?.id ?? '';
  };

  const handleNewContact = () => {
    const abId = createAbId || defaultAbId();
    setCreateAbId(abId);
    setPanel({ mode: 'create' });
    setSelectedId(null);
  };

  const handleSelectContact = (c: Contact) => {
    setSelectedId(c.id);
    setPanel({ mode: 'detail', contact: c });
  };

  const handleEdit = (c: Contact) => {
    setEditAbId(c.addressBookId);
    setPanel({ mode: 'edit', contact: c });
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const abId = defaultAbId();
    if (!abId) { showToast('No address book available', 'err'); return; }
    const reader = new FileReader();
    reader.onload = () => importMutation.mutate({ abId, vcf: reader.result as string });
    reader.readAsText(file);
  };

  const handleExport = (ab: AddressBook) => {
    const a = document.createElement('a');
    a.href = exportContactsUrl(ab.id);
    a.download = `${ab.displayName || ab.id}.vcf`;
    a.click();
  };

  const handleBulkMove = (newAbId: string) => {
    const contacts = allContacts.filter((c) => selectedIds.has(c.id));
    bulkMoveMutation.mutate({ contacts, newAbId });
  };

  const handleBulkDelete = () => {
    const contacts = allContacts.filter((c) => selectedIds.has(c.id));
    bulkDeleteMutation.mutate(contacts);
  };

  const handleBulkEdit = (config: BulkEditConfig) => {
    const contacts = allContacts.filter((c) => selectedIds.has(c.id));
    bulkEditMutation.mutate({ contacts, config });
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  const addressBooks = abQuery.data ?? [];

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: list pane ── */}
      <div className="w-72 shrink-0 border-r border-border flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="px-3 py-2 border-b border-border space-y-2">
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
          <div className="flex gap-1">
            <button
              onClick={handleNewContact}
              className="flex flex-1 items-center justify-center gap-1 rounded-md border border-input bg-background py-1.5 text-xs hover:bg-muted"
            >
              <Plus className="h-3.5 w-3.5" /> New
            </button>
            <button
              onClick={() => importFileRef.current?.click()}
              disabled={importMutation.isPending}
              title="Import .vcf"
              className="flex items-center justify-center rounded-md border border-input bg-background px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />
            </button>
            {addressBooks.length === 1 && (
              <button
                onClick={() => handleExport(addressBooks[0]!)}
                title="Export all"
                className="flex items-center justify-center rounded-md border border-input bg-background px-2.5 py-1.5 text-xs hover:bg-muted"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            )}
            <input
              ref={importFileRef}
              type="file"
              accept=".vcf,text/vcard"
              className="hidden"
              onChange={handleImportFile}
            />
          </div>
        </div>

        {/* Multi-select action bar OR count */}
        {!isLoadingContacts && (
          isMultiSelect ? (
            <MultiSelectBar
              count={selectedIds.size}
              total={filtered.length}
              onSelectAll={() => setSelectedIds(new Set(filtered.map((c) => c.id)))}
              onSelectNone={clearSelection}
              onClear={clearSelection}
            />
          ) : (
            <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border">
              {filtered.length} {filtered.length === 1 ? 'contact' : 'contacts'}
            </div>
          )
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoadingContacts && <LoadingSkeleton />}

          {!isLoadingContacts && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
              <UserRound className="h-8 w-8 opacity-40" />
              <p className="text-sm">{search ? 'No matches' : 'No contacts'}</p>
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
                  isChecked={selectedIds.has(c.id)}
                  isMultiSelect={isMultiSelect}
                  onClick={() => handleSelectContact(c)}
                  onToggleSelect={() => toggleSelect(c.id)}
                  onDragStart={() => {
                    // If dragging a checked contact, move the whole selection;
                    // otherwise move just this one.
                    if (selectedIds.has(c.id) && selectedIds.size > 1) {
                      const all = allContacts.filter((x) => selectedIds.has(x.id));
                      startDrag(c, (targetAbId) =>
                        bulkMoveMutation.mutate({ contacts: all, newAbId: targetAbId }),
                      );
                    } else {
                      startDrag(c, (targetAbId) =>
                        moveMutation.mutate({ contact: c, data: c.data, newAbId: targetAbId }),
                      );
                    }
                  }}
                  onDragEnd={endDrag}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── Right: detail / edit pane ── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {selectedIds.size >= 2 ? (
          <MultiContactPanel
            contacts={allContacts.filter((c) => selectedIds.has(c.id))}
            addressBooks={addressBooks}
            moving={bulkMoveMutation.isPending}
            deleting={bulkDeleteMutation.isPending}
            editing={bulkEditMutation.isPending}
            onExport={() => {
              const ids = new Set(
                allContacts.filter((c) => selectedIds.has(c.id)).map((c) => c.addressBookId),
              );
              addressBooks.filter((ab) => ids.has(ab.id)).forEach(handleExport);
            }}
            onMove={handleBulkMove}
            onDelete={() => setShowBulkDelete(true)}
            onEdit={() => setShowBulkEdit(true)}
            onClickContact={(c) => {
              clearSelection();
              handleSelectContact(c);
            }}
          />
        ) : (
          <>
            {panel.mode === 'create' && (
              <>
                <PaneHeader title="New contact" />
                <div className="flex-1 overflow-hidden">
                  <ContactEditForm
                    initial={emptyContactJson()}
                    addressBooks={addressBooks}
                    selectedAddressBookId={createAbId || defaultAbId()}
                    onAddressBookChange={setCreateAbId}
                    onSave={(data) => {
                      const abId = createAbId || defaultAbId();
                      createMutation.mutate({ abId, data });
                    }}
                    onCancel={() => setPanel({ mode: 'empty' })}
                    saving={createMutation.isPending}
                  />
                </div>
              </>
            )}

            {panel.mode === 'edit' && (
              <>
                <PaneHeader title="Edit contact" />
                <div className="flex-1 overflow-hidden">
                  <ContactEditForm
                    initial={panel.contact.data}
                    addressBooks={addressBooks}
                    selectedAddressBookId={editAbId || panel.contact.addressBookId}
                    onAddressBookChange={setEditAbId}
                    onSave={(data) => {
                      const targetAbId = editAbId || panel.contact.addressBookId;
                      if (targetAbId !== panel.contact.addressBookId) {
                        moveMutation.mutate({ contact: panel.contact, data, newAbId: targetAbId });
                      } else {
                        updateMutation.mutate({ contact: panel.contact, data });
                      }
                    }}
                    onCancel={() => setPanel({ mode: 'detail', contact: panel.contact })}
                    saving={updateMutation.isPending || moveMutation.isPending}
                  />
                </div>
              </>
            )}

            {panel.mode === 'detail' && selectedContact && (
              <>
                <div className="flex items-center justify-end gap-1 px-4 py-2 border-b border-border shrink-0">
                  {addressBooks.length > 1 && (
                    <button
                      onClick={() => {
                        const ab = addressBooks.find((a) => a.id === selectedContact.addressBookId);
                        if (ab) handleExport(ab);
                      }}
                      title="Export this address book"
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                    >
                      <Download className="h-3.5 w-3.5" /> Export
                    </button>
                  )}
                  <button
                    onClick={() => handleEdit(selectedContact)}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button
                    onClick={() => setDeleteTarget(selectedContact)}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <ContactDetail contact={selectedContact} />
                </div>
              </>
            )}

            {panel.mode === 'empty' && (
              <EmptyState hasContacts={allContacts.length > 0} isLoading={isLoadingContacts} />
            )}
          </>
        )}
      </div>

      {/* ── Delete dialog ── */}
      {deleteTarget && (
        <DeleteContactDialog
          contact={deleteTarget}
          onConfirm={() => deleteMutation.mutate(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
          deleting={deleteMutation.isPending}
        />
      )}

      {/* ── Bulk delete dialog ── */}
      {showBulkDelete && (
        <BulkDeleteDialog
          count={selectedIds.size}
          onConfirm={handleBulkDelete}
          onCancel={() => setShowBulkDelete(false)}
          deleting={bulkDeleteMutation.isPending}
        />
      )}

      {/* ── Bulk edit modal ── */}
      {showBulkEdit && (
        <BulkEditModal
          count={selectedIds.size}
          onApply={handleBulkEdit}
          onCancel={() => setShowBulkEdit(false)}
          applying={bulkEditMutation.isPending}
        />
      )}

      {/* ── Toast ── */}
      {toast && (
        <div
          className={cn(
            'fixed bottom-4 right-4 z-50 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg',
            toast.type === 'ok'
              ? 'bg-green-600 text-white'
              : 'bg-destructive text-destructive-foreground',
          )}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Multi-select action bar ───────────────────────────────────────────────────

function MultiSelectBar({
  count,
  total,
  onSelectAll,
  onSelectNone,
  onClear,
}: {
  count: number;
  total: number;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onClear: () => void;
}) {
  const allSelected = count === total;

  return (
    <div className="px-3 py-1.5 border-b border-border bg-primary/5 flex items-center gap-1.5">
      <span className="text-xs font-medium text-primary flex-1 shrink-0">
        {count} selected
      </span>

      <button
        onClick={allSelected ? onSelectNone : onSelectAll}
        className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
      >
        {allSelected ? 'None' : 'All'}
      </button>

      <button
        onClick={onClear}
        title="Clear selection"
        className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── List item ─────────────────────────────────────────────────────────────────

function ContactListItem({
  contact,
  selected,
  isChecked,
  isMultiSelect,
  onClick,
  onToggleSelect,
  onDragStart,
  onDragEnd,
}: {
  contact: Contact;
  selected: boolean;
  isChecked: boolean;
  isMultiSelect: boolean;
  onClick: () => void;
  onToggleSelect: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const name =
    contact.data.fullName ||
    [contact.data.name.given, contact.data.name.family].filter(Boolean).join(' ') ||
    '(No name)';
  const subtitle = contactSubtitle(contact);

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(); }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      className={cn(
        'group w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors',
        'cursor-grab active:cursor-grabbing outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isChecked ? 'bg-primary/10' : selected ? 'bg-primary/5' : 'hover:bg-muted',
      )}
    >
      {/* Avatar with checkbox overlay — no layout shift */}
      <div className="relative shrink-0 h-8 w-8">
        {/* Avatar dims on hover or when checked */}
        <div
          className={cn(
            'transition-opacity',
            isChecked ? 'opacity-30' : 'group-hover:opacity-30',
          )}
        >
          <Avatar contact={contact} size="sm" />
        </div>
        {/* Checkbox appears on hover or in multi-select mode */}
        <label
          className={cn(
            'absolute inset-0 flex items-center justify-center rounded-full cursor-pointer transition-opacity',
            isChecked || isMultiSelect ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
          onClick={(e) => { e.stopPropagation(); }}
        >
          <input
            type="checkbox"
            checked={isChecked}
            onChange={onToggleSelect}
            className="h-4 w-4 cursor-pointer accent-primary"
          />
        </label>
      </div>

      <div className="min-w-0">
        <p className={cn('text-sm font-medium truncate', selected && !isChecked ? 'text-primary' : 'text-foreground')}>
          {name}
        </p>
        {subtitle && (
          <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

// ── Supporting components ─────────────────────────────────────────────────────

function PaneHeader({ title }: { title: string }) {
  return (
    <div className="px-4 py-2.5 border-b border-border shrink-0">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
    </div>
  );
}

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

function EmptyState({ hasContacts, isLoading }: { hasContacts: boolean; isLoading: boolean }) {
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

// ── Multi-contact selection panel ─────────────────────────────────────────────

function MultiContactPanel({
  contacts,
  addressBooks,
  moving,
  deleting,
  editing,
  onExport,
  onMove,
  onDelete,
  onEdit,
  onClickContact,
}: {
  contacts: Contact[];
  addressBooks: AddressBook[];
  moving: boolean;
  deleting: boolean;
  editing: boolean;
  onExport: () => void;
  onMove: (abId: string) => void;
  onDelete: () => void;
  onEdit: () => void;
  onClickContact: (c: Contact) => void;
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  const busy = moving || deleting || editing;
  const abName = (id: string) =>
    addressBooks.find((ab) => ab.id === id)?.displayName ?? id;

  return (
    <>
      {/* Action header — mirrors the single-contact detail toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <span className="text-xs text-muted-foreground">
          {contacts.length} contacts selected
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onExport}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </button>
          <button
            onClick={onEdit}
            disabled={busy}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <PencilLine className="h-3.5 w-3.5" /> Edit
          </button>

          {addressBooks.length > 1 && (
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
                  <div className="absolute right-0 top-full mt-1 z-20 w-44 rounded-md border border-border bg-background shadow-lg py-1 text-sm">
                    {addressBooks.map((ab) => (
                      <button
                        key={ab.id}
                        onClick={() => { setMoveOpen(false); onMove(ab.id); }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted truncate"
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: ab.color || '#6C757D' }}
                        />
                        {ab.displayName}
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

      <div className="flex-1 overflow-y-auto p-5">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          {contacts.map((c) => {
            const name =
              c.data.fullName ||
              [c.data.name.given, c.data.name.family].filter(Boolean).join(' ') ||
              '(No name)';
            const subtitle =
              c.data.emails[0]?.value ||
              c.data.phones[0]?.value ||
              c.data.organization ||
              '';

            return (
              <button
                key={c.id}
                onClick={() => onClickContact(c)}
                className={cn(
                  'flex flex-col items-center gap-2 p-4 rounded-lg border border-border',
                  'text-center hover:bg-muted hover:border-primary/30 transition-colors',
                )}
              >
                <Avatar contact={c} size="lg" />
                <div className="w-full min-w-0 space-y-0.5">
                  <p className="text-sm font-medium truncate">{name}</p>
                  {subtitle && (
                    <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
                  )}
                  <p className="text-xs text-muted-foreground/60 truncate">{abName(c.addressBookId)}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

function errorMessage(e: unknown, etagHint = false): string {
  if (e instanceof ApiError) {
    if (e.statusCode === 412 && etagHint)
      return 'Contact was modified elsewhere — please reload and try again.';
    return e.message;
  }
  return 'Something went wrong';
}
