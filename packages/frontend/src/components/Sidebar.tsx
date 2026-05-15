import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookUser, Calendar, LogOut, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { getAddressBooks, getCalendars } from '../api/collections';
import { logout } from '../api/auth';
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

  const isLoading = abQuery.isFetching || calQuery.isFetching;

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

      {/* Address books */}
      <CollectionSection
        title="Address Books"
        items={abQuery.data}
        isError={abQuery.isError}
        defaultColor="#6C757D"
      />

      <div className="mx-4 my-1 border-t border-border" />

      {/* Calendars */}
      <CollectionSection
        title="Calendars"
        items={calQuery.data}
        isError={calQuery.isError}
        defaultColor="#0082C9"
      />

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
  items,
  isError,
  defaultColor,
}: {
  title: string;
  items: (AddressBook | CalendarType)[] | undefined;
  isError: boolean;
  defaultColor: string;
}) {
  // Local visibility toggles — persisted client-side only for now (M8 will persist to prefs).
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });

  return (
    <div className="px-2 py-2">
      <p className="px-3 mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
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
      {items?.map((item) => (
        <label
          key={item.id}
          className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm cursor-pointer hover:bg-muted group"
        >
          <input
            type="checkbox"
            className="sr-only"
            checked={!hidden.has(item.id)}
            onChange={() => toggle(item.id)}
          />
          {/* Color swatch doubles as a custom checkbox */}
          <span
            className="w-3 h-3 rounded-sm shrink-0 ring-1 ring-border"
            style={{
              backgroundColor: hidden.has(item.id)
                ? 'transparent'
                : (item.color || defaultColor),
              borderColor: item.color || defaultColor,
            }}
          />
          <span className={cn('truncate', hidden.has(item.id) && 'text-muted-foreground line-through')}>
            {item.displayName}
          </span>
        </label>
      ))}
    </div>
  );
}
