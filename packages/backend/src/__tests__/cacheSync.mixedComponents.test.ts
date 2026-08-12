import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/dav.js', () => ({
  listCalendars: vi.fn(),
  fetchAllCalendarObjects: vi.fn(),
  syncCalendarForCache: vi.fn(),
  SyncTokenInvalidError: class SyncTokenInvalidError extends Error {},
}));

import { initialSyncForComponentType } from '../services/cacheSync.js';
import { listCalendars, fetchAllCalendarObjects } from '../lib/dav.js';
import { makeCacheDb, testConfig } from './helpers.js';
import type { CacheDbInstance } from '../db/cache.js';
import type { SessionData } from '../services/session.js';

const session = { username: 'derek', password: 'pw' } as SessionData;
const listMock = vi.mocked(listCalendars);
const objectsMock = vi.mocked(fetchAllCalendarObjects);

// Mirrors the reported server: one collection supporting both component types,
// plus single-type collections that were never affected.
const EVERYTHING = 'http://dav.test/dav.php/cal/derek/everything/';
const TEST_CAL = 'http://dav.test/dav.php/cal/derek/test/';
const DEFAULT_CAL = 'http://dav.test/dav.php/cal/derek/default/';

const CALS = [
  { url: EVERYTHING, syncToken: 't1', components: ['VEVENT', 'VTODO', 'VJOURNAL'] },
  { url: TEST_CAL, syncToken: 't2', components: ['VEVENT', 'VJOURNAL'] },
  { url: DEFAULT_CAL, syncToken: 't3', components: ['VEVENT', 'VTODO'] },
];

function ics(kind: 'VTODO' | 'VJOURNAL', uid: string): string {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:${kind}\r\nUID:${uid}\r\nSUMMARY:${uid}\r\nEND:${kind}\r\nEND:VCALENDAR\r\n`;
}

// Each collection holds objects of whatever types it advertises.
const CONTENT: Record<string, Partial<Record<'VTODO' | 'VJOURNAL', string[]>>> = {
  [EVERYTHING]: { VTODO: ['task-1'], VJOURNAL: ['note-1', 'note-2', 'note-3', 'note-4', 'note-5'] },
  [TEST_CAL]: { VJOURNAL: ['test-note-1'] },
  [DEFAULT_CAL]: { VTODO: ['default-task-1'] },
};

let cacheDb: CacheDbInstance;
beforeEach(() => {
  cacheDb = makeCacheDb();
  listMock.mockReset();
  objectsMock.mockReset();
  listMock.mockResolvedValue(CALS as never);
  objectsMock.mockImplementation(
    async (_s, collectionUrl: string, _c, componentType: 'VTODO' | 'VJOURNAL' = 'VTODO') => {
      const uids = CONTENT[collectionUrl]?.[componentType] ?? [];
      return uids.map((uid) => ({
        url: `${collectionUrl}${uid}.ics`,
        etag: `"${uid}"`,
        rawIcs: ics(componentType, uid),
      })) as never;
    },
  );
});

function cached(componentType: string, collectionUrl: string): number {
  const row = cacheDb
    .prepare(
      'SELECT COUNT(*) c FROM entries WHERE user_id = ? AND component_type = ? AND collection_url = ?',
    )
    .get('derek', componentType, collectionUrl) as { c: number };
  return row.c;
}

describe('a collection supporting both VTODO and VJOURNAL', () => {
  // collection_sync is keyed on (user_id, collection_url) with no component
  // type, so the first component type to sync claimed the collection and the
  // second was skipped forever.
  it('seeds journals even when tasks synced the collection first', async () => {
    await initialSyncForComponentType(session, 'derek', 'VTODO', cacheDb, testConfig);
    expect(cached('VTODO', EVERYTHING)).toBe(1);

    await initialSyncForComponentType(session, 'derek', 'VJOURNAL', cacheDb, testConfig);
    expect(cached('VJOURNAL', EVERYTHING)).toBe(5);
  });

  it('seeds tasks even when journals synced the collection first', async () => {
    await initialSyncForComponentType(session, 'derek', 'VJOURNAL', cacheDb, testConfig);
    expect(cached('VJOURNAL', EVERYTHING)).toBe(5);

    await initialSyncForComponentType(session, 'derek', 'VTODO', cacheDb, testConfig);
    expect(cached('VTODO', EVERYTHING)).toBe(1);
  });

  it('leaves single-type collections working as before', async () => {
    await initialSyncForComponentType(session, 'derek', 'VTODO', cacheDb, testConfig);
    await initialSyncForComponentType(session, 'derek', 'VJOURNAL', cacheDb, testConfig);
    expect(cached('VJOURNAL', TEST_CAL)).toBe(1);
    expect(cached('VTODO', DEFAULT_CAL)).toBe(1);
  });

  it('does not refetch a component type that is already seeded', async () => {
    await initialSyncForComponentType(session, 'derek', 'VJOURNAL', cacheDb, testConfig);
    const callsAfterFirst = objectsMock.mock.calls.length;
    await initialSyncForComponentType(session, 'derek', 'VJOURNAL', cacheDb, testConfig);
    expect(objectsMock.mock.calls.length).toBe(callsAfterFirst);
  });
});
