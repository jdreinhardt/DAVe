import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Contact } from '@dave/shared';
import { buildAppWithConfig, remoteUserConfig, DAV_OIDC_URL, getTestDb } from './setup.js';
import { discoverWithRemoteUser } from '../../lib/dav.js';
import { createSession } from '../../services/session.js';
import { COOKIE_NAME } from '../../plugins/session.js';

/**
 * The DAV half of OIDC sign-in, against a server that really does trust a user
 * header (docker-compose.test.radicale-oidc.yml).
 *
 * The unit and route suites mock both the provider and DAV, so until this file
 * nothing exercised `discoverWithRemoteUser` or the remote-user branch of
 * `authHeadersFor` against a live server — the one assumption the whole feature
 * rests on.
 *
 * No identity provider is involved. The provider's only job is to produce a
 * verified username, so these tests supply one directly and check what DAVe does
 * with it from there.
 *
 * Needs DAV_OIDC_URL (npm run test:integration:oidc, with npm run stack:oidc up).
 */

const USER = 'oidc-alice';
const OTHER_USER = 'oidc-bob';

/** Same shape as contacts.integration.test.ts — ContactJson wants every field. */
function minimalContact(uid: string, given: string) {
  return {
    uid,
    version: '4.0',
    name: { prefix: '', given, middle: '', family: 'Remote', suffix: '' },
    fullName: `${given} Remote`,
    nickname: '', organization: '', title: '',
    phones: [], emails: [], addresses: [], urls: [],
    birthday: null, anniversary: null, note: '', photo: null, customFields: [],
  };
}

describe.skipIf(!DAV_OIDC_URL)('remote-user sessions against a header-trusting server', () => {
  let app: FastifyInstance;
  let cookie: string;
  let addressBookId: string;

  /** A session as if OIDC had just verified `username`, with no password at all. */
  async function remoteUserSession(username: string): Promise<string> {
    const discovery = await discoverWithRemoteUser(username, remoteUserConfig);
    const id = createSession(
      {
        username,
        password: '',
        authMode: 'remote-user',
        displayName: username,
        principalUrl: discovery.principalUrl,
        calendarHomeUrl: discovery.calendarHomeUrl,
        addressBookHomeUrl: discovery.addressBookHomeUrl,
      },
      remoteUserConfig.SESSION_SECRET,
      getTestDb(),
    );
    return `${COOKIE_NAME}=${id}`;
  }

  beforeAll(async () => {
    app = await buildAppWithConfig(remoteUserConfig);
    cookie = await remoteUserSession(USER);

    const res = await app.inject({ method: 'GET', url: '/api/addressbooks', headers: { cookie } });
    const books = res.json() as Array<{ id: string }>;
    if (!books.length) {
      throw new Error(
        `No address books for ${USER} at ${remoteUserConfig.DAV_BASE_URL}. ` +
          'Is the trusted-header stack up (npm run stack:oidc)?',
      );
    }
    addressBookId = books[0]!.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('discovers home sets with no credentials but the user header', async () => {
    const discovery = await discoverWithRemoteUser(USER, remoteUserConfig);
    expect(discovery.principalUrl).toContain(USER);
    expect(discovery.calendarHomeUrl).toContain(USER);
    expect(discovery.addressBookHomeUrl).toContain(USER);
  });

  it('refuses a password session against the same server', async () => {
    // Negative control. If this ever passed, the stack would be accepting Basic
    // auth and every assertion here could be succeeding for the wrong reason.
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: USER, password: 'not-a-real-password' },
    });
    expect(res.statusCode).not.toBe(200);
  });

  it('lists the seeded collections', async () => {
    const abs = await app.inject({ method: 'GET', url: '/api/addressbooks', headers: { cookie } });
    const cals = await app.inject({ method: 'GET', url: '/api/calendars', headers: { cookie } });
    expect(abs.statusCode).toBe(200);
    expect(cals.statusCode).toBe(200);
    expect((abs.json() as Array<{ id: string }>).map((a) => a.id)).toContain('contacts');
    expect((cals.json() as Array<{ id: string }>).map((c) => c.id)).toContain('personal');
  });

  it('round-trips a contact, so writes carry the header too', async () => {
    const uid = `oidc-rt-${Date.now()}`;
    const create = await app.inject({
      method: 'POST',
      url: `/api/addressbooks/${encodeURIComponent(addressBookId)}/contacts`,
      headers: { cookie },
      payload: { data: minimalContact(uid, 'Roundtrip') },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as { id: string; etag: string };

    const list = await app.inject({
      method: 'GET',
      url: `/api/addressbooks/${encodeURIComponent(addressBookId)}/contacts`,
      headers: { cookie },
    });
    const found = (list.json() as Contact[]).find((c) => c.id === created.id);
    expect(found?.data.fullName).toBe('Roundtrip Remote');

    const del = await app.inject({
      method: 'DELETE',
      url:
        `/api/addressbooks/${encodeURIComponent(addressBookId)}/contacts/` +
        `${encodeURIComponent(created.id)}?etag=${encodeURIComponent(found!.etag)}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);
  });

  it('keeps users apart — the header decides whose collections you get', async () => {
    // Radicale derives the principal path from the header, so two usernames must
    // land on different home sets. A regression here would be cross-user access.
    const otherCookie = await remoteUserSession(OTHER_USER);
    const mine = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    const theirs = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: otherCookie } });

    expect((mine.json() as { username: string }).username).toBe(USER);
    expect((theirs.json() as { username: string }).username).toBe(OTHER_USER);

    const a = await discoverWithRemoteUser(USER, remoteUserConfig);
    const b = await discoverWithRemoteUser(OTHER_USER, remoteUserConfig);
    expect(a.addressBookHomeUrl).not.toBe(b.addressBookHomeUrl);
  });
});
