import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('openid-client', () => ({
  discovery: vi.fn(),
  ClientSecretPost: vi.fn(() => 'client-secret-post'),
  None: vi.fn(() => 'none'),
  randomState: () => 'state',
  randomNonce: () => 'nonce',
  randomPKCECodeVerifier: () => 'verifier',
  calculatePKCECodeChallenge: async () => 'challenge',
  buildAuthorizationUrl: vi.fn(() => new URL('https://idp.test/authorize')),
  authorizationCodeGrant: vi.fn(),
  fetchUserInfo: vi.fn(),
  buildEndSessionUrl: vi.fn((_c, params: Record<string, string>) => {
    const url = new URL('https://idp.test/end-session');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url;
  }),
}));

import * as client from 'openid-client';
import {
  beginAuthorization,
  completeAuthorization,
  endSessionUrl,
  isSafeUsername,
  OidcIdentityError,
  resetOidcConfiguration,
} from '../lib/oidc.js';
import { testConfig } from './helpers.js';
import type { Config } from '../config.js';

const config: Config = {
  ...testConfig,
  OIDC_ISSUER_URL: 'https://idp.test/app/',
  OIDC_CLIENT_ID: 'dave',
  OIDC_CLIENT_SECRET: 'secret',
  OIDC_REDIRECT_URI: 'https://dave.test/api/auth/oidc/callback',
};

const transaction = { state: 'state', nonce: 'nonce', codeVerifier: 'verifier', createdAt: 0 };

let endSessionEndpoint: string | undefined;
const fakeConfiguration = {
  serverMetadata: () => ({ end_session_endpoint: endSessionEndpoint }),
};

function grantReturning(claims: Record<string, unknown>) {
  vi.mocked(client.authorizationCodeGrant).mockResolvedValueOnce({
    access_token: 'at',
    claims: () => ({ sub: 'sub-1', ...claims }),
  } as unknown as Awaited<ReturnType<typeof client.authorizationCodeGrant>>);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetOidcConfiguration();
  endSessionEndpoint = 'https://idp.test/end-session';
  vi.mocked(client.discovery).mockResolvedValue(
    fakeConfiguration as unknown as client.Configuration,
  );
});

describe('beginAuthorization', () => {
  it('requests the code flow with PKCE S256, state and nonce on the configured redirect URI', async () => {
    const { transaction: t } = await beginAuthorization(config);
    expect(t).toMatchObject({ state: 'state', nonce: 'nonce', codeVerifier: 'verifier' });
    expect(vi.mocked(client.buildAuthorizationUrl)).toHaveBeenCalledWith(fakeConfiguration, {
      redirect_uri: config.OIDC_REDIRECT_URI,
      scope: 'openid profile email',
      state: 'state',
      nonce: 'nonce',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
    });
  });

  it('authenticates as a public client when no secret is configured', async () => {
    await beginAuthorization({ ...config, OIDC_CLIENT_SECRET: undefined });
    expect(vi.mocked(client.discovery).mock.calls[0]![3]).toBe('none');
  });

  it('retries discovery after a failure instead of caching it', async () => {
    vi.mocked(client.discovery).mockRejectedValueOnce(new Error('idp down'));
    await expect(beginAuthorization(config)).rejects.toThrow('idp down');
    await expect(beginAuthorization(config)).resolves.toBeDefined();
    expect(vi.mocked(client.discovery)).toHaveBeenCalledTimes(2);
  });
});

describe('completeAuthorization', () => {
  it('builds the callback URL from the configured redirect URI, not the request', async () => {
    grantReturning({ preferred_username: 'alice' });
    await completeAuthorization(config, '?code=abc&state=state', transaction);
    const [, url, checks] = vi.mocked(client.authorizationCodeGrant).mock.calls[0]!;
    expect(String(url)).toBe('https://dave.test/api/auth/oidc/callback?code=abc&state=state');
    expect(checks).toEqual({
      pkceCodeVerifier: 'verifier',
      expectedState: 'state',
      expectedNonce: 'nonce',
      idTokenExpected: true,
    });
  });

  it('takes the username and display name from the ID token', async () => {
    grantReturning({ preferred_username: 'alice', name: 'Alice A.' });
    await expect(completeAuthorization(config, '', transaction)).resolves.toEqual({
      username: 'alice',
      displayName: 'Alice A.',
    });
    expect(vi.mocked(client.fetchUserInfo)).not.toHaveBeenCalled();
  });

  it('falls back to userinfo when the ID token lacks the username claim', async () => {
    grantReturning({});
    vi.mocked(client.fetchUserInfo).mockResolvedValueOnce({
      sub: 'sub-1',
      preferred_username: 'alice',
    });
    const identity = await completeAuthorization(config, '', transaction);
    expect(identity).toEqual({ username: 'alice', displayName: 'alice' });
    expect(vi.mocked(client.fetchUserInfo)).toHaveBeenCalledWith(fakeConfiguration, 'at', 'sub-1');
  });

  it('honors a custom username claim', async () => {
    grantReturning({ preferred_username: 'alice', radicale_user: 'tomas' });
    const identity = await completeAuthorization(
      { ...config, OIDC_USERNAME_CLAIM: 'radicale_user' },
      '',
      transaction,
    );
    expect(identity.username).toBe('tomas');
  });

  it.each([
    ['missing', undefined],
    ['non-string', 42],
    ['path-like', '../bob'],
  ])('rejects a %s username claim', async (_label, value) => {
    grantReturning({ preferred_username: value });
    vi.mocked(client.fetchUserInfo).mockResolvedValueOnce({ sub: 'sub-1' });
    await expect(completeAuthorization(config, '', transaction)).rejects.toBeInstanceOf(
      OidcIdentityError,
    );
  });
});

describe('isSafeUsername', () => {
  it.each(['alice', 'alice@example.com', 'Tomáš Novák', 'a.b-c_d'])('accepts %j', (v) => {
    expect(isSafeUsername(v)).toBe(true);
  });

  it.each(['', '.', '..', 'a/b', 'a\\b', 'alice\r\nX-Remote-User: admin', 'a\u0000', 'x'.repeat(257)])(
    'rejects %j',
    (v) => {
      expect(isSafeUsername(v)).toBe(false);
    },
  );
});

describe('endSessionUrl', () => {
  it('includes the client id and the post-logout redirect when configured', async () => {
    const url = new URL(
      (await endSessionUrl({
        ...config,
        OIDC_POST_LOGOUT_REDIRECT_URI: 'https://dave.test/login?signedOut',
      }))!,
    );
    expect(url.searchParams.get('client_id')).toBe('dave');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://dave.test/login?signedOut');
  });

  it('returns null when the provider has no end-session endpoint', async () => {
    endSessionEndpoint = undefined;
    await expect(endSessionUrl(config)).resolves.toBeNull();
  });
});
