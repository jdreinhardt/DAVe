import { describe, it, expect, beforeEach } from 'vitest';
import { makeCacheDb } from './helpers.js';
import type { CacheDbInstance } from '../db/cache.js';
import {
  upsertEntry,
  evictOldCompleted,
  upsertCollectionSync,
  getCollectionSync,
  countEntriesForUser,
  deleteEntryByUid,
  deleteEntryByObjectUrl,
} from '../db/cacheOps.js';
import type { ParsedEntry } from '../lib/entryParser.js';

const COL_URL = 'http://dav.test/dav.php/calendars/alice/tasks/';
const USER = 'alice';

function makeEntry(overrides: Partial<ParsedEntry> = {}): ParsedEntry {
  return {
    userId: USER,
    collectionUrl: COL_URL,
    objectUrl: `${COL_URL}${overrides.uid ?? 'uid-1'}.ics`,
    componentType: 'VTODO',
    uid: 'uid-1',
    etag: '"etag1"',
    summary: 'Test task',
    description: '',
    status: null,
    priority: null,
    dtstart: null,
    due: null,
    completed: null,
    percentComplete: null,
    dtstart_present: false,
    lastModified: null,
    rawIcs: 'BEGIN:VCALENDAR\nEND:VCALENDAR',
    categories: [],
    relations: [],
    lastSyncedAt: Date.now(),
    ...overrides,
  };
}

let db: CacheDbInstance;

beforeEach(() => {
  db = makeCacheDb();
});

describe('upsertEntry', () => {
  it('inserts a new entry and returns its id', () => {
    const id = upsertEntry(db, makeEntry());
    expect(id).toBeGreaterThan(0);
  });

  it('updates an existing entry on uid+user_id conflict', () => {
    upsertEntry(db, makeEntry({ summary: 'Original' }));
    upsertEntry(db, makeEntry({ summary: 'Updated', etag: '"etag2"' }));

    const row = db
      .prepare('SELECT summary, etag FROM entries WHERE uid = ? AND user_id = ?')
      .get('uid-1', USER) as { summary: string; etag: string };
    expect(row.summary).toBe('Updated');
    expect(row.etag).toBe('"etag2"');
  });

  it('replaces categories on upsert', () => {
    upsertEntry(db, makeEntry({ categories: ['work', 'urgent'] }));
    upsertEntry(db, makeEntry({ categories: ['personal'] }));

    const rows = db
      .prepare('SELECT category FROM entry_categories WHERE entry_id = (SELECT id FROM entries WHERE uid = ?)')
      .all('uid-1') as Array<{ category: string }>;
    const cats = rows.map((r) => r.category);
    expect(cats).toEqual(['personal']);
  });

  it('replaces relations on upsert', () => {
    upsertEntry(db, makeEntry({ relations: [{ relatedUid: 'parent-1', reltype: 'PARENT' }] }));
    upsertEntry(db, makeEntry({ relations: [] }));

    const rows = db
      .prepare('SELECT related_uid FROM entry_relations WHERE entry_id = (SELECT id FROM entries WHERE uid = ?)')
      .all('uid-1') as Array<{ related_uid: string }>;
    expect(rows.length).toBe(0);
  });
});

describe('evictOldCompleted', () => {
  it('removes VTODO entries with STATUS=COMPLETED older than retentionDays', () => {
    const retentionDays = 7;
    const old = Date.now() - (retentionDays + 1) * 24 * 60 * 60 * 1000;

    upsertEntry(db, makeEntry({
      uid: 'old-done',
      objectUrl: `${COL_URL}old-done.ics`,
      status: 'COMPLETED',
      completed: old,
    }));

    const evicted = evictOldCompleted(db, USER, retentionDays);
    expect(evicted).toBe(1);

    const row = db.prepare('SELECT id FROM entries WHERE uid = ?').get('old-done');
    expect(row).toBeUndefined();
  });

  it('keeps COMPLETED entries within the retention window', () => {
    const retentionDays = 7;
    const recent = Date.now() - 2 * 24 * 60 * 60 * 1000; // 2 days ago

    upsertEntry(db, makeEntry({
      uid: 'recent-done',
      objectUrl: `${COL_URL}recent-done.ics`,
      status: 'COMPLETED',
      completed: recent,
    }));

    const evicted = evictOldCompleted(db, USER, retentionDays);
    expect(evicted).toBe(0);
  });

  it('does not evict non-VTODO entries', () => {
    const old = Date.now() - 30 * 24 * 60 * 60 * 1000;

    upsertEntry(db, makeEntry({
      uid: 'old-journal',
      objectUrl: `${COL_URL}old-journal.ics`,
      componentType: 'VJOURNAL',
      status: 'COMPLETED',
      completed: old,
    }));

    const evicted = evictOldCompleted(db, USER, 7);
    expect(evicted).toBe(0);
  });

  it('does not evict entries belonging to a different user', () => {
    const old = Date.now() - 30 * 24 * 60 * 60 * 1000;

    upsertEntry(db, makeEntry({
      userId: 'bob',
      uid: 'bob-done',
      objectUrl: `${COL_URL}bob-done.ics`,
      status: 'COMPLETED',
      completed: old,
    }));

    const evicted = evictOldCompleted(db, USER, 7);
    expect(evicted).toBe(0);
  });
});

describe('deleteEntryByUid', () => {
  it('removes the entry and its child rows via cascade', () => {
    upsertEntry(db, makeEntry({ categories: ['tag1'], relations: [{ relatedUid: 'p', reltype: 'PARENT' }] }));
    deleteEntryByUid(db, 'uid-1', USER);

    const row = db.prepare('SELECT id FROM entries WHERE uid = ?').get('uid-1');
    expect(row).toBeUndefined();
  });

  it('is a no-op for unknown uid', () => {
    expect(() => deleteEntryByUid(db, 'ghost', USER)).not.toThrow();
  });
});

describe('deleteEntryByObjectUrl', () => {
  it('removes by object URL', () => {
    const url = `${COL_URL}uid-1.ics`;
    upsertEntry(db, makeEntry({ uid: 'uid-del', objectUrl: url }));
    deleteEntryByObjectUrl(db, url, USER);
    const row = db.prepare('SELECT id FROM entries WHERE uid = ?').get('uid-del');
    expect(row).toBeUndefined();
  });
});

describe('collection_sync helpers', () => {
  it('upserts and retrieves sync state', () => {
    upsertCollectionSync(db, USER, COL_URL, 'token-1');
    const state = getCollectionSync(db, USER, COL_URL);
    expect(state).not.toBeNull();
    expect(state!.syncToken).toBe('token-1');
  });

  it('updates the sync token on second upsert', () => {
    upsertCollectionSync(db, USER, COL_URL, 'token-1');
    upsertCollectionSync(db, USER, COL_URL, 'token-2');
    expect(getCollectionSync(db, USER, COL_URL)!.syncToken).toBe('token-2');
  });

  it('returns null for unknown collection', () => {
    expect(getCollectionSync(db, USER, 'http://unknown/')).toBeNull();
  });
});

describe('countEntriesForUser', () => {
  it('counts only entries for the specified user', () => {
    upsertEntry(db, makeEntry({ uid: 'a', objectUrl: `${COL_URL}a.ics` }));
    upsertEntry(db, makeEntry({ uid: 'b', objectUrl: `${COL_URL}b.ics` }));
    upsertEntry(db, makeEntry({ uid: 'c', objectUrl: `${COL_URL}c.ics`, userId: 'bob' }));

    expect(countEntriesForUser(db, USER)).toBe(2);
    expect(countEntriesForUser(db, 'bob')).toBe(1);
  });
});
