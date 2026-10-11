import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, makeDb, testConfig, TEST_SECRET } from './helpers.js';
import { oidcRoutes, OIDC_COOKIE_NAME } from '../routes/oidc.js';
import { authRoutes } from '../routes/auth.js';
import { COOKIE_NAME } from '../plugins/session.js';
import { encrypt } from '../lib/crypto.js';
import { getSession } from '../services/session.js';
import type { Config } from '../config.js';
import type { DbInstance } from '../db/index.js';

vi.mock('../lib/dav.js', () => ({
  discoverAndValidate: vi.fn(),
  discoverWithRemoteUser: vi.fn(),
}));

vi.mock('../lib/oidc.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/oidc.js')>();
  return {
    ...actual,
    beginAuthorization: vi.fn(),
    completeAuthorization: vi.fn(),
    endSessionUrl: vi.fn(),
  };
});

import { discoverAndValidate, discoverWithRemoteUser } from '../lib/dav.js';
import {
  beginAuthorization,
  completeAuthorization,
  endSessionUrl,
  OidcIdentityError,
  type OidcTransaction,
} from '../lib/oidc.js';

const oidcConfig: Config = {
  ...testConfig,
  OIDC_ISSUER_URL: 'https://idp.test/app/',
  OIDC_CLIENT_ID: 'dave',
  OIDC_REDIRECT_URI: 'https://dave.test/api/auth/oidc/callback',
};

const DISCOVERY_RESULT = {
  displayName: 'alice',
  principalUrl: 'http://dav.test/dav.php/principals/alice',
  calendarHomeUrl: 'http://dav.test/dav.php/cal/alice/',
  addressBookHomeUrl: 'http://dav.test/dav.php/ab/alice/',
};

function transaction(overrides: Partial<OidcTransaction> = {}): OidcTransaction {
  return { state: 's1', nonce: 'n1', codeVerifier: 'v1', createdAt: Date.now(), ...overrides };
}

function transactionCookie(t: OidcTransaction): string {
  return `${OIDC_COOKIE_NAME}=${encrypt(JSON.stringify(t), TEST_SECRET)}`;
}

function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
}

async function build(config: Config, db: DbInstance = makeDb()) {
  return buildApp(async (a, _cfg, d) => {
    await a.register(authRoutes, { config, db: d });
    await a.register(oidcRoutes, { config, db: d });
  }, db);
}

beforeEach(() => {
  vi.mocked(beginAuthorization).mockReset();
  vi.mocked(completeAuthorization).mockReset();
  vi.mocked(endSessionUrl).mockReset();
  vi.mocked(discoverAndValidate).mockReset();
  vi.mocked(discoverWithRemoteUser).mockReset();
});

