import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { Config } from '../config.js';
import { cacheDbPath } from '../config.js';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

export type CacheDbInstance = InstanceType<typeof DatabaseSyncType>;

let _cacheDb: CacheDbInstance | null = null;

export function getCacheDb(config: Config): CacheDbInstance {
  if (_cacheDb) return _cacheDb;

  const dbPath = cacheDbPath(config);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  _cacheDb = new DatabaseSync(dbPath);
  applySchema(_cacheDb);
  return _cacheDb;
}

/** Apply the cache schema to any DatabaseSync instance (used in tests). */
export function applySchema(db: CacheDbInstance): void {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id               INTEGER PRIMARY KEY,
      user_id          TEXT    NOT NULL,
      collection_url   TEXT    NOT NULL,
      object_url       TEXT    NOT NULL,
      component_type   TEXT    NOT NULL,
      uid              TEXT    NOT NULL,
      etag             TEXT    NOT NULL,
      summary          TEXT    NOT NULL DEFAULT '',
      description      TEXT    NOT NULL DEFAULT '',
      status           TEXT,
      priority         INTEGER,
      dtstart          INTEGER,
      due              INTEGER,
      completed        INTEGER,
      percent_complete INTEGER,
      dtstart_present  INTEGER NOT NULL DEFAULT 0,
      raw_ics          TEXT    NOT NULL,
      last_synced_at   INTEGER NOT NULL,
      UNIQUE(uid, user_id),
      UNIQUE(object_url, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_entries_user_type_status
      ON entries(user_id, component_type, status);
    CREATE INDEX IF NOT EXISTS idx_entries_user_due
      ON entries(user_id, due);
    CREATE INDEX IF NOT EXISTS idx_entries_user_type_dtstart
      ON entries(user_id, component_type, dtstart_present, dtstart);

    CREATE TABLE IF NOT EXISTS entry_categories (
      entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      category TEXT    NOT NULL,
      PRIMARY KEY(entry_id, category)
    );
    CREATE INDEX IF NOT EXISTS idx_entry_categories_entry
      ON entry_categories(entry_id);

    CREATE TABLE IF NOT EXISTS entry_relations (
      entry_id    INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      related_uid TEXT    NOT NULL,
      reltype     TEXT    NOT NULL,
      PRIMARY KEY(entry_id, related_uid, reltype)
    );
    CREATE INDEX IF NOT EXISTS idx_entry_relations_entry
      ON entry_relations(entry_id);

    CREATE TABLE IF NOT EXISTS collection_sync (
      user_id        TEXT    NOT NULL,
      collection_url TEXT    NOT NULL,
      sync_token     TEXT    NOT NULL,
      last_synced_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, collection_url)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
      summary,
      description,
      content=entries,
      content_rowid=id
    );

    CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
      INSERT INTO entries_fts(rowid, summary, description)
        VALUES (new.id, new.summary, new.description);
    END;

    CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
      INSERT INTO entries_fts(entries_fts, rowid, summary, description)
        VALUES ('delete', old.id, old.summary, old.description);
    END;

    CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
      INSERT INTO entries_fts(entries_fts, rowid, summary, description)
        VALUES ('delete', old.id, old.summary, old.description);
      INSERT INTO entries_fts(rowid, summary, description)
        VALUES (new.id, new.summary, new.description);
    END;
  `);
}
