import { describe, it, expect, vi, beforeEach } from 'vitest';

// tsdav binds globalThis.fetch at module-init time, so the stub has to be
// installed before the import of ../lib/dav.js pulls tsdav in.
const { fetchMock } = vi.hoisted(() => {
  const fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return { fetchMock };
});

import { initDavBase, deleteContact, discoverWithRemoteUser } from '../lib/dav.js';
import type { SessionData } from '../services/session.js';
import { testConfig } from './helpers.js';

const base: SessionData = {
  username: 'alice',
  password: 'pw',
  displayName: 'Alice',
  principalUrl: 'http://dav.test/dav.php/principals/alice',
  calendarHomeUrl: 'http://dav.test/dav.php/cal/alice/',
  addressBookHomeUrl: 'http://dav.test/dav.php/ab/alice/',
};

function sentHeaders(call = 0): Headers {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  return new Headers(init?.headers);
}

beforeEach(() => {
  initDavBase(testConfig);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(null, { status: 204 }));
});

describe('DAV request authentication', () => {
  it('sends Basic auth for password sessions, including pre-OIDC ones without authMode', async () => {
    await deleteContact(base, 'contacts', 'c1', '"e"', testConfig);
    const headers = sentHeaders();
    expect(headers.get('authorization')).toMatch(/^Basic /);
    expect(headers.has('x-remote-user')).toBe(false);
  });

  it('sends only the remote-user header for OIDC sessions', async () => {
    // The header-trusting DAV server must see exactly one identity, and no
    // password (there is none) may leak through as an empty Basic credential.
    await deleteContact(
      { ...base, password: '', authMode: 'remote-user' },
      'contacts',
      'c1',
      '"e"',
      testConfig,
    );
    const headers = sentHeaders();
    expect(headers.get('x-remote-user')).toBe('alice');
    expect(headers.has('authorization')).toBe(false);
  });

  it('uses the configured header name', async () => {
    initDavBase({ ...testConfig, DAV_REMOTE_USER_HEADER: 'X-Forwarded-User' });
    await deleteContact(
      { ...base, password: '', authMode: 'remote-user' },
      'contacts',
      'c1',
      '"e"',
      testConfig,
    );
    const headers = sentHeaders();
    expect(headers.get('x-forwarded-user')).toBe('alice');
    expect(headers.has('x-remote-user')).toBe(false);
  });

  it('authenticates discovery with the remote-user header', async () => {
    fetchMock.mockRejectedValue(new Error('stop after first request'));
    await expect(discoverWithRemoteUser('alice', testConfig)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalled();
    for (let i = 0; i < fetchMock.mock.calls.length; i++) {
      const headers = sentHeaders(i);
      expect(headers.get('x-remote-user')).toBe('alice');
      expect(headers.has('authorization')).toBe(false);
    }
  });
});
