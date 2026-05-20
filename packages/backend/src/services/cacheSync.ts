import type { CacheDbInstance } from '../db/cache.js';
import type { Config } from '../config.js';
import type { SessionData } from './session.js';
import {
  fetchAllCalendarObjects,
  syncCalendarForCache,
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
): Promise<void> {
  const objects = await fetchAllCalendarObjects(session, collectionUrl, config);

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
 * Sync all calendar collections for one user.
 * Falls back to initialSyncCollection for collections not yet in the cache.
 */
export async function syncAllCollectionsForUser(
  session: SessionData,
  userId: string,
  cacheDb: CacheDbInstance,
  config: Config,
  logger?: Logger,
): Promise<void> {
  const { listCalendars } = await import('../lib/dav.js');
  const calendars = await listCalendars(session, config);

  for (const cal of calendars) {
    const state = getCollectionSync(cacheDb, userId, cal.url);
    try {
      if (!state) {
        await initialSyncCollection(
          session, cal.url, cal.syncToken, userId, cacheDb, config, logger,
        );
      } else {
        await incrementalSyncCollection(
          session, cal.url, userId, state.syncToken, cacheDb, config, logger,
        );
      }
    } catch (err) {
      logger?.warn({ err, collectionUrl: cal.url }, 'Sync failed for collection; will retry next tick');
    }
  }

  const evicted = evictOldCompleted(cacheDb, userId, config.COMPLETED_TASK_RETENTION_DAYS);
  if (evicted > 0) {
    logger?.debug({ userId, evicted }, 'Evicted old completed tasks');
  }
}
