import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildIntegrationApp, loginAndGetCookie } from './setup.js';
import type { Contact } from '@dave/shared';

let app: FastifyInstance;
let cookie: string;
let addressBookId: string;

beforeAll(async () => {
  app = await buildIntegrationApp();
  cookie = await loginAndGetCookie(app);

  // Find the seeded address book
  const abRes = await app.inject({ method: 'GET', url: '/api/addressbooks', headers: { cookie } });
  const books = abRes.json() as Array<{ id: string }>;
  if (!books.length) throw new Error('No address books found — is Baikal seeded?');
  addressBookId = books[0]!.id;
});

afterAll(async () => {
  await app.close();
});

function minimalContact(uid: string, given: string) {
  return {
    uid,
    version: '4.0',
    name: { prefix: '', given, middle: '', family: 'Test', suffix: '' },
    fullName: `${given} Test`,
    nickname: '', organization: '', title: '',
    phones: [], emails: [], addresses: [], urls: [],
    birthday: null, anniversary: null, note: '', photo: null, customFields: [],
  };
}

describe('contacts CRUD', () => {
  it('GET /api/addressbooks/:id/contacts returns an array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/addressbooks/${addressBookId}/contacts`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('full ETag lifecycle: create → update (correct etag) → stale etag 412 → delete', async () => {
    const uid = `integration-${Date.now()}`;

    // Create
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/addressbooks/${addressBookId}/contacts`,
      headers: { cookie },
      payload: { data: minimalContact(uid, 'Integration') },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as Contact;
    expect(created.etag).toBeTruthy();
    const contactId = created.id;
    const etag1 = created.etag;

    // Update with correct etag
    const updateRes = await app.inject({
      method: 'PUT',
      url: `/api/addressbooks/${addressBookId}/contacts/${contactId}`,
      headers: { cookie },
      payload: {
        data: { ...minimalContact(uid, 'Updated'), uid },
        etag: etag1,
      },
    });
    expect(updateRes.statusCode).toBe(200);
    const updated = updateRes.json() as Contact;
    const etag2 = updated.etag;
    expect(etag2).toBeTruthy();

    // Update with stale etag → 412
    const staleRes = await app.inject({
      method: 'PUT',
      url: `/api/addressbooks/${addressBookId}/contacts/${contactId}`,
      headers: { cookie },
      payload: {
        data: minimalContact(uid, 'Stale'),
        etag: etag1, // deliberately old
      },
    });
    expect(staleRes.statusCode).toBe(412);

    // Delete with current etag
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/addressbooks/${addressBookId}/contacts/${contactId}?etag=${encodeURIComponent(etag2)}`,
      headers: { cookie },
    });
    expect(deleteRes.statusCode).toBe(204);

    // Verify it's gone
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/addressbooks/${addressBookId}/contacts`,
      headers: { cookie },
    });
    const contacts = listRes.json() as Contact[];
    expect(contacts.find((c) => c.id === contactId)).toBeUndefined();
  });

  it('import: POST /api/addressbooks/:id/import returns imported count', async () => {
    const vcf = [
      'BEGIN:VCARD', 'VERSION:4.0', 'FN:Import One', `UID:import-one-${Date.now()}`, 'END:VCARD',
      'BEGIN:VCARD', 'VERSION:4.0', 'FN:Import Two', `UID:import-two-${Date.now()}`, 'END:VCARD',
    ].join('\r\n');

    const res = await app.inject({
      method: 'POST',
      url: `/api/addressbooks/${addressBookId}/import`,
      headers: { cookie },
      payload: { vcf },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().imported).toBe(2);
    expect(res.json().failed).toBe(0);
  });

  it('export: GET /api/addressbooks/:id/export returns text/vcard', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/addressbooks/${addressBookId}/export`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/vcard');
  });
});
