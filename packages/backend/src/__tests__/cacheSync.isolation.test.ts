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

const session = { username: 'alice', password: 'pw' } as SessionData;
const listMock = vi.mocked(listCalendars);
const objectsMock = vi.mocked(fetchAllCalendarObjects);

const CALS = ['a', 'b', 'c'].map((n) => ({
  url: `http://dav.test/dav.php/cal/alice/${n}/`,
  syncToken: 'tok',
  components: ['VJOURNAL'],
}));

function vjournal(uid: string): string {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VJOURNAL\r\nUID:${uid}\r\nSUMMARY:note-${uid}\r\nEND:VJOURNAL\r\nEND:VCALENDAR\r\n`;
}

let cacheDb: CacheDbInstance;
beforeEach(() => {
  cacheDb = makeCacheDb();
  listMock.mockReset();
  objectsMock.mockReset();
  listMock.mockResolvedValue(CALS as never);
});

function syncedCollections(): string[] {
  return (cacheDb.prepare('SELECT collection_url FROM collection_sync').all() as unknown as {
    collection_url: string;
  }[]).map((r) => r.collection_url);
}

describe('initialSyncForComponentType isolates per-collection failures', () => {
  it('seeds the remaining collections when one is unreachable', async () => {
    // The middle collection fails; a and c must still be seeded.
    objectsMock.mockImplementation(async (_s, collectionUrl: string) => {
      if (collectionUrl === CALS[1]!.url) throw new Error('collection unreachable');
      return [{ url: `${collectionUrl}n.ics`, etag: '"e"', rawIcs: vjournal('u-' + collectionUrl) }] as never;
    });

    await initialSyncForComponentType(session, 'alice', 'VJOURNAL', cacheDb, testConfig);

    expect(syncedCollections().sort()).toEqual([CALS[0]!.url, CALS[2]!.url].sort());
    const notes = cacheDb.prepare('SELECT COUNT(*) c FROM entries').get() as { c: number };
    expect(notes.c).toBe(2);
  });

  it('does not record a sync token for the failed collection, so it retries', async () => {
    objectsMock.mockRejectedValueOnce(new Error('transient'))
      .mockImplementation(async (_s, collectionUrl: string) =>
        [{ url: `${collectionUrl}n.ics`, etag: '"e"', rawIcs: vjournal('u1') }] as never);

    await initialSyncForComponentType(session, 'alice', 'VJOURNAL', cacheDb, testConfig);
    const afterFirst = syncedCollections();
    expect(afterFirst).not.toContain(CALS[0]!.url);

    // Second pass: the previously failed collection is retried and succeeds.
    await initialSyncForComponentType(session, 'alice', 'VJOURNAL', cacheDb, testConfig);
    expect(syncedCollections()).toContain(CALS[0]!.url);
  });

  it('still seeds everything when no collection fails', async () => {
    objectsMock.mockImplementation(async (_s, collectionUrl: string) =>
      [{ url: `${collectionUrl}n.ics`, etag: '"e"', rawIcs: vjournal('u-' + collectionUrl) }] as never);

    await initialSyncForComponentType(session, 'alice', 'VJOURNAL', cacheDb, testConfig);
    expect(syncedCollections()).toHaveLength(3);
  });
});
