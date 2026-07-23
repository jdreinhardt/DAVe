import { Fragment, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookUser, Calendar, Check, CheckSquare, LogOut, NotebookPen, Pencil, Plus, RefreshCw, Search, Settings, ScrollText } from 'lucide-react';
import SettingsModal from './SettingsModal';
import AddressBookModal from './AddressBookModal';
import CalendarModal from './CalendarModal';
import { cn, lightenHex } from '../lib/utils';
import { getAddressBooks, getCalendars } from '../api/collections';
import { logout } from '../api/auth';
import { useCollectionVisibility } from '../contexts/CollectionVisibility';
import { useContactDrag } from '../contexts/ContactDrag';
import { useNoteDrag } from '../contexts/NoteDrag';
import type { AddressBook, Calendar as CalendarType } from '@dave/shared';
import type { MeResponse } from '@dave/shared';

interface SidebarProps {
  me: MeResponse;
  isOpen: boolean;
  onClose: () => void;
  onOpenSearch: () => void;
}

export default function Sidebar({ me, isOpen, onClose, onOpenSearch }: SidebarProps) {
  const queryClient = useQueryClient();
  const [showSettings, setShowSettings] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const abQuery = useQuery({
    queryKey: ['addressbooks'],
    queryFn: getAddressBooks,
    staleTime: 5 * 60_000,
  });

  const calQuery = useQuery({
    queryKey: ['calendars'],
    queryFn: getCalendars,
    staleTime: 5 * 60_000,
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
      window.location.href = '/login';
    },
  });

  const { pathname } = useLocation();
  const inContacts = pathname.startsWith('/contacts');
  const inCalendar = pathname.startsWith('/calendar');
  const inTasks = pathname.startsWith('/tasks');
  const inNotes = pathname.startsWith('/notes');
  const inJournals = pathname.startsWith('/journals');
  const isLoading =
    (inContacts ? abQuery.isFetching : false) ||
    (inCalendar || inTasks || inNotes || inJournals ? calQuery.isFetching : false);

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside className={cn(
        'flex flex-col w-64 shrink-0 border-r border-border bg-card overflow-y-auto h-full',
        // Mobile: fixed overlay drawer with slide transition
        'fixed inset-y-0 left-0 z-40 transition-transform duration-200 ease-in-out',
        isOpen ? 'translate-x-0' : '-translate-x-full',
        // Desktop: static in normal flow, always visible
        'md:static md:translate-x-0',
      )}>
      {/* App name + search + sync indicator */}
      <div className="flex items-center gap-1 px-4 py-3 border-b border-border">
        <span className="font-semibold text-foreground flex-1">DAVe</span>
        <button
          onClick={onOpenSearch}
          className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
          title="Search (⌘K)"
          aria-label="Search"
        >
          <Search className="h-3.5 w-3.5" />
        </button>
        {isLoading && (
          <RefreshCw className="h-3 w-3 text-muted-foreground animate-spin" />
        )}
      </div>

      {/* Navigation */}
      <nav className="px-2 py-2 space-y-0.5">
        <SidebarNavLink to="/contacts" icon={<BookUser className="h-4 w-4" />}>
          Contacts
        </SidebarNavLink>
        <SidebarNavLink to="/calendar" icon={<Calendar className="h-4 w-4" />}>
          Calendar
        </SidebarNavLink>
        <SidebarNavLink to="/tasks" icon={<CheckSquare className="h-4 w-4" />}>
          Tasks
        </SidebarNavLink>
        <SidebarNavLink to="/notes" icon={<NotebookPen className="h-4 w-4" />}>
          Notes
        </SidebarNavLink>
        <SidebarNavLink to="/journals" icon={<ScrollText className="h-4 w-4" />}>
          Journals
        </SidebarNavLink>
      </nav>

      <div className="mx-4 my-1 border-t border-border" />

      {inContacts && (
        <CollectionSection
          title="Address Books"
          kind="addressbook"
          items={abQuery.data}
          isError={abQuery.isError}
          defaultColor="#6C757D"
        />
      )}

      {inCalendar && (
        <CollectionSection
          title="Calendars"
          kind="calendar"
          items={calQuery.data}
          isError={calQuery.isError}
          defaultColor="#0082C9"
        />
      )}

      {inTasks && (
        <TaskCollectionSection
          allCalendars={calQuery.data}
          isError={calQuery.isError}
        />
      )}

      {(inNotes || inJournals) && (
        <VJournalCollectionSection
          allCalendars={calQuery.data}
          isError={calQuery.isError}
        />
      )}


      {/* Bottom: create button (when in a collection view) + footer */}
      <div className="mt-auto">
        {(inContacts || inCalendar) && (
          <div className="px-2 pb-1">
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 w-full rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              {inContacts ? 'New address book' : 'New calendar'}
            </button>
          </div>
        )}

        <div className="border-t border-border px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground truncate">{me.displayName || me.username}</span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowSettings(true)}
                title="Settings"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Settings className="h-4 w-4" />
              </button>
              <button
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
                title="Sign out"
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

    </aside>
    {/* Rendered outside <aside> so the slide transform doesn't create a new
        containing block for these fixed-position modals. */}
    {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    {showCreate && inContacts && (
      <AddressBookModal mode="create" onClose={() => setShowCreate(false)} />
    )}
    {showCreate && inCalendar && (
      <CalendarModal mode="create" onClose={() => setShowCreate(false)} />
    )}
    </>
  );
}

