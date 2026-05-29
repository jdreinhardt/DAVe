import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { Config } from '../config.js';

// Load node:sqlite via createRequire so bundlers preserve the "node:" prefix
// in the string literal instead of stripping it from the import statement.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

// Export the instance type so callers can annotate variables without importing
// from node:sqlite directly (those imports are type-erased at runtime, but
// explicitly centralising keeps things tidy).
export type DbInstance = InstanceType<typeof DatabaseSyncType>;

let _db: DbInstance | null = null;

export function getDb(config: Config): DbInstance {
  if (_db) return _db;

  fs.mkdirSync(config.DATA_DIR, { recursive: true });
  const dbPath = path.join(config.DATA_DIR, 'sessions.sqlite');

  _db = new DatabaseSync(dbPath);
  _db.exec('PRAGMA journal_mode = WAL');
  _db.exec('PRAGMA foreign_keys = ON');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id               TEXT    PRIMARY KEY,
      data             TEXT    NOT NULL,
      created_at       INTEGER NOT NULL,
      last_activity_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_last_activity
      ON sessions(last_activity_at);

    CREATE TABLE IF NOT EXISTS user_settings (
      username         TEXT    PRIMARY KEY,
      contact_sort_by  TEXT    NOT NULL DEFAULT 'last',
      contact_sort_dir TEXT    NOT NULL DEFAULT 'asc',
      contact_subtitle TEXT    NOT NULL DEFAULT '',
      map_service      TEXT    NOT NULL DEFAULT 'osm',
      dark_mode        TEXT    NOT NULL DEFAULT 'system',
      task_layout      TEXT    NOT NULL DEFAULT 'list',
      notes_view       TEXT    NOT NULL DEFAULT 'list',
      journals_view    TEXT    NOT NULL DEFAULT 'timeline',
      updated_at       INTEGER NOT NULL DEFAULT 0
    );
  `);

  return _db;
}
