import type { CacheDbInstance } from '../db/cache.js';
import type { Config } from '../config.js';
import type { SessionData } from './session.js';
import {
  fetchAllCalendarObjects,
  syncCalendarForCache,
  listCalendars,
  SyncTokenInvalidError,
} from '../lib/dav.js';
import { parseEntry } from '../lib/entryParser.js';
import {
  upsertEntry,
  deleteEntryByObjectUrl,
  deleteEntriesForCollection,
  upsertCollectionSync,
  getCollectionSync,
  hasCollectionSeeded,
  markCollectionSeeded,
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
): Promise<boolean> {
  const tFetch = Date.now();
  const objects = await fetchAllCalendarObjects(session, collectionUrl, config, componentType);
  const fetchMs = Date.now() - tFetch;
  const tStore = Date.now();

  const cap = config.MAX_CACHED_ENTRIES_PER_USER;
  const existing = countEntriesForUser(cacheDb, userId);
  let remaining = cap - existing;

  let count = 0;
  let truncated = false;
  for (const { url, etag, rawIcs } of objects) {
    if (remaining <= 0) {
      truncated = true;
      logger?.warn(
        { userId, cap, collectionUrl, fetched: objects.length, stored: count },
        'MAX_CACHED_ENTRIES_PER_USER reached; initial sync truncated for this collection',
      );
      break;
    }
    const entry = parseEntry(rawIcs, url, collectionUrl, userId, etag);
    if (entry) {
      upsertEntry(cacheDb, entry);
      count++;
      remaining--;
    }
  }

  // Only claim the collection is synced if it actually was. Recording the token
  // after a truncated pass hands the collection to incremental sync, which only
  // applies changes *since* that token — so whatever the cap cut off would never
  // be fetched again, and the collection would look permanently half-empty.
  // Leaving the row absent means the next initial sync retries it.
  if (truncated) {
    logger?.error(
      { collectionUrl, stored: count, fetched: objects.length },
      'Collection not marked synced because the entry cap truncated it; raise MAX_CACHED_ENTRIES_PER_USER',
    );
    return false;
  }

  upsertCollectionSync(cacheDb, userId, collectionUrl, syncToken);
  // Timings are split because the two halves fail differently: a slow fetch is
  // the DAV server or the round-trip count, a slow store is the cache write
  // path. A first visit to Notes/Tasks blocks on the sum of these across every
  // collection advertising the type, so this is the log to read when that visit
  // takes seconds.
  logger?.info(
    { collectionUrl, count, componentType, fetchMs, storeMs: Date.now() - tStore, fetched: objects.length },
    'Initial collection sync complete',
  );
  return true;
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
  let result;
  try {
    result = await syncCalendarForCache(session, collectionUrl, syncToken, config);
  } catch (err) {
    if (!(err instanceof SyncTokenInvalidError)) throw err;
    // The server forgot our token (Radicale prunes after max_sync_token_age,
    // 30 days by default). Rebuild: drop the collection's rows, then repeat the
    // REPORT with an empty token, which RFC 6578 §3.2 defines as "send me
    // everything". Clearing first is what keeps objects deleted during the gap
    // from surviving in the cache — a full REPORT lists only current members and
    // reports no deletions.
    logger?.warn({ collectionUrl }, 'Sync token rejected by server; rebuilding collection cache');
    deleteEntriesForCollection(cacheDb, collectionUrl, userId);
    result = await syncCalendarForCache(session, collectionUrl, '', config);
  }

  const { syncToken: newToken, changed, deleted } = result;

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
  const tList = Date.now();
  const calendars = await listCalendars(session, config);
  const listMs = Date.now() - tList;
  const matching = calendars.filter((cal) => cal.components.includes(componentType));
  const tPass = Date.now();
  logger?.info(
    { componentType, listMs, calendars: calendars.length, matching: matching.length },
    'Initial sync pass starting',
  );

  for (const cal of matching) {
    // Gate on the component type, not the collection. A calendar advertising
    // both VTODO and VJOURNAL needs a seeding pass for each: the initial fetch
    // is filtered by component type, so a pass for one type never retrieves the
    // other's objects. Keying this on the collection alone meant the first type
    // to run claimed it and the second type's existing objects stayed invisible
    // forever — incremental sync only reports changes *since* its token, so
    // nothing backfilled them.
    if (hasCollectionSeeded(cacheDb, userId, cal.url, componentType)) continue;

    // Reuse the recorded token if another component type already seeded this
    // collection. Advancing to a newer token here would skip changes made to
    // that other type since it synced.
    const existing = getCollectionSync(cacheDb, userId, cal.url);
    const tokenToRecord = existing?.syncToken ?? cal.syncToken;

    logger?.info({ collectionUrl: cal.url, componentType }, 'Running initial sync for collection');
    try {
      // Only record the pass as done if it completed; a truncated pass must be
      // retried rather than remembered as finished.
      const complete = await initialSyncCollection(
        session, cal.url, tokenToRecord, userId, cacheDb, config, logger, componentType,
      );
      if (complete) markCollectionSeeded(cacheDb, userId, cal.url, componentType);
    } catch (err) {
      // Isolate per collection, as syncAllCollectionsForUser already does.
      // Without this, one unreachable collection aborts the loop and every
      // collection after it is silently never seeded — the user just sees some
      // of their notes missing, with nothing naming the collection at fault.
      // The next call retries, since no collection_sync row was written.
      logger?.error(
        { err, collectionUrl: cal.url, componentType },
        'Initial sync failed for collection; continuing with the rest',
      );
    }
  }

  logger?.info(
    { componentType, listMs, seedMs: Date.now() - tPass, matching: matching.length },
    'Initial sync pass complete',
  );
}

/**
 * Incremental sync for all collections already known in the cache for one user.
 *
 * The worker only calls this function. Initial sync (populating the cache for
 * the first time) is triggered by user navigation via the /api/sync/tasks and
 * /api/sync/notes endpoints, not by the background worker. This means the worker
 * never issues a PROPFIND/listCalendars call — it only processes collections
 * already recorded in collection_sync, which avoids spurious DAV traffic for
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