function SidebarNavLink({
  to,
  icon,
  children,
}: {
  to: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )
      }
    >
      {icon}
      {children}
    </NavLink>
  );
}

// Notes and Journals share the same VJOURNAL collections and one visibility state.
function VJournalCollectionSection({
  allCalendars,
  isError,
}: {
  allCalendars: CalendarType[] | undefined;
  isError: boolean;
}) {
  const {
    hiddenVJournalCollections,
    toggleVJournalCollection,
    showAllVJournalCollections,
    hideAllVJournalCollections,
  } = useCollectionVisibility();

  const { dragging: noteDragging } = useNoteDrag();
  const isDraggingNote = noteDragging !== null;
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const vjournalCollections = (allCalendars ?? []).filter((cal) =>
    cal.components.includes('VJOURNAL'),
  );

  const allVisible = vjournalCollections.every((c) => !hiddenVJournalCollections.has(c.id));
  const noneVisible =
    vjournalCollections.length > 0 && vjournalCollections.every((c) => hiddenVJournalCollections.has(c.id));

  return (
    <div className="px-2 py-2">
      <div className="group flex items-center justify-between px-3 mb-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Collections
        </p>
        {vjournalCollections.length > 1 && (
          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={showAllVJournalCollections}
              disabled={allVisible}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-default transition-colors"
            >
              All
            </button>
            <span className="text-muted-foreground/40 text-xs">·</span>
            <button
              onClick={() => hideAllVJournalCollections(vjournalCollections.map((c) => c.id))}
              disabled={noneVisible}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-default transition-colors"
            >
              None
            </button>
          </div>
        )}
      </div>

      {isError && (
        <p className="px-3 text-xs text-destructive">Failed to load</p>
      )}

      {allCalendars === undefined && !isError && (
        <div className="px-3 space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-5 rounded bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {allCalendars !== undefined && vjournalCollections.length === 0 && (
        <p className="px-3 text-xs text-muted-foreground">No collections available</p>
      )}

      {vjournalCollections.map((cal) => {
        const isSameCol = isDraggingNote && noteDragging!.note.data.collectionUrl === cal.url;
        const isOver = dropTargetId === cal.id;
        return (
          <label
            key={cal.id}
            onDragOver={isDraggingNote && !isSameCol ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTargetId(cal.id); } : undefined}
            onDragLeave={isDraggingNote ? () => setDropTargetId(null) : undefined}
            onDrop={isDraggingNote && !isSameCol ? (e) => { e.preventDefault(); setDropTargetId(null); noteDragging!.onMove(cal.url); } : undefined}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm cursor-pointer hover:bg-muted transition-colors',
              isOver && 'bg-primary/10 ring-1 ring-inset ring-primary/40',
            )}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={!hiddenVJournalCollections.has(cal.id)}
              onChange={() => toggleVJournalCollection(cal.id)}
            />
            <span
              className="w-4 h-4 rounded shrink-0 border-2 flex items-center justify-center transition-colors"
              style={{
                backgroundColor: hiddenVJournalCollections.has(cal.id) ? 'transparent' : (cal.color || '#0082C9'),
                borderColor: cal.color || '#0082C9',
              }}
            >
              {!hiddenVJournalCollections.has(cal.id) && (
                <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
              )}
            </span>
            <span className={cn('truncate', hiddenVJournalCollections.has(cal.id) && 'text-muted-foreground line-through')}>
              {cal.displayName}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function TaskCollectionSection({
  allCalendars,
  isError,
}: {
  allCalendars: CalendarType[] | undefined;
  isError: boolean;
}) {
  const { hiddenTaskCollections, toggleTaskCollection, showAllTaskCollections, hideAllTaskCollections } =
    useCollectionVisibility();

  const taskCollections = (allCalendars ?? []).filter((cal) =>
    cal.components.includes('VTODO'),
  );

  const allVisible = taskCollections.every((c) => !hiddenTaskCollections.has(c.id));
  const noneVisible =
    taskCollections.length > 0 && taskCollections.every((c) => hiddenTaskCollections.has(c.id));

  return (
    <div className="px-2 py-2">
      <div className="group flex items-center justify-between px-3 mb-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Task Lists
        </p>
        {taskCollections.length > 1 && (
          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={showAllTaskCollections}
              disabled={allVisible}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-default transition-colors"
            >
              All
            </button>
            <span className="text-muted-foreground/40 text-xs">·</span>
            <button
              onClick={() => hideAllTaskCollections(taskCollections.map((c) => c.id))}
              disabled={noneVisible}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-default transition-colors"
            >
              None
            </button>
          </div>
        )}
      </div>

      {isError && (
        <p className="px-3 text-xs text-destructive">Failed to load</p>
      )}

      {/* Skeleton while loading */}
      {allCalendars === undefined && !isError && (
        <div className="px-3 space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-5 rounded bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state per §3.1 — no spinner, no polling */}
      {allCalendars !== undefined && taskCollections.length === 0 && (
        <p className="px-3 text-xs text-muted-foreground">No collections available</p>
      )}

      {taskCollections.map((cal) => (
        <label
          key={cal.id}
          className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm cursor-pointer hover:bg-muted transition-colors"
        >
          <input
            type="checkbox"
            className="sr-only"
            checked={!hiddenTaskCollections.has(cal.id)}
            onChange={() => toggleTaskCollection(cal.id)}
          />
          <span
            className="w-4 h-4 rounded shrink-0 border-2 flex items-center justify-center transition-colors"
            style={{
              backgroundColor: hiddenTaskCollections.has(cal.id) ? 'transparent' : (cal.color || '#0082C9'),
              borderColor: cal.color || '#0082C9',
            }}
          >
            {!hiddenTaskCollections.has(cal.id) && (
              <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
            )}
          </span>
          <span className={cn('truncate', hiddenTaskCollections.has(cal.id) && 'text-muted-foreground line-through')}>
            {cal.displayName}
          </span>
        </label>
      ))}
    </div>
  );
}

function CollectionSection({
  title,
  kind,
  items,
  isError,
  defaultColor,
}: {
  title: string;
  kind: 'addressbook' | 'calendar';
  items: (AddressBook | CalendarType)[] | undefined;
  isError: boolean;
  defaultColor: string;
}) {
  const {
    hiddenAddressBooks, hiddenCalendars, hiddenCalendarTasks,
    toggleAddressBook, toggleCalendar, toggleCalendarTasks,
    showAllAddressBooks, hideAllAddressBooks,
    showAllCalendars, hideAllCalendars,
  } = useCollectionVisibility();

  const { dragging } = useContactDrag();
  const isDraggingContact = kind === 'addressbook' && dragging !== null;
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<AddressBook | CalendarType | null>(null);

  const hidden = kind === 'addressbook' ? hiddenAddressBooks : hiddenCalendars;
  const toggle = kind === 'addressbook' ? toggleAddressBook : toggleCalendar;
  const showAll = kind === 'addressbook' ? showAllAddressBooks : showAllCalendars;
  const hideAll = kind === 'addressbook'
    ? () => hideAllAddressBooks((items ?? []).map((i) => i.id))
    : () => hideAllCalendars((items ?? []).map((i) => i.id));

  const allVisible = (items ?? []).every((i) => !hidden.has(i.id));
  const noneVisible = (items ?? []).length > 0 && (items ?? []).every((i) => hidden.has(i.id));

  return (
    <div className="px-2 py-2">
      {/* Section header */}
      <div className="group flex items-center justify-between px-3 mb-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
        {items && items.length > 1 && (
          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={showAll}
              disabled={allVisible}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-default transition-colors"
            >
              All
            </button>
            <span className="text-muted-foreground/40 text-xs">·</span>
            <button
              onClick={hideAll}
              disabled={noneVisible}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-default transition-colors"
            >
              None
            </button>
          </div>
        )}
      </div>

      {isError && (
        <p className="px-3 text-xs text-destructive">Failed to load</p>
      )}
      {items === undefined && !isError && (
        <div className="px-3 space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-5 rounded bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {items?.map((item) => {
        const isSameAb = isDraggingContact && dragging!.contact.addressBookId === item.id;
        const isOver = dropTargetId === item.id;
        const supportsTasks =
          kind === 'calendar' && (item as CalendarType).components?.includes('VTODO');

        return (
          <Fragment key={item.id}>
          <div
            onDragOver={isDraggingContact && !isSameAb ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTargetId(item.id); } : undefined}
            onDragLeave={isDraggingContact ? () => setDropTargetId(null) : undefined}
            onDrop={isDraggingContact && !isSameAb ? (e) => { e.preventDefault(); setDropTargetId(null); dragging!.onMove(item.id); } : undefined}
            className={cn(
              'group/item flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
              isOver
                ? 'bg-primary/15 ring-1 ring-primary/40'
                : isDraggingContact && !isSameAb
                  ? 'hover:bg-primary/10'
                  : 'hover:bg-muted',
              isSameAb && isDraggingContact && 'opacity-40',
            )}
          >
            {/* Checkbox label occupies all available space */}
            <label className="flex flex-1 items-center gap-2 cursor-pointer min-w-0">
              <input
                type="checkbox"
                className="sr-only"
                checked={!hidden.has(item.id)}
                onChange={() => toggle(item.id)}
              />
              <span
                className="w-4 h-4 rounded shrink-0 border-2 flex items-center justify-center transition-colors"
                style={{
                  backgroundColor: hidden.has(item.id) ? 'transparent' : (item.color || defaultColor),
                  borderColor: item.color || defaultColor,
                }}
              >
                {!hidden.has(item.id) && (
                  <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                )}
              </span>
              <span className={cn('truncate', hidden.has(item.id) && 'text-muted-foreground line-through')}>
                {item.displayName}
              </span>
            </label>

            {/* Edit button — visible on row hover */}
            <button
              onClick={() => setEditingItem(item)}
              title={`Edit ${item.displayName}`}
              className="shrink-0 opacity-0 group-hover/item:opacity-100 text-muted-foreground hover:text-foreground transition-all"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>

          {/* Nested Tasks layer toggle — only for VTODO-capable calendars.
              Uses a lighter shade of the calendar color so the tasks layer is
              clearly related to, but distinct from, the calendar's events. */}
          {supportsTasks && (
            <label
              className="flex items-center gap-2 rounded-md pl-9 pr-3 py-1.5 text-sm cursor-pointer hover:bg-muted transition-colors"
              title="Show this calendar's tasks on the Calendar view"
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={!hiddenCalendarTasks.has(item.id)}
                onChange={() => toggleCalendarTasks(item.id)}
              />
              <span
                className="w-4 h-4 rounded shrink-0 border-2 flex items-center justify-center transition-colors"
                style={{
                  backgroundColor: hiddenCalendarTasks.has(item.id) ? 'transparent' : lightenHex(item.color || defaultColor),
                  borderColor: lightenHex(item.color || defaultColor),
                }}
              >
                {!hiddenCalendarTasks.has(item.id) && (
                  <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                )}
              </span>
              <span className={cn('truncate text-muted-foreground', hiddenCalendarTasks.has(item.id) && 'line-through')}>
                Tasks
              </span>
            </label>
          )}
          </Fragment>
        );
      })}

      {/* Edit modals — portaled to body to escape the sidebar's CSS transform containment. */}
      {editingItem && kind === 'addressbook' && createPortal(
        <AddressBookModal
          mode="edit"
          addressBook={editingItem as AddressBook}
          onClose={() => setEditingItem(null)}
        />,
        document.body,
      )}
      {editingItem && kind === 'calendar' && createPortal(
        <CalendarModal
          mode="edit"
          calendar={editingItem as CalendarType}
          onClose={() => setEditingItem(null)}
        />,
        document.body,
      )}
    </div>
  );
}
