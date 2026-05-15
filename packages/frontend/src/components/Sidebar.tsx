import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookUser, Calendar, Check, LogOut, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { getAddressBooks, getCalendars } from '../api/collections';
import { logout } from '../api/auth';
import { useCollectionVisibility } from '../contexts/CollectionVisibility';
import { useContactDrag } from '../contexts/ContactDrag';
import type { AddressBook, Calendar as CalendarType } from '@dave/shared';
import type { MeResponse } from '@dave/shared';

interface SidebarProps {
  me: MeResponse;
}

export default function Sidebar({ me }: SidebarProps) {
  const queryClient = useQueryClient();

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
  const isLoading = (inContacts ? abQuery.isFetching : false) || (inCalendar ? calQuery.isFetching : false);

  return (
    <aside className="flex flex-col w-64 shrink-0 border-r border-border bg-card h-full overflow-y-auto">
      {/* App name + sync indicator */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="font-semibold text-foreground">DAVe</span>
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

      {/* Footer: logged-in user + logout */}
      <div className="mt-auto border-t border-border px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground truncate">{me.displayName || me.username}</span>
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
    </aside>
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
    hiddenAddressBooks, hiddenCalendars,
    toggleAddressBook, toggleCalendar,
    showAllAddressBooks, hideAllAddressBooks,
    showAllCalendars, hideAllCalendars,
  } = useCollectionVisibility();

  const { dragging } = useContactDrag();
  const isDraggingContact = kind === 'addressbook' && dragging !== null;
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

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

        return (
          <label
            key={item.id}
            onDragOver={isDraggingContact && !isSameAb ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTargetId(item.id); } : undefined}
            onDragLeave={isDraggingContact ? () => setDropTargetId(null) : undefined}
            onDrop={isDraggingContact && !isSameAb ? (e) => { e.preventDefault(); setDropTargetId(null); dragging!.onMove(item.id); } : undefined}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm cursor-pointer group transition-colors',
              isOver
                ? 'bg-primary/15 ring-1 ring-primary/40'
                : isDraggingContact && !isSameAb
                  ? 'hover:bg-primary/10'
                  : 'hover:bg-muted',
              isSameAb && isDraggingContact && 'opacity-40',
            )}
          >
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
        );
      })}
    </div>
  );
}
