import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildIntegrationApp, loginAndGetCookie } from './setup.js';
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
});
