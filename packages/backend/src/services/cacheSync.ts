import type { CacheDbInstance } from '../db/cache.js';
import type { Config } from '../config.js';
import type { SessionData } from './session.js';
import {
  fetchAllCalendarObjects,
  syncCalendarForCache,
  listCalendars,
} from '../lib/dav.js';
import { parseEntry } from '../lib/entryParser.js';
import {
  upsertEntry,
  deleteEntryByObjectUrl,
  upsertCollectionSync,
  getCollectionSync,
  countEntriesForUser,
  evictOldCompleted,
} from '../db/cacheOps.js';

interface CollectionSyncRow {
  collection_url: string;
  sync_token: string;
}

type Logger = {
  info: (obj: object | string, msg?: string) => void;
  debug: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
};

/**
 * Full sync for one calendar collection.
 * Fetches all objects and populates the cache from scratch.
 * The syncToken to record must be fetched by the caller (from listCalendars)
 * before this is called; this function just stores it as the starting-point
 * for future incremental syncs.
 */
export async function initialSyncCollection(
  session: SessionData,
  collectionUrl: string,
  syncToken: string,
  userId: string,
  cacheDb: CacheDbInstance,
  config: Config,
  logger?: Logger,
  componentType: 'VTODO' | 'VJOURNAL' = 'VTODO',
): Promise<void> {
  const objects = await fetchAllCalendarObjects(session, collectionUrl, config, componentType);

  const cap = config.MAX_CACHED_ENTRIES_PER_USER;
  const existing = countEntriesForUser(cacheDb, userId);
  let remaining = cap - existing;

  let count = 0;
  for (const { url, etag, rawIcs } of objects) {
    if (remaining <= 0) {
      logger?.warn({ userId, cap }, 'MAX_CACHED_ENTRIES_PER_USER reached; stopping initial sync');
      break;
    }
    const entry = parseEntry(rawIcs, url, collectionUrl, userId, etag);
    if (entry) {
      upsertEntry(cacheDb, entry);
      count++;
      remaining--;
    }
  }

  upsertCollectionSync(cacheDb, userId, collectionUrl, syncToken);
  logger?.debug({ collectionUrl, count }, 'Initial collection sync complete');
}

/**
 * Incremental sync for one calendar collection via sync-collection REPORT.
 * Returns the new sync token.
 */
export async function incrementalSyncCollection(
  session: SessionData,
  collectionUrl: string,
  userId: string,
  syncToken: string,
  cacheDb: CacheDbInstance,
  config: Config,
  logger?: Logger,
): Promise<string> {
  const { syncToken: newToken, changed, deleted } = await syncCalendarForCache(
    session,
    collectionUrl,
    syncToken,
    config,
  );

  for (const { url, etag, rawIcs } of changed) {
    const entry = parseEntry(rawIcs, url, collectionUrl, userId, etag);
    if (entry) {
      upsertEntry(cacheDb, entry);
    }
  }

  for (const deletedUrl of deleted) {
    deleteEntryByObjectUrl(cacheDb, deletedUrl, userId);
  }

  if (changed.length > 0 || deleted.length > 0) {
    logger?.debug({ collectionUrl, changed: changed.length, deleted: deleted.length }, 'Incremental sync');
  }

  upsertCollectionSync(cacheDb, userId, collectionUrl, newToken);
  return newToken;
}

/**
 * Discover all calendar collections supporting a given component type and run
 * initialSyncCollection for any that are not yet seeded in the cache.
 * Called on first navigation to Tasks / Notes / Journals.
 */
export async function initialSyncForComponentType(
  session: SessionData,
  userId: string,
  componentType: 'VTODO' | 'VJOURNAL',
  cacheDb: CacheDbInstance,
  config: Config,
  logger?: Logger,
): Promise<void> {
  const calendars = await listCalendars(session, config);
  const matching = calendars.filter((cal) => cal.components.includes(componentType));

  for (const cal of matching) {
    const already = getCollectionSync(cacheDb, userId, cal.url);
    if (already) continue; // incremental sync will keep it current

    logger?.info({ collectionUrl: cal.url, componentType }, 'Running initial sync for new collection');
    await initialSyncCollection(session, cal.url, cal.syncToken, userId, cacheDb, config, logger, componentType);
  }
}

/**
 * Incremental sync for all collections already known in the cache for one user.
 *
 * The worker only calls this function. Initial sync (populating the cache for
 * the first time) is triggered by user navigation via the /api/sync/tasks and
 * /api/sync/notes endpoints, not by the background worker. This means the worker
 * never issues a PROPFIND/listCalendars call — it only processes collections
 * already recorded in collection_sync, which avoids spurious Baikal traffic for
 * users who haven't visited Tasks/Notes/Journals yet (including stale sessions).
 */
export async function syncAllCollectionsForUser(
  session: SessionData,
  userId: string,
  cacheDb: CacheDbInstance,
  config: Config,
  logger?: Logger,
): Promise<void> {
  const known = cacheDb
    .prepare('SELECT collection_url, sync_token FROM collection_sync WHERE user_id = ?')
    .all(userId) as unknown as CollectionSyncRow[];

  if (known.length === 0) return;

  for (const { collection_url, sync_token } of known) {
    try {
      await incrementalSyncCollection(
        session, collection_url, userId, sync_token, cacheDb, config, logger,
      );
    } catch (err) {
      logger?.warn({ err, collectionUrl: collection_url }, 'Sync failed for collection; will retry next tick');
    }
  }

  const evicted = evictOldCompleted(cacheDb, userId, config.COMPLETED_TASK_RETENTION_DAYS);
  if (evicted > 0) {
    logger?.debug({ userId, evicted }, 'Evicted old completed tasks');
  }
}
