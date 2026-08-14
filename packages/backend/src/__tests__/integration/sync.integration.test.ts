import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildIntegrationApp, loginAndGetCookie, getTestCacheDb, integrationConfig, TEST_USER, TEST_PASS } from './setup.js';
import { createJournal, discoverAndValidate } from '../../lib/dav.js';
import type { SessionData } from '../../services/session.js';
import type { AddressBook, CollectionSyncResponse, Contact } from '@dave/shared';

let app: FastifyInstance;
let cookie: string;

beforeAll(async () => {
  app = await buildIntegrationApp();
  cookie = await loginAndGetCookie(app);
});

afterAll(async () => {
  await app.close();
});

describe('POST /api/sync', () => {
  it('returns 401 without a session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync',
      payload: { addressbooks: [], calendars: [] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns response shape with addressbooks and calendars arrays', async () => {
    // Fetch current collection IDs and sync tokens
    const [abRes, calRes] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/addressbooks', headers: { cookie } }),
      app.inject({ method: 'GET', url: '/api/calendars', headers: { cookie } }),
    ]);
    const addressbooks = (abRes.json() as AddressBook[]).map((b) => ({
      id: b.id,
      syncToken: b.syncToken,
    }));
    const calendars = (calRes.json() as Array<{ id: string; syncToken: string }>).map((c) => ({
      id: c.id,
      syncToken: c.syncToken,
    }));

    const syncRes = await app.inject({
      method: 'POST',
      url: '/api/sync',
      headers: { cookie },
      payload: { addressbooks, calendars },
    });
    expect(syncRes.statusCode).toBe(200);
    const body = syncRes.json() as CollectionSyncResponse;
    expect(Array.isArray(body.addressbooks)).toBe(true);
    expect(Array.isArray(body.calendars)).toBe(true);
  });

  it('reports a changed contact after creation', async () => {
    const abRes = await app.inject({ method: 'GET', url: '/api/addressbooks', headers: { cookie } });
    const books = abRes.json() as AddressBook[];
    if (!books.length) return; // guard: no address books
    const book = books[0]!;

    // Capture current sync token
    const syncToken = book.syncToken;
    const abId = book.id;

    // Create a contact
    const uid = `sync-test-${Date.now()}`;
    await app.inject({
      method: 'POST',
      url: `/api/addressbooks/${abId}/contacts`,
      headers: { cookie },
      payload: {
        data: {
          uid, version: '4.0',
          name: { prefix: '', given: 'Sync', middle: '', family: 'Test', suffix: '' },
          fullName: 'Sync Test', nickname: '', organization: '', title: '',
          phones: [], emails: [], addresses: [], urls: [],
          birthday: null, anniversary: null, note: '', photo: null, customFields: [],
        },
      },
    });

    // Sync with the old token — should see the new contact in changed
    const syncRes = await app.inject({
      method: 'POST',
      url: '/api/sync',
      headers: { cookie },
      payload: {
        addressbooks: [{ id: abId, syncToken }],
        calendars: [],
      },
    });
    expect(syncRes.statusCode).toBe(200);
    const body = syncRes.json() as CollectionSyncResponse;
    const abResult = body.addressbooks.find((r) => r.id === abId);
    expect(abResult).toBeDefined();
    expect(abResult!.changed.length).toBeGreaterThan(0);
    const found = (abResult!.changed as Contact[]).some((c) => c.data.uid === uid);
    expect(found).toBe(true);

    // Sync with the new token — delta should be empty
    const newToken = abResult!.syncToken;
    const emptySync = await app.inject({
      method: 'POST',
      url: '/api/sync',
      headers: { cookie },
      payload: {
        addressbooks: [{ id: abId, syncToken: newToken }],
        calendars: [],
      },
    });
    const emptyBody = emptySync.json() as CollectionSyncResponse;
    const emptyResult = emptyBody.addressbooks.find((r) => r.id === abId);
    expect(emptyResult?.changed.length ?? 0).toBe(0);
    expect(emptyResult?.deleted.length ?? 0).toBe(0);
  });

  it('reports a deleted contact under the same id the contact list uses', async () => {
    // Servers report removed members as relative hrefs ("/dav.php/…/x.vcf").
    // Deriving the id without resolving them first yields the whole href, which
    // matches no cached contact — so the deletion is delivered but silently never
    // applied, and the contact lingers in the UI until a full reload.
    const books = (
      await app.inject({ method: 'GET', url: '/api/addressbooks', headers: { cookie } })
    ).json() as AddressBook[];
    expect(books.length).toBeGreaterThan(0);
    const abId = books[0]!.id;

    const uid = `delete-sync-${Date.now()}`;
    await app.inject({
      method: 'POST',
      url: `/api/addressbooks/${abId}/contacts`,
      headers: { cookie },
      payload: {
        data: {
          uid, version: '4.0',
          name: { prefix: '', given: 'Delete', middle: '', family: 'Sync', suffix: '' },
          fullName: 'Delete Sync', nickname: '', organization: '', title: '',
          phones: [], emails: [], addresses: [], urls: [],
          birthday: null, anniversary: null, note: '', photo: null, customFields: [],
        },
      },
    });

    const contacts = (
      await app.inject({ method: 'GET', url: `/api/addressbooks/${abId}/contacts`, headers: { cookie } })
    ).json() as Contact[];
    const created = contacts.find((c) => c.data.uid === uid);
    expect(created).toBeDefined();

    // Capture the token *after* the create so the delta contains only the delete.
    const syncToken = ((
      await app.inject({ method: 'GET', url: '/api/addressbooks', headers: { cookie } })
    ).json() as AddressBook[]).find((b) => b.id === abId)!.syncToken;

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/addressbooks/${abId}/contacts/${created!.id}?etag=${encodeURIComponent(created!.etag)}`,
      headers: { cookie },
    });
    expect(delRes.statusCode).toBe(204);

    const syncRes = await app.inject({
      method: 'POST',
      url: '/api/sync',
      headers: { cookie },
      payload: { addressbooks: [{ id: abId, syncToken }], calendars: [] },
    });
    const abResult = (syncRes.json() as CollectionSyncResponse).addressbooks.find((r) => r.id === abId);
    expect(abResult).toBeDefined();
    // The id must match what the contact list handed out, not the raw href.
    expect(abResult!.deleted).toContain(created!.id);
  });

  it('recovers from a sync token the server no longer recognises', async () => {
    // Radicale prunes tokens older than max_sync_token_age (30 days by default)
    // and answers a stale one with 403 DAV:valid-sync-token; sabre/dav does the
    // same for tokens it has forgotten. Before this was handled, the rejection
    // parsed as "nothing changed" and the collection silently stopped syncing
    // forever. Both servers must recover by resending the whole collection.
    const abRes = await app.inject({ method: 'GET', url: '/api/addressbooks', headers: { cookie } });
    const books = abRes.json() as AddressBook[];
    expect(books.length).toBeGreaterThan(0);
    const abId = books[0]!.id;

    const syncRes = await app.inject({
      method: 'POST',
      url: '/api/sync',
      headers: { cookie },
      payload: {
        addressbooks: [{ id: abId, syncToken: 'http://example.invalid/ns/sync/definitely-not-real' }],
        calendars: [],
      },
    });

    expect(syncRes.statusCode).toBe(200);
    const result = (syncRes.json() as CollectionSyncResponse).addressbooks.find((r) => r.id === abId);
    expect(result).toBeDefined();
    // Flagged full so the client replaces rather than merges, and carrying a
    // usable token again rather than echoing the rejected one back.
    expect(result!.full).toBe(true);
    expect(result!.syncToken).not.toBe('http://example.invalid/ns/sync/definitely-not-real');
    expect(result!.syncToken.length).toBeGreaterThan(0);
  });
});

// The endpoint used to return 202 and sync in the background, so the client
// re-queried an empty cache and rendered "no notes" until a second visit.
// Its contract is that the cache is populated by the time it returns.
describe('POST /api/sync/notes', () => {
  it('returns 401 without a session', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/sync/notes' });
    expect(res.statusCode).toBe(401);
  });

  it('has the journal in the cache by the time it responds', async () => {
    const calRes = await app.inject({ method: 'GET', url: '/api/calendars', headers: { cookie } });
    const cal = (JSON.parse(calRes.body) as { url: string; components: string[] }[])
      .find((c) => c.components.includes('VJOURNAL'));
    expect(cal, 'test stack should seed a VJOURNAL-capable calendar').toBeDefined();

    const uid = `sync-notes-${Date.now()}`;
    await createJournal(
      { username: TEST_USER, password: TEST_PASS, ...(await discoverAndValidate(TEST_USER, TEST_PASS, integrationConfig)) } as SessionData,
      cal!.url,
      {
        uid, summary: uid, description: '', dtstart: null,
        lastModified: null, categories: [], relations: [], collectionUrl: cal!.url,
      } as never,
      integrationConfig,
    );

    const cacheDb = getTestCacheDb();
    cacheDb.prepare('DELETE FROM entries').run();
    cacheDb.prepare('DELETE FROM collection_sync').run();
    cacheDb.prepare('DELETE FROM collection_seeded').run();

    const res = await app.inject({ method: 'POST', url: '/api/sync/notes', headers: { cookie } });
    expect(res.statusCode).toBe(200);

    // No polling: if this needs a retry, the endpoint returned too early.
    const row = cacheDb
      .prepare("SELECT COUNT(*) c FROM entries WHERE uid = ? AND component_type = 'VJOURNAL'")
      .get(uid) as { c: number };
    expect(row.c).toBe(1);
  });
});
