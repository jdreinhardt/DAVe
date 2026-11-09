import { describe, it, expect, vi, afterEach } from 'vitest';
import { isOidcEnabled, loadConfig } from '../config.js';

const BASE_ENV = {
  SESSION_SECRET: 'a-secret-that-is-at-least-32-chars!!',
  DATA_DIR: '/tmp/dave-config-test',
};

function load(env: Record<string, string>) {
  vi.stubEnv('NODE_ENV', 'test');
  for (const [k, v] of Object.entries({ ...BASE_ENV, ...env })) {
    vi.stubEnv(k, v);
  }
  return loadConfig();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('DAV_BASE_URL normalization', () => {
  it('accepts a Baikal-style URL with a path', () => {
    expect(load({ DAV_BASE_URL: 'https://dav.example.com/dav.php' }).DAV_BASE_URL).toBe(
      'https://dav.example.com/dav.php',
    );
  });

  it('accepts a Radicale-style root URL with no path', () => {
    expect(load({ DAV_BASE_URL: 'http://localhost:5232' }).DAV_BASE_URL).toBe(
      'http://localhost:5232',
    );
  });

  it('strips a trailing slash so collection URLs do not get a double slash', () => {
    // Collection URLs are built as `${base}/${id}/`; without this, Radicale's
    // root form would produce `http://localhost:5232//personal/`.
    expect(load({ DAV_BASE_URL: 'http://localhost:5232/' }).DAV_BASE_URL).toBe(
      'http://localhost:5232',
    );
    expect(load({ DAV_BASE_URL: 'https://dav.example.com/dav.php/' }).DAV_BASE_URL).toBe(
      'https://dav.example.com/dav.php',
    );
  });

  it('rejects a URL carrying a query string or fragment', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exited');
    }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => load({ DAV_BASE_URL: 'http://localhost:5232/?foo=1' })).toThrow('exited');
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('OIDC settings', () => {
  const OIDC_ENV = {
    DAV_BASE_URL: 'http://radicale:5232',
    OIDC_ISSUER_URL: 'https://idp.example.com/app/',
    OIDC_CLIENT_ID: 'dave',
    OIDC_REDIRECT_URI: 'https://dave.example.com/api/auth/oidc/callback',
  };

  function expectExit(env: Record<string, string>) {
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exited');
    }) as never);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => load(env)).toThrow('exited');
    return String(errors.mock.calls[0]?.[0]);
  }

  it('is off by default, with the remote-user defaults filled in', () => {
    const cfg = load({ DAV_BASE_URL: 'http://localhost:5232' });
    expect(isOidcEnabled(cfg)).toBe(false);
    expect(cfg.DAV_REMOTE_USER_HEADER).toBe('X-Remote-User');
    expect(cfg.OIDC_USERNAME_CLAIM).toBe('preferred_username');
  });

  it('treats an empty OIDC_ISSUER_URL as unset', () => {
    // Compose passes declared-but-empty variables through as ''.
    expect(isOidcEnabled(load({ DAV_BASE_URL: 'http://localhost:5232', OIDC_ISSUER_URL: '' }))).toBe(
      false,
    );
  });

  it('is enabled by a complete OIDC configuration', () => {
    expect(isOidcEnabled(load(OIDC_ENV))).toBe(true);
  });

  it.each(['OIDC_CLIENT_ID', 'OIDC_REDIRECT_URI'])('requires %s once an issuer is set', (key) => {
    const msg = expectExit({ ...OIDC_ENV, [key]: '' });
    expect(msg).toContain(`${key} is required`);
  });

  it('requires the openid scope', () => {
    expect(expectExit({ ...OIDC_ENV, OIDC_SCOPES: 'profile email' })).toContain('openid');
  });

  it('rejects a header name that could smuggle extra headers', () => {
    expect(expectExit({ ...OIDC_ENV, DAV_REMOTE_USER_HEADER: 'X-User: admin\r\nX' })).toContain(
      'DAV_REMOTE_USER_HEADER',
    );
  });
});
