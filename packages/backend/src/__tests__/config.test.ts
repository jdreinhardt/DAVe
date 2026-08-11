import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadConfig } from '../config.js';

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
