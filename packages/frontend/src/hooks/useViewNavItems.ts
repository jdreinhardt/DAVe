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
  const calQuery = useQuery({
    queryKey: ['calendars'],
    queryFn: getCalendars,
    staleTime: 5 * 60_000,
  });

  const { pathname } = useLocation();

  const calsLoaded = calQuery.data !== undefined;
  const hasVTodo = (calQuery.data ?? []).some((c) => c.components.includes('VTODO'));
  const hasVJournal = (calQuery.data ?? []).some((c) => c.components.includes('VJOURNAL'));

  return VIEW_NAV_ITEMS.filter((item) => {
    if (!calsLoaded) return true;
    if (pathname.startsWith(item.to)) return true;
    if (item.to === '/tasks') return hasVTodo;
    // Notes and Journals share the same VJOURNAL collections.
    if (item.to === '/notes' || item.to === '/journals') return hasVJournal;
    return true;
  });
}
