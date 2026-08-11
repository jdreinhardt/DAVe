import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookUser, Calendar, CheckSquare, NotebookPen, ScrollText } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getCalendars } from '../api/collections';

export interface ViewNavItem {
  to: string;
  label: string;
  Icon: LucideIcon;
}

// Single source of truth for the app's top-level views: route, label and icon.
// The icon is the component itself, not an element, so each nav picks its own size.
export const VIEW_NAV_ITEMS: ViewNavItem[] = [
  { to: '/contacts', label: 'Contacts', Icon: BookUser },
  { to: '/calendar', label: 'Calendar', Icon: Calendar },
  { to: '/tasks', label: 'Tasks', Icon: CheckSquare },
  { to: '/notes', label: 'Notes', Icon: NotebookPen },
  { to: '/journals', label: 'Journals', Icon: ScrollText },
];

export interface ViewCapabilities {
  /** False while the calendars query is still in flight. */
  calsLoaded: boolean;
  hasVTodo: boolean;
  hasVJournal: boolean;
}

/**
 * Which optional components the account's calendars advertise. Callers use this
 * to decide whether Tasks / Notes / Journals are reachable at all.
 */
export function useViewCapabilities(): ViewCapabilities {
  const calQuery = useQuery({
    queryKey: ['calendars'],
    queryFn: getCalendars,
    staleTime: 5 * 60_000,
  });

  return {
    calsLoaded: calQuery.data !== undefined,
    hasVTodo: (calQuery.data ?? []).some((c) => c.components.includes('VTODO')),
    hasVJournal: (calQuery.data ?? []).some((c) => c.components.includes('VJOURNAL')),
  };
}

/** True when `to` (a VIEW_NAV_ITEMS route) is backed by a supporting collection. */
export function isViewSupported(to: string, caps: ViewCapabilities): boolean {
  if (to === '/tasks') return caps.hasVTodo;
  // Notes and Journals share the same VJOURNAL collections.
  if (to === '/notes' || to === '/journals') return caps.hasVJournal;
  return true;
}

/**
 * The views to show right now. Shared by the desktop sidebar and the mobile
 * bottom bar so the two can never disagree.
 *
 * Hide the Tasks / Notes / Journals entries when no calendar advertises support for
 * their component. The active view stays visible even when unsupported, so a manual
 * deep-link still shows the entry (and its in-view "no collections" notice) and only
 * disappears once you navigate away. While calendars are still loading we show
 * everything to avoid a flicker for the common case where support does exist.
 */
export function useViewNavItems(): ViewNavItem[] {
  const caps = useViewCapabilities();
  const { calsLoaded } = caps;

  const { pathname } = useLocation();

  return VIEW_NAV_ITEMS.filter((item) => {
    if (!calsLoaded) return true;
    if (pathname.startsWith(item.to)) return true;
    return isViewSupported(item.to, caps);
  });
}
