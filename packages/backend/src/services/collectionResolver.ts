import type { SessionData } from './session.js';
import type { CacheDbInstance } from '../db/cache.js';
import type { Config } from '../config.js';
import { listCalendars } from '../lib/dav.js';

/**
 * Resolve a client-supplied collection URL to one the server vouches for.
 *
 * The write routes accept `collectionUrl` in the request body. Passing that
 * string to the DAV layer means a user-controlled value reaches `fetch`, and
 * `assertDavTarget` only proves it is *somewhere* under the configured server —
 * not that it is a collection this user owns. Another user's collection sits
 * under the same base path, so that case rested entirely on the DAV server's
 * own ACLs.
 *
 * Resolving instead of validating fixes both halves: the value handed to the
 * DAV layer is one we read back from the cache or from a live listing, never the
 * request body, and it is necessarily a collection belonging to this session.
 */

/**
 * Canonical form for comparison: origin + path, no trailing slash, no query or
 * fragment. Servers are inconsistent about the trailing slash between a
 * PROPFIND listing and what a client echoes back, and a bare string compare
 * would reject legitimate writes.
 */
function canonical(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

/**
 * Map a requested collection URL onto the equivalent server-derived URL.
 *
 * Tries the cache first, then falls back to a live listing. The cache is a
 * performance structure, not an authorization record — it is disposable, it is
 * only seeded when the user visits Tasks/Notes/Journals, and creating a
 * collection does not populate it. Treating a cache miss as a rejection would
 * turn all of that into spurious 400s, so a miss costs one PROPFIND rather than
 * failing the write.
 */
export async function resolveCollectionUrl(
  session: SessionData,
  userId: string,
  requestedUrl: string,
  cacheDb: CacheDbInstance,
  config: Config,
): Promise<string> {
  const want = canonical(requestedUrl);
  if (!want) throw badRequest('Invalid collection URL');

  const known = cacheDb
    .prepare('SELECT collection_url FROM collection_sync WHERE user_id = ?')
    .all(userId) as unknown as { collection_url: string }[];

  for (const { collection_url } of known) {
    if (canonical(collection_url) === want) return collection_url;
  }

  // Cache miss — ask the server. Covers a collection created moments ago, a
  // wiped cache, and the window before the first sync of a view completes.
  const calendars = await listCalendars(session, config);
  for (const cal of calendars) {
    if (canonical(cal.url) === want) return cal.url;
  }

  throw badRequest('Unknown collection');
}

/**
 * Rebuild an object URL from an already-resolved collection URL.
 *
 * Used by the archive-restore path, which takes both a collection URL and an
 * object URL from the body. Resolving the collection says nothing about the
 * object, so the object would otherwise remain an unconstrained client-supplied
 * target.
 *
 * The member name has to come from the client — it is what identifies the
 * archived task — but nothing else does: the returned URL is assembled from the
 * resolved collection plus that one validated segment, rather than passing the
 * client's string through.
 */
export function resolveObjectUrl(objectUrl: string, resolvedCollectionUrl: string): string {
  const obj = canonical(objectUrl);
  const col = canonical(resolvedCollectionUrl);
  if (!obj || !col) throw badRequest('Invalid object URL');

  if (!obj.startsWith(`${col}/`)) {
    throw badRequest('Object URL is not inside the given collection');
  }
  // Direct member only: no nested path, no traversal back out.
  const name = obj.slice(col.length + 1);
  if (name.length === 0 || name.includes('/') || name === '.' || name === '..') {
    throw badRequest('Object URL is not a direct member of the collection');
  }

  return `${resolvedCollectionUrl.replace(/\/+$/, '')}/${name}`;
}
