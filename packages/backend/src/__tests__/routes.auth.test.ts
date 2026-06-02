import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildApp } from './helpers.js';
import { authRoutes } from '../routes/auth.js';
import { COOKIE_NAME } from '../plugins/session.js';

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

import { discoverAndValidate } from '../lib/dav.js';

const DISCOVERY_RESULT = {
  displayName: 'Alice',
  principalUrl: 'https://baikal.test/principals/alice',
  calendarHomeUrl: 'https://baikal.test/cal/alice/',
  addressBookHomeUrl: 'https://baikal.test/ab/alice/',
};

describe('POST /api/auth/login', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.mocked(discoverAndValidate).mockReset();
    app = await buildApp(async (a, cfg, db) => {
      await a.register(authRoutes, { config: cfg, db });
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 400 when body is missing username', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'pass' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when body is missing password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 when discoverAndValidate throws 401', async () => {
    vi.mocked(discoverAndValidate).mockRejectedValueOnce(new Error('Request failed with status 401'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('Incorrect username or password');
  });

  it('returns 502 on ECONNREFUSED', async () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    vi.mocked(discoverAndValidate).mockRejectedValueOnce(err);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'pass' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain('Baikal server');
  });

  it('returns 502 on unexpected Baikal response', async () => {
    vi.mocked(discoverAndValidate).mockRejectedValueOnce(new Error('Received HTML instead of XML'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'pass' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain('setup wizard');
  });

  it('returns 200 and sets a session cookie on success', async () => {
    vi.mocked(discoverAndValidate).mockResolvedValueOnce(DISCOVERY_RESULT);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'pass' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieStr).toContain(COOKIE_NAME);
  });
});

describe('POST /api/auth/logout', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.mocked(discoverAndValidate).mockReset();
    app = await buildApp(async (a, cfg, db) => {
      await a.register(authRoutes, { config: cfg, db });
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 when no session cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 204 and clears cookie with a valid session', async () => {
    // First, log in to get a session
    vi.mocked(discoverAndValidate).mockResolvedValueOnce(DISCOVERY_RESULT);
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'pass' },
    });
    const setCookie = loginRes.headers['set-cookie'];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(';')[0]!;

    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(logoutRes.statusCode).toBe(204);
  });
});
