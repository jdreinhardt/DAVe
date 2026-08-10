import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Calendar } from '@dave/shared';
import { useViewNavItems } from '../hooks/useViewNavItems.js';
import { getCalendars } from '../api/collections.js';

vi.mock('../api/collections.js', () => ({ getCalendars: vi.fn() }));

const getCalendarsMock = vi.mocked(getCalendars);

function calendar(id: string, components: string[]): Calendar {
  return {
    id,
    url: `/cal/${id}/`,
    displayName: id,
    description: '',
    color: '#0082C9',
    ctag: '',
    syncToken: '',
    components,
    timezone: '',
  };
}

function renderNav(pathname: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderHook(() => useViewNavItems(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[pathname]}>{children}</MemoryRouter>
      </QueryClientProvider>
    ),
  });
}

const labels = (items: ReturnType<typeof useViewNavItems>) => items.map((i) => i.label);

describe('useViewNavItems', () => {
  beforeEach(() => {
    getCalendarsMock.mockReset();
  });

  it('shows every view while calendars are still loading', () => {
    getCalendarsMock.mockReturnValue(new Promise(() => {}));
    const { result } = renderNav('/contacts');
    expect(labels(result.current)).toEqual([
      'Contacts',
      'Calendar',
      'Tasks',
      'Notes',
      'Journals',
    ]);
  });

  it('hides Tasks, Notes and Journals when no calendar supports them', async () => {
    getCalendarsMock.mockResolvedValue([calendar('a', ['VEVENT'])]);
    const { result } = renderNav('/contacts');
    await waitFor(() => expect(labels(result.current)).toEqual(['Contacts', 'Calendar']));
  });

  it('shows Notes and Journals but not Tasks when only VJOURNAL is supported', async () => {
    getCalendarsMock.mockResolvedValue([calendar('a', ['VEVENT', 'VJOURNAL'])]);
    const { result } = renderNav('/contacts');
    await waitFor(() =>
      expect(labels(result.current)).toEqual(['Contacts', 'Calendar', 'Notes', 'Journals']),
    );
  });

  it('shows Tasks but not Notes/Journals when only VTODO is supported', async () => {
    getCalendarsMock.mockResolvedValue([calendar('a', ['VEVENT', 'VTODO'])]);
    const { result } = renderNav('/contacts');
    await waitFor(() =>
      expect(labels(result.current)).toEqual(['Contacts', 'Calendar', 'Tasks']),
    );
  });

  // A deep link must never orphan itself: the active view stays listed even when
  // no calendar advertises support for it.
  it('keeps the active view visible when it is unsupported', async () => {
    getCalendarsMock.mockResolvedValue([calendar('a', ['VEVENT'])]);
    const { result } = renderNav('/tasks');
    await waitFor(() =>
      expect(labels(result.current)).toEqual(['Contacts', 'Calendar', 'Tasks']),
    );
  });
});
