import type { CacheDbInstance } from './cache.js';
import type { ParsedEntry } from '../lib/entryParser.js';

interface EntryRow {
  id: number;
}

export function upsertEntry(cacheDb: CacheDbInstance, entry: ParsedEntry): number {
  cacheDb.prepare(`
    INSERT INTO entries
      (user_id, collection_url, object_url, component_type, uid, etag,
       summary, description, status, priority, dtstart, due, completed,
       percent_complete, dtstart_present, raw_ics, last_synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uid, user_id) DO UPDATE SET
      collection_url   = excluded.collection_url,
      object_url       = excluded.object_url,
      component_type   = excluded.component_type,
      etag             = excluded.etag,
      summary          = excluded.summary,
      description      = excluded.description,
      status           = excluded.status,
      priority         = excluded.priority,
      dtstart          = excluded.dtstart,
      due              = excluded.due,
      completed        = excluded.completed,
      percent_complete = excluded.percent_complete,
      dtstart_present  = excluded.dtstart_present,
      raw_ics          = excluded.raw_ics,
      last_synced_at   = excluded.last_synced_at
  `).run(
    entry.userId,
    entry.collectionUrl,
    entry.objectUrl,
    entry.componentType,
    entry.uid,
    entry.etag,
    entry.summary,
    entry.description,
    entry.status,
    entry.priority,
    entry.dtstart,
    entry.due,
    entry.completed,
    entry.percentComplete,
    entry.dtstart_present ? 1 : 0,
    entry.rawIcs,
    entry.lastSyncedAt,
  );

  const row = cacheDb.prepare(
    'SELECT id FROM entries WHERE uid = ? AND user_id = ?',
  ).get(entry.uid, entry.userId) as EntryRow | undefined;

  if (!row) throw new Error(`Cache upsert failed for uid=${entry.uid}`);
  const entryId = row.id;

  cacheDb.prepare('DELETE FROM entry_categories WHERE entry_id = ?').run(entryId);
  for (const cat of entry.categories) {
    cacheDb.prepare(
      'INSERT OR IGNORE INTO entry_categories (entry_id, category) VALUES (?, ?)',
    ).run(entryId, cat);
  }

  cacheDb.prepare('DELETE FROM entry_relations WHERE entry_id = ?').run(entryId);
  for (const rel of entry.relations) {
    cacheDb.prepare(
      'INSERT OR IGNORE INTO entry_relations (entry_id, related_uid, reltype) VALUES (?, ?, ?)',
    ).run(entryId, rel.relatedUid, rel.reltype);
  }

  return entryId;
}

export function deleteEntryByUid(cacheDb: CacheDbInstance, uid: string, userId: string): void {
  cacheDb.prepare('DELETE FROM entries WHERE uid = ? AND user_id = ?').run(uid, userId);
}

export function deleteEntryByObjectUrl(
  cacheDb: CacheDbInstance,
  objectUrl: string,
  userId: string,
): void {
  cacheDb.prepare('DELETE FROM entries WHERE object_url = ? AND user_id = ?').run(objectUrl, userId);
}

/**
 * Evict completed VTODO entries whose COMPLETED timestamp is older than retentionDays.
 * They remain on Baikal; this is a cache-only eviction.
 */
export function evictOldCompleted(
  cacheDb: CacheDbInstance,
  userId: string,
  retentionDays: number,
): number {
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = cacheDb.prepare(`
    DELETE FROM entries
    WHERE user_id = ?
      AND component_type = 'VTODO'
      AND status = 'COMPLETED'
      AND completed IS NOT NULL
      AND completed < ?
  `).run(userId, cutoffMs) as { changes: number };
  return result.changes;
}

export function upsertCollectionSync(
  cacheDb: CacheDbInstance,
  userId: string,
  collectionUrl: string,
  syncToken: string,
): void {
  cacheDb.prepare(`
    INSERT INTO collection_sync (user_id, collection_url, sync_token, last_synced_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, collection_url) DO UPDATE SET
      sync_token     = excluded.sync_token,
      last_synced_at = excluded.last_synced_at
  `).run(userId, collectionUrl, syncToken, Date.now());
}

export interface CollectionSyncState {
  syncToken: string;
  lastSyncedAt: number;
}

export function getCollectionSync(
  cacheDb: CacheDbInstance,
  userId: string,
  collectionUrl: string,
): CollectionSyncState | null {
  const row = cacheDb.prepare(
    'SELECT sync_token, last_synced_at FROM collection_sync WHERE user_id = ? AND collection_url = ?',
  ).get(userId, collectionUrl) as { sync_token: string; last_synced_at: number } | undefined;
  if (!row) return null;
  return { syncToken: row.sync_token, lastSyncedAt: row.last_synced_at };
}

export function countEntriesForUser(cacheDb: CacheDbInstance, userId: string): number {
  const row = cacheDb.prepare(
    'SELECT COUNT(*) as n FROM entries WHERE user_id = ?',
  ).get(userId) as { n: number };
  return row.n;
}
