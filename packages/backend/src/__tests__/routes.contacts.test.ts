import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildApp, makeDb, TEST_SECRET } from './helpers.js';
import { contactsRoutes } from '../routes/contacts.js';
import { createSession } from '../services/session.js';
import { COOKIE_NAME } from '../plugins/session.js';
import type { DbInstance } from '../db/index.js';
import type { SessionData } from '../services/session.js';

vi.mock('../lib/dav.js', () => ({
  discoverAndValidate: vi.fn(),
  fetchAddressBooks: vi.fn(),
  fetchCalendars: vi.fn(),
  fetchContacts: vi.fn(),
  fetchRawContacts: vi.fn(),
  fetchEvents: vi.fn(),
  createContact: vi.fn(),
  updateContact: vi.fn(),
  deleteContact: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  createAddressBook: vi.fn(),
  updateAddressBook: vi.fn(),
  deleteAddressBook: vi.fn(),
  createCalendar: vi.fn(),
  updateCalendar: vi.fn(),
  deleteCalendar: vi.fn(),
  syncCollection: vi.fn(),
}));

import { createContact, updateContact, deleteContact, fetchRawContacts, fetchContacts } from '../lib/dav.js';

const SESSION_DATA: SessionData = {
  username: 'alice',
  password: 'hunter2',
  displayName: 'Alice',
  principalUrl: 'https://baikal.test/principals/alice',
  calendarHomeUrl: 'https://baikal.test/cal/alice/',
  addressBookHomeUrl: 'https://baikal.test/ab/alice/',
};

const STUB_CONTACT_RESULT = {
  id: 'contact-1',
  url: 'https://baikal.test/ab/alice/contacts/contact-1.vcf',
  etag: '"etag-1"',
  addressBookId: 'contacts',
  data: {
    uid: 'contact-1',
    version: '4.0',
    name: { prefix: '', given: 'Bob', middle: '', family: 'Smith', suffix: '' },
    fullName: 'Bob Smith',
    nickname: '', organization: '', title: '',
    phones: [], emails: [], addresses: [], urls: [],
    birthday: null, anniversary: null, note: '', photo: null, customFields: [],
  },
};

const MINIMAL_CONTACT_DATA = STUB_CONTACT_RESULT.data;

describe('contacts routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: DbInstance;
  let cookie: string;

  beforeEach(async () => {
    vi.mocked(createContact).mockReset();
    vi.mocked(updateContact).mockReset();
    vi.mocked(deleteContact).mockReset();
    vi.mocked(fetchRawContacts).mockReset();
    vi.mocked(fetchContacts).mockReset();

    db = makeDb();
    const sessionId = createSession(SESSION_DATA, TEST_SECRET, db);
    cookie = `${COOKIE_NAME}=${sessionId}`;

    app = await buildApp(async (a, cfg, d) => {
      await a.register(contactsRoutes, { config: cfg, db: d });
    }, db);
  });

  afterEach(async () => {
    await app.close();
  });

  // ── POST /api/addressbooks/:id/contacts ─────────────────────────────────────

  describe('POST /api/addressbooks/:id/contacts', () => {
    it('returns 401 without a session', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/addressbooks/contacts/contacts',
        payload: { data: MINIMAL_CONTACT_DATA },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 when data is missing from body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/addressbooks/contacts/contacts',
        headers: { cookie },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 201 on success', async () => {
      vi.mocked(createContact).mockResolvedValueOnce(STUB_CONTACT_RESULT);
      const res = await app.inject({
        method: 'POST',
        url: '/api/addressbooks/contacts/contacts',
        headers: { cookie },
        payload: { data: MINIMAL_CONTACT_DATA },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().id).toBe('contact-1');
    });

    it('returns 409 when DAV throws 409', async () => {
      const err = Object.assign(new Error('Conflict'), { statusCode: 409 });
      vi.mocked(createContact).mockRejectedValueOnce(err);
      const res = await app.inject({
        method: 'POST',
        url: '/api/addressbooks/contacts/contacts',
        headers: { cookie },
        payload: { data: MINIMAL_CONTACT_DATA },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  // ── PUT /api/addressbooks/:id/contacts/:contactId ──────────────────────────

  describe('PUT /api/addressbooks/:id/contacts/:contactId', () => {
    it('returns 400 when etag is missing', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/addressbooks/contacts/contacts/contact-1',
        headers: { cookie },
        payload: { data: MINIMAL_CONTACT_DATA },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 412 when DAV throws 412', async () => {
      const err = Object.assign(new Error('Precondition Failed'), { statusCode: 412 });
      vi.mocked(updateContact).mockRejectedValueOnce(err);
      const res = await app.inject({
        method: 'PUT',
        url: '/api/addressbooks/contacts/contacts/contact-1',
        headers: { cookie },
        payload: { data: MINIMAL_CONTACT_DATA, etag: '"etag-old"' },
      });
      expect(res.statusCode).toBe(412);
    });

    it('returns 200 on success', async () => {
      vi.mocked(updateContact).mockResolvedValueOnce(STUB_CONTACT_RESULT);
      const res = await app.inject({
        method: 'PUT',
        url: '/api/addressbooks/contacts/contacts/contact-1',
        headers: { cookie },
        payload: { data: MINIMAL_CONTACT_DATA, etag: '"etag-1"' },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── DELETE /api/addressbooks/:id/contacts/:contactId ──────────────────────

  describe('DELETE /api/addressbooks/:id/contacts/:contactId', () => {
    it('returns 400 when etag query param is missing', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/addressbooks/contacts/contacts/contact-1',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 412 when DAV throws 412', async () => {
      const err = Object.assign(new Error('Precondition Failed'), { statusCode: 412 });
      vi.mocked(deleteContact).mockRejectedValueOnce(err);
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/addressbooks/contacts/contacts/contact-1?etag=%22etag-old%22',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(412);
    });

    it('returns 204 on success', async () => {
      vi.mocked(deleteContact).mockResolvedValueOnce(undefined);
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/addressbooks/contacts/contacts/contact-1?etag=%22etag-1%22',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(204);
    });
  });

  // ── POST /api/addressbooks/:id/import ─────────────────────────────────────

  describe('POST /api/addressbooks/:id/import', () => {
    it('returns 400 when vcf is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/addressbooks/contacts/import',
        headers: { cookie },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('imports a valid 2-contact VCF', async () => {
      vi.mocked(createContact).mockResolvedValue(STUB_CONTACT_RESULT);

      const vcf = [
        'BEGIN:VCARD',
        'VERSION:4.0',
        'FN:Alice',
        'UID:import-alice',
        'END:VCARD',
        'BEGIN:VCARD',
        'VERSION:4.0',
        'FN:Bob',
        'UID:import-bob',
        'END:VCARD',
      ].join('\r\n');

      const res = await app.inject({
        method: 'POST',
        url: '/api/addressbooks/contacts/import',
        headers: { cookie },
        payload: { vcf },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().imported).toBe(2);
      expect(res.json().failed).toBe(0);
    });
  });

  // ── GET /api/addressbooks/:id/export ──────────────────────────────────────

  describe('GET /api/addressbooks/:id/export', () => {
    it('returns 200 with text/vcard content-type', async () => {
      vi.mocked(fetchRawContacts).mockResolvedValueOnce([
        { url: 'https://baikal.test/ab/contacts/alice.vcf', etag: '"etag1"', raw: 'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Alice\r\nUID:alice\r\nEND:VCARD' },
      ]);
      const res = await app.inject({
        method: 'GET',
        url: '/api/addressbooks/contacts/export',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/vcard');
    });
  });
});
