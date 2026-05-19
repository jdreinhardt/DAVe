import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildIntegrationApp, loginAndGetCookie } from './setup.js';
import type { AddressBook, Calendar } from '@dave/shared';

let app: FastifyInstance;
let cookie: string;

beforeAll(async () => {
  app = await buildIntegrationApp();
  cookie = await loginAndGetCookie(app);
});

afterAll(async () => {
  await app.close();
});

describe('address books', () => {
  it('GET /api/addressbooks returns the seeded address book', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/addressbooks', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const books = res.json() as AddressBook[];
    expect(Array.isArray(books)).toBe(true);
    expect(books.length).toBeGreaterThan(0);
    expect(books[0]).toMatchObject({ id: expect.any(String), displayName: expect.any(String) });
  });

  it('creates, patches, and deletes an address book', async () => {
    const name = `Integration AB ${Date.now()}`;

    // Create
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/addressbooks',
      headers: { cookie },
      payload: { displayName: name },
    });
    expect(createRes.statusCode).toBe(201);
    const afterCreate = createRes.json() as AddressBook[];
    const created = afterCreate.find((b) => b.displayName === name);
    expect(created).toBeDefined();
    const bookId = created!.id;

    // Patch display name
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/addressbooks/${bookId}`,
      headers: { cookie },
      payload: { displayName: `${name} Updated` },
    });
    expect(patchRes.statusCode).toBe(200);
    const afterPatch = patchRes.json() as AddressBook[];
    expect(afterPatch.find((b) => b.id === bookId)?.displayName).toBe(`${name} Updated`);

    // Delete
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/addressbooks/${bookId}`,
      headers: { cookie },
    });
    expect(deleteRes.statusCode).toBe(204);

    // Verify gone
    const listRes = await app.inject({ method: 'GET', url: '/api/addressbooks', headers: { cookie } });
    const final = listRes.json() as AddressBook[];
    expect(final.find((b) => b.id === bookId)).toBeUndefined();
  });
});

describe('calendars', () => {
  it('GET /api/calendars returns the seeded calendar', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/calendars', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const cals = res.json() as Calendar[];
    expect(Array.isArray(cals)).toBe(true);
    expect(cals.length).toBeGreaterThan(0);
    expect(cals[0]).toMatchObject({ id: expect.any(String), displayName: expect.any(String) });
  });

  it('creates, patches, and deletes a calendar', async () => {
    const name = `Integration Cal ${Date.now()}`;

    // Create
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/calendars',
      headers: { cookie },
      payload: { displayName: name, color: '#ff0000', components: ['VEVENT'] },
    });
    expect(createRes.statusCode).toBe(201);
    const afterCreate = createRes.json() as Calendar[];
    const created = afterCreate.find((c) => c.displayName === name);
    expect(created).toBeDefined();
    const calId = created!.id;

    // Patch
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/calendars/${calId}`,
      headers: { cookie },
      payload: { displayName: `${name} Updated`, color: '#00ff00' },
    });
    expect(patchRes.statusCode).toBe(200);
    const afterPatch = patchRes.json() as Calendar[];
    expect(afterPatch.find((c) => c.id === calId)?.displayName).toBe(`${name} Updated`);

    // Delete
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/calendars/${calId}`,
      headers: { cookie },
    });
    expect(deleteRes.statusCode).toBe(204);
  });
});
