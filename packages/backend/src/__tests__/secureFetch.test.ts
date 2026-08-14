import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The guard captures globalThis.fetch when its module body runs, so the stub it
// should delegate to has to be in place before the import below — the same seam
// tsdav itself sits on, and the reason the guard must load first in server.ts.
const { fetchMock } = vi.hoisted(() => {
  const fetchMock = vi.fn(async () => new Response('ok'));
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return { fetchMock };
});

import { setSecureTransportPolicy, isSecureTransportRequired } from '../lib/secureFetch.js';

describe('secureFetch transport guard', () => {
  beforeEach(() => {
    fetchMock.mockClear();
  });

  it('rejects plaintext http when the configured DAV base is https', async () => {
    setSecureTransportPolicy('https://dav.example.com/dav.php');
    expect(isSecureTransportRequired()).toBe(true);

    await expect(
      globalThis.fetch('http://dav.example.com/dav.php', { method: 'PROPFIND' }),
    ).rejects.toThrow(/plaintext http/i);

    // The point of the guard: the request never reached the network, so the
    // Authorization header never left the process.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks the downgrade regardless of host, since a hostile redirect picks the host', async () => {
    setSecureTransportPolicy('https://dav.example.com/dav.php');
    await expect(globalThis.fetch('http://attacker.example/collect')).rejects.toThrow(
      /plaintext http/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows https when the guard is enforcing', async () => {
    setSecureTransportPolicy('https://dav.example.com/dav.php');
    await globalThis.fetch('https://dav.example.com/dav.php');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('leaves plaintext usable when DAV_BASE_URL itself is http (local test stacks)', async () => {
    setSecureTransportPolicy('http://localhost:8801/dav.php');
    expect(isSecureTransportRequired()).toBe(false);

    await globalThis.fetch('http://localhost:8801/dav.php');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts URL and Request inputs, not just strings', async () => {
    setSecureTransportPolicy('https://dav.example.com/dav.php');

    await expect(globalThis.fetch(new URL('http://dav.example.com/x'))).rejects.toThrow(
      /plaintext http/i,
    );
    await expect(globalThis.fetch(new Request('http://dav.example.com/y'))).rejects.toThrow(
      /plaintext http/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The guard is only effective if it loads before tsdav, which server.ts
  // reaches transitively through almost every other import. Ordering is load-
  // bearing and invisible at runtime — a reordered import list would disable the
  // guard while every other test still passed.
  it('is the first import in server.ts', () => {
    const serverPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'server.ts',
    );
    const src = fs.readFileSync(serverPath, 'utf8');
    const firstImport = src.match(/^import .*$/m)?.[0] ?? '';
    expect(firstImport).toContain('secureFetch.js');
  });
});
