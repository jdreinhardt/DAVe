import { describe, it, expect, beforeEach } from 'vitest';
import { makeCacheDb } from './helpers.js';
import type { CacheDbInstance } from '../db/cache.js';

let db: CacheDbInstance;

beforeEach(() => {
  db = makeCacheDb();
});

describe('cache schema', () => {
  it('creates the entries table with the expected columns', () => {
    const cols = (
      db.prepare("PRAGMA table_info('entries')").all() as Array<{ name: string }>
    ).map((r) => r.name);

    const required = [
      'id', 'user_id', 'collection_url', 'object_url', 'component_type',
      'uid', 'etag', 'summary', 'description', 'status', 'priority',
      'dtstart', 'due', 'completed', 'percent_complete', 'dtstart_present',
      'raw_ics', 'last_synced_at',
    ];
    for (const col of required) {
      expect(cols, `missing column: ${col}`).toContain(col);
    }
  });

  it('creates the entry_categories table', () => {
    const cols = (
      db.prepare("PRAGMA table_info('entry_categories')").all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(cols).toContain('entry_id');
    expect(cols).toContain('category');
  });

  it('creates the entry_relations table', () => {
    const cols = (
      db.prepare("PRAGMA table_info('entry_relations')").all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(cols).toContain('entry_id');
    expect(cols).toContain('related_uid');
    expect(cols).toContain('reltype');
  });

  it('creates the collection_sync table', () => {
    const cols = (
      db.prepare("PRAGMA table_info('collection_sync')").all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(cols).toContain('user_id');
    expect(cols).toContain('collection_url');
    expect(cols).toContain('sync_token');
    expect(cols).toContain('last_synced_at');
  });

  it('creates the entries_fts virtual table', () => {
    // Inserting into the FTS table via the trigger proves both exist.
    db.prepare(`
      INSERT INTO entries
        (user_id, collection_url, object_url, component_type, uid, etag,
         summary, description, dtstart_present, raw_ics, last_synced_at)
      VALUES ('u1', 'http://x/cal/', 'http://x/cal/a.ics', 'VTODO', 'uid-1', '"e1"',
              'Buy milk', 'at the store', 0, 'BEGIN:VCALENDAR', 0)
    `).run();

    const rows = db
      .prepare("SELECT rowid FROM entries_fts WHERE summary MATCH 'milk'")
      .all() as Array<{ rowid: number }>;
    expect(rows.length).toBe(1);
  });

  it('FTS index stays in sync after update', () => {
    db.prepare(`
      INSERT INTO entries
        (user_id, collection_url, object_url, component_type, uid, etag,
         summary, description, dtstart_present, raw_ics, last_synced_at)
      VALUES ('u1', 'http://x/cal/', 'http://x/cal/b.ics', 'VTODO', 'uid-2', '"e2"',
              'Original title', '', 0, 'BEGIN:VCALENDAR', 0)
    `).run();

    db.prepare("UPDATE entries SET summary = 'Updated title' WHERE uid = 'uid-2'").run();

    const oldRows = db
      .prepare("SELECT rowid FROM entries_fts WHERE summary MATCH 'Original'")
      .all();
    expect(oldRows.length).toBe(0);

    const newRows = db
      .prepare("SELECT rowid FROM entries_fts WHERE summary MATCH 'Updated'")
      .all();
    expect(newRows.length).toBe(1);
  });

  it('FTS index is cleaned up on delete', () => {
    db.prepare(`
      INSERT INTO entries
        (user_id, collection_url, object_url, component_type, uid, etag,
         summary, description, dtstart_present, raw_ics, last_synced_at)
      VALUES ('u1', 'http://x/cal/', 'http://x/cal/c.ics', 'VTODO', 'uid-3', '"e3"',
              'Will be deleted', '', 0, 'BEGIN:VCALENDAR', 0)
    `).run();

    db.prepare("DELETE FROM entries WHERE uid = 'uid-3'").run();

    const rows = db
      .prepare("SELECT rowid FROM entries_fts WHERE summary MATCH 'deleted'")
      .all();
    expect(rows.length).toBe(0);
  });

  it('enforces unique (uid, user_id) constraint', () => {
    const insert = () =>
      db.prepare(`
        INSERT INTO entries
          (user_id, collection_url, object_url, component_type, uid, etag,
           summary, description, dtstart_present, raw_ics, last_synced_at)
        VALUES ('u1', 'http://x/', 'http://x/d.ics', 'VTODO', 'dup-uid', '"e"',
                '', '', 0, '', 0)
      `).run();

    insert();
    expect(insert).toThrow();
  });
});