describe('OIDC routes', () => {
  let app: FastifyInstance;
  let db: DbInstance;

  beforeEach(async () => {
    db = makeDb();
    app = await build(oidcConfig, db);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/auth/oidc/login', () => {
    it('redirects to the provider and stores the transaction in a scoped cookie', async () => {
      vi.mocked(beginAuthorization).mockResolvedValueOnce({
        url: new URL('https://idp.test/authorize?client_id=dave'),
        transaction: transaction(),
      });
      const res = await app.inject({ method: 'GET', url: '/api/auth/oidc/login' });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('https://idp.test/authorize?client_id=dave');
      const cookie = setCookies(res).find((c) => c.startsWith(`${OIDC_COOKIE_NAME}=`));
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Path=/api/auth/oidc');
      expect(cookie).toContain('SameSite=Lax');
      // Encrypted: nothing of the PKCE verifier or nonce readable client-side.
      expect(cookie).not.toContain('v1');
    });

    it('sends the user to the login page with an error when the provider is unreachable', async () => {
      vi.mocked(beginAuthorization).mockRejectedValueOnce(new Error('discovery failed'));
      const res = await app.inject({ method: 'GET', url: '/api/auth/oidc/login' });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/login?error=oidc_failed');
    });
  });

  describe('GET /api/auth/oidc/callback', () => {
    const callback = (cookie?: string) =>
      app.inject({
        method: 'GET',
        url: '/api/auth/oidc/callback?code=abc&state=s1',
        headers: cookie ? { cookie } : {},
      });

    it('creates a remote-user session for the verified username', async () => {
      const t = transaction();
      vi.mocked(completeAuthorization).mockResolvedValueOnce({
        username: 'alice',
        displayName: 'Alice A.',
      });
      vi.mocked(discoverWithRemoteUser).mockResolvedValueOnce(DISCOVERY_RESULT);

      const res = await callback(transactionCookie(t));

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/');
      expect(vi.mocked(completeAuthorization)).toHaveBeenCalledWith(
        oidcConfig,
        '?code=abc&state=s1',
        t,
      );
      expect(vi.mocked(discoverWithRemoteUser)).toHaveBeenCalledWith('alice', oidcConfig);

      const sessionCookie = setCookies(res).find((c) => c.startsWith(`${COOKIE_NAME}=`))!;
      const sessionId = sessionCookie.split(';')[0]!.slice(COOKIE_NAME.length + 1);
      const session = getSession(sessionId, TEST_SECRET, 1, db);
      expect(session).toMatchObject({
        username: 'alice',
        password: '',
        authMode: 'remote-user',
        displayName: 'Alice A.',
      });
      // The single-use transaction cookie is cleared.
      expect(setCookies(res).some((c) => c.startsWith(`${OIDC_COOKIE_NAME}=;`))).toBe(true);
    });

    it.each([
      ['missing', undefined],
      ['tampered', `${OIDC_COOKIE_NAME}=not-a-valid-ciphertext`],
      ['expired', transactionCookie(transaction({ createdAt: Date.now() - 11 * 60_000 }))],
    ])('rejects a %s transaction cookie without contacting the provider', async (_label, cookie) => {
      const res = await callback(cookie);
      expect(res.headers.location).toBe('/login?error=oidc_failed');
      expect(vi.mocked(completeAuthorization)).not.toHaveBeenCalled();
    });

    it('reports a failed code exchange (bad state, denied consent, …)', async () => {
      vi.mocked(completeAuthorization).mockRejectedValueOnce(new Error('unexpected "state"'));
      const res = await callback(transactionCookie(transaction()));
      expect(res.headers.location).toBe('/login?error=oidc_failed');
      expect(setCookies(res).some((c) => c.startsWith(`${COOKIE_NAME}=`))).toBe(false);
    });

    it('reports an identity without a usable username separately', async () => {
      vi.mocked(completeAuthorization).mockRejectedValueOnce(new OidcIdentityError('no claim'));
      const res = await callback(transactionCookie(transaction()));
      expect(res.headers.location).toBe('/login?error=oidc_identity');
    });

    it.each([
      ['dav_denied', new Error('Request failed with status 401')],
      ['dav_unavailable', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })],
    ])('maps DAV discovery failures to %s', async (code, err) => {
      vi.mocked(completeAuthorization).mockResolvedValueOnce({ username: 'alice', displayName: 'alice' });
      vi.mocked(discoverWithRemoteUser).mockRejectedValueOnce(err);
      const res = await callback(transactionCookie(transaction()));
      expect(res.headers.location).toBe(`/login?error=${code}`);
      expect(setCookies(res).some((c) => c.startsWith(`${COOKIE_NAME}=`))).toBe(false);
    });
  });

  describe('auth routes in OIDC mode', () => {
    it('advertises the OIDC flow', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/config' });
      expect(res.json()).toEqual({ mode: 'oidc' });
    });

    it('refuses password sign-in', async () => {
      // The DAV server trusts DAVe's header in this mode, so a password check
      // against it would be meaningless.
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'alice', password: 'pw' },
      });
      expect(res.statusCode).toBe(403);
      expect(vi.mocked(discoverAndValidate)).not.toHaveBeenCalled();
    });

    it('returns the provider end-session URL on logout', async () => {
      vi.mocked(completeAuthorization).mockResolvedValueOnce({ username: 'alice', displayName: 'alice' });
      vi.mocked(discoverWithRemoteUser).mockResolvedValueOnce(DISCOVERY_RESULT);
      vi.mocked(endSessionUrl).mockResolvedValueOnce('https://idp.test/end-session?client_id=dave');
      const login = await app.inject({
        method: 'GET',
        url: '/api/auth/oidc/callback?code=abc&state=s1',
        headers: { cookie: transactionCookie(transaction()) },
      });
      const cookie = setCookies(login)
        .find((c) => c.startsWith(`${COOKIE_NAME}=`))!
        .split(';')[0]!;

      const res = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ redirectUrl: 'https://idp.test/end-session?client_id=dave' });
    });
  });
});

describe('OIDC disabled', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await build(testConfig);
  });

  afterEach(async () => {
    await app.close();
  });

  it('does not register the OIDC routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/oidc/login' });
    expect(res.statusCode).toBe(404);
  });

  it('advertises password sign-in', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/config' });
    expect(res.json()).toEqual({ mode: 'password' });
  });
});
