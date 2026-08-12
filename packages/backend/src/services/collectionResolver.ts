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
 * Pick the server's own URL for a requested object out of a list the server
 * gave us.
 *
 * Used by the archive-restore path, which takes an object URL from the body in
 * addition to the collection URL. Resolving the collection says nothing about
 * the object, so the object needs its own check.
 *
 * This matches rather than rebuilds, deliberately. An earlier version validated
 * the client's URL and reassembled it from the resolved collection plus the
 * member name — safe, but the name still originated in the request, so the
 * value handed to the DAV layer was still derived from user input. Returning an
 * element of `candidateUrls` means the string we use came from the DAV server,
 * exactly as `resolveCollectionUrl` does.
 *
 * It also tightens the precondition: an object is restorable only if it really
 * is in the archive window, not merely well-formed.
 */
export function matchObjectUrl(requestedUrl: string, candidateUrls: string[]): string {
  const want = canonical(requestedUrl);
  if (!want) throw badRequest('Invalid object URL');

  for (const candidate of candidateUrls) {
    if (canonical(candidate) === want) return candidate;
  }
  throw badRequest('Unknown object');
}
