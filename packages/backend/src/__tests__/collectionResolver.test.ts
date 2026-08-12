import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/dav.js', () => ({ listCalendars: vi.fn() }));

import { resolveCollectionUrl, matchObjectUrl } from '../services/collectionResolver.js';
import { listCalendars } from '../lib/dav.js';
import { makeCacheDb, testConfig } from './helpers.js';
import { upsertCollectionSync } from '../db/cacheOps.js';
import type { CacheDbInstance } from '../db/cache.js';
import type { SessionData } from '../services/session.js';

const session: SessionData = {
  username: 'alice',
  password: 'pw',
  displayName: 'Alice',
  principalUrl: 'http://dav.test/dav.php/principals/alice',
  calendarHomeUrl: 'http://dav.test/dav.php/cal/alice/',
  addressBookHomeUrl: 'http://dav.test/dav.php/ab/alice/',
};

const MINE = 'http://dav.test/dav.php/cal/alice/personal/';
const OTHER = 'http://dav.test/dav.php/cal/bob/personal/';

const listMock = vi.mocked(listCalendars);

let cacheDb: CacheDbInstance;
beforeEach(() => {
  cacheDb = makeCacheDb();
  listMock.mockReset();
  listMock.mockResolvedValue([]);
});

function seed(url: string, user = 'alice') {
  upsertCollectionSync(cacheDb, user, url, 'token-1');
}

describe('resolveCollectionUrl — cache hit', () => {
  it('returns the stored URL, not the caller string', async () => {
    seed(MINE);
    const got = await resolveCollectionUrl(session, 'alice', MINE, cacheDb, testConfig);
    expect(got).toBe(MINE);
    expect(listMock).not.toHaveBeenCalled(); // fast path: no DAV traffic
  });

  it('matches regardless of trailing slash', async () => {
    seed(MINE);
    const got = await resolveCollectionUrl(
      session, 'alice', MINE.replace(/\/$/, ''), cacheDb, testConfig,
    );
    // The stored form is returned, so downstream URL building stays consistent.
    expect(got).toBe(MINE);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('ignores a query string or fragment on the requested URL', async () => {
    seed(MINE);
    const got = await resolveCollectionUrl(session, 'alice', `${MINE}?x=1#f`, cacheDb, testConfig);
    expect(got).toBe(MINE);
  });

  it('does not match another user\'s cached collection', async () => {
    seed(OTHER, 'bob');
    await expect(
      resolveCollectionUrl(session, 'alice', OTHER, cacheDb, testConfig),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

// These are the regressions the cache-only design would have caused: the cache
// is only seeded on navigation to Tasks/Notes/Journals, is disposable, and is
// not written when a collection is created.
describe('resolveCollectionUrl — cold cache falls back to a live listing', () => {
  it('resolves a collection that exists on the server but is not cached yet', async () => {
    listMock.mockResolvedValue([{ url: MINE }] as never);
    const got = await resolveCollectionUrl(session, 'alice', MINE, cacheDb, testConfig);
    expect(got).toBe(MINE);
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('resolves a just-created collection (create does not seed the cache)', async () => {
    const fresh = 'http://dav.test/dav.php/cal/alice/brand-new/';
    listMock.mockResolvedValue([{ url: MINE }, { url: fresh }] as never);
    await expect(
      resolveCollectionUrl(session, 'alice', fresh, cacheDb, testConfig),
    ).resolves.toBe(fresh);
  });

  it('rejects when the server does not list it either', async () => {
    listMock.mockResolvedValue([{ url: MINE }] as never);
    await expect(
      resolveCollectionUrl(session, 'alice', OTHER, cacheDb, testConfig),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns the server URL verbatim even if the client sent a different form', async () => {
    listMock.mockResolvedValue([{ url: MINE }] as never);
    const got = await resolveCollectionUrl(
      session, 'alice', MINE.replace(/\/$/, ''), cacheDb, testConfig,
    );
    expect(got).toBe(MINE);
  });
});

describe('resolveCollectionUrl — hostile input', () => {
  const hostile = [
    'http://169.254.169.254/latest/meta-data/',
    'http://evil.test/dav.php/cal/alice/personal/',
    'http://dav.test/some-other-app/',
    'not a url',
    '',
  ];
  it.each(hostile)('rejects %j', async (url) => {
    listMock.mockResolvedValue([{ url: MINE }] as never);
    await expect(
      resolveCollectionUrl(session, 'alice', url, cacheDb, testConfig),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a traversal that would resolve to a sibling collection', async () => {
    seed(MINE);
    await expect(
      resolveCollectionUrl(
        session, 'alice', 'http://dav.test/dav.php/cal/alice/../bob/personal/', cacheDb, testConfig,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('matchObjectUrl', () => {
  const candidates = [`${MINE}task-1.ics`, `${MINE}task-2.ics`];

  it('returns the candidate string rather than echoing the request', () => {
    // The request is canonically equal but written differently, so the result
    // shows which of the two strings is actually handed downstream.
    const requested = `${MINE}task-1.ics?cachebust=1`;
    expect(matchObjectUrl(requested, candidates)).toBe(`${MINE}task-1.ics`);
  });

  it('matches despite a query string or fragment on the request', () => {
    expect(matchObjectUrl(`${MINE}task-2.ics?v=1#x`, candidates)).toBe(candidates[1]);
  });

  const rejected: [string, string][] = [
    [`${MINE}task-3.ics`, 'not in the candidate list'],
    [`${OTHER}task-1.ics`, 'object in a different collection'],
    [`${MINE}nested/task-1.ics`, 'nested path'],
    [MINE, 'the collection itself'],
    ['http://evil.test/task-1.ics', 'different host'],
    ['not a url', 'unparseable'],
    ['', 'empty'],
  ];
  it.each(rejected)('rejects %s (%s)', (objectUrl) => {
    expect(() => matchObjectUrl(objectUrl, candidates)).toThrow();
  });

  it('rejects everything when the archive search returned nothing', () => {
    expect(() => matchObjectUrl(`${MINE}task-1.ics`, [])).toThrow();
  });
});
