import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildIntegrationApp, loginAndGetCookie, TEST_USER, TEST_PASS } from './setup.js';
import { COOKIE_NAME } from '../../plugins/session.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

describe('POST /api/auth/login', () => {
  it('returns 200 and sets a session cookie with correct credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: TEST_USER, password: TEST_PASS },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieStr).toContain(COOKIE_NAME);
  });

  it('returns 401 with wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: TEST_USER, password: 'definitley-wrong-password' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 with empty body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/me', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with the authenticated user info', async () => {
    const cookie = await loginAndGetCookie(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().username).toBe(TEST_USER);
    expect(typeof res.json().displayName).toBe('string');
    expect(typeof res.json().principalUrl).toBe('string');
  });
});

describe('POST /api/auth/logout', () => {
  it('returns 204 and invalidates the session', async () => {
    const cookie = await loginAndGetCookie(app);

    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
    });
    expect(logoutRes.statusCode).toBe(204);

    // The same cookie should no longer work
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie },
    });
    expect(meRes.statusCode).toBe(401);
  });
});
