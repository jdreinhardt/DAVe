import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp, makeDb, TEST_SECRET } from './helpers.js';
import { meRoutes } from '../routes/me.js';
import { createSession } from '../services/session.js';
import { COOKIE_NAME } from '../plugins/session.js';
import type { DbInstance } from '../db/index.js';
import type { SessionData } from '../services/session.js';

const SESSION_DATA: SessionData = {
  username: 'alice',
  password: 'hunter2',
  displayName: 'Alice Wonderland',
  principalUrl: 'https://dav.test/principals/alice',
  calendarHomeUrl: 'https://dav.test/cal/alice/',
  addressBookHomeUrl: 'https://dav.test/ab/alice/',
};

describe('GET /api/me', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: DbInstance;

  beforeEach(async () => {
    db = makeDb();
    app = await buildApp(async (a) => {
      await a.register(meRoutes);
    }, db);
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 when no session cookie is provided', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for an invalid session ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: `${COOKIE_NAME}=does-not-exist` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with user info for a valid session', async () => {
    const id = createSession(SESSION_DATA, TEST_SECRET, db);
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: `${COOKIE_NAME}=${id}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.username).toBe('alice');
    expect(body.displayName).toBe('Alice Wonderland');
    expect(body.principalUrl).toBe(SESSION_DATA.principalUrl);
  });
});
