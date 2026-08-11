import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// These tests drive the real tsdav code path by stubbing global fetch rather than
// mocking tsdav itself. The bug they guard against lives precisely in that seam:
// tsdav's davRequest returns `{ ok: false, status, raw: <string> }` for any non-2xx
// reply, which looks identical to "no changes" to a naive caller.
//
// tsdav binds `globalThis.fetch` once, at module-init time (`const fetch =
// resolveFetch()`), so the stub has to be installed before the import of
// ../lib/dav.js pulls tsdav in. vi.hoisted runs ahead of the import block;
// vi.stubGlobal in a beforeEach would be too late to be seen.
const { fetchMock } = vi.hoisted(() => {
  const fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return { fetchMock };
});

import {
  SyncTokenInvalidError,
  syncAddressBook,
  syncCalendar,
  syncCalendarForCache,
} from '../lib/dav.js';
import type { SessionData } from '../services/session.js';
import { testConfig } from './helpers.js';

const session: SessionData = {
  username: 'alice',
  password: 'pw',
  displayName: 'Alice',
  principalUrl: 'http://dav.test/dav.php/principals/alice',
  calendarHomeUrl: 'http://dav.test/dav.php/cal/alice/',
  addressBookHomeUrl: 'http://dav.test/dav.php/ab/alice/',
};

// RFC 6578 §3.2: the server no longer recognises the token.
const INVALID_TOKEN_BODY = `<?xml version="1.0" encoding="utf-8"?>
<D:error xmlns:D="DAV:"><D:valid-sync-token/></D:error>`;

function xmlResponse(body: string, status = 207): Response {
  return new Response(body, {
    status,
    statusText: status === 207 ? 'Multi-Status' : 'Forbidden',
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
}

/** A sync-collection multistatus listing one member plus a fresh token. */
function multistatus(href: string, token: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${href}</D:href>
    <D:propstat>
      <D:prop><D:getetag>"etag-1"</D:getetag></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:sync-token>${token}</D:sync-token>
</D:multistatus>`;
}

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Bodies of the REPORT requests fetchMock received, in order. */
function reportBodies(): string[] {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'REPORT')
    .map(([, init]) => String(init?.body ?? ''));
}

describe('sync-collection token rejection', () => {
  it('syncCalendarForCache throws SyncTokenInvalidError on 403 valid-sync-token', async () => {
    fetchMock.mockResolvedValueOnce(xmlResponse(INVALID_TOKEN_BODY, 403));

    await expect(
      syncCalendarForCache(session, 'http://dav.test/dav.php/cal/alice/personal/', 'stale', testConfig),
    ).rejects.toBeInstanceOf(SyncTokenInvalidError);
  });

  it('does not silently report "no changes" when the token is rejected', async () => {
    // The regression this whole change exists for: before the fix this resolved
    // with the *old* token and empty deltas, so the collection stopped updating
    // forever and nothing ever surfaced an error.
    fetchMock.mockResolvedValueOnce(xmlResponse(INVALID_TOKEN_BODY, 403));

    const result = await syncCalendarForCache(
      session,
      'http://dav.test/dav.php/cal/alice/personal/',
      'stale',
      testConfig,
    ).catch((e) => e);

    expect(result).toBeInstanceOf(SyncTokenInvalidError);
  });

  it('syncCalendar recovers with an empty token and forces dirty', async () => {
    fetchMock
      .mockResolvedValueOnce(xmlResponse(INVALID_TOKEN_BODY, 403))
      .mockResolvedValueOnce(
        xmlResponse(multistatus('/dav.php/cal/alice/personal/e1.ics', 'token-new')),
      );

    const res = await syncCalendar(session, 'personal', 'stale', testConfig);

    expect(res.syncToken).toBe('token-new');
    expect(res.dirty).toBe(true);

    // The retry must send an *empty* sync-token — RFC 6578's "send me everything".
    const bodies = reportBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain('stale');
    expect(bodies[1]).not.toContain('stale');
  });

  it('syncAddressBook recovers and flags the result as full', async () => {
    const vcard = 'BEGIN:VCARD\r\nVERSION:3.0\r\nUID:c1\r\nFN:Bob\r\nEND:VCARD';
    fetchMock
      .mockResolvedValueOnce(xmlResponse(INVALID_TOKEN_BODY, 403))
      .mockResolvedValueOnce(
        xmlResponse(multistatus('/dav.php/ab/alice/contacts/c1.vcf', 'token-new')),
      )
      // addressbook-multiget for the changed href
      .mockResolvedValueOnce(
        xmlResponse(`<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>/dav.php/ab/alice/contacts/c1.vcf</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"etag-1"</D:getetag>
        <C:address-data>${vcard}</C:address-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`),
      );

    const res = await syncAddressBook(session, 'contacts', 'stale', testConfig);

    expect(res.full).toBe(true);
    expect(res.syncToken).toBe('token-new');
    expect(res.changed.map((c) => c.id)).toEqual(['c1']);
  });

  it('marks a normal delta as not full and advances the token', async () => {
    fetchMock
      .mockResolvedValueOnce(
        xmlResponse(multistatus('/dav.php/ab/alice/contacts/c1.vcf', 'token-2')),
      )
      .mockResolvedValueOnce(
        xmlResponse(`<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>/dav.php/ab/alice/contacts/c1.vcf</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"etag-1"</D:getetag>
        <C:address-data>BEGIN:VCARD\r\nVERSION:3.0\r\nUID:c1\r\nFN:Bob\r\nEND:VCARD</C:address-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`),
      );

    const res = await syncAddressBook(session, 'contacts', 'token-1', testConfig);

    expect(res.full).toBe(false);
    expect(res.syncToken).toBe('token-2');
  });

  it('keeps the previous token when the REPORT reports no changes', async () => {
    // Documents a tsdav limitation rather than desired behaviour: an empty
    // multistatus has no <D:response>, so tsdav returns a synthetic entry with no
    // `raw`, and the new token is unrecoverable. Holding the old token keeps sync
    // correct (the server still accepts it) but means an idle collection's token
    // never advances — see extractSyncToken in lib/dav.ts.
    fetchMock.mockResolvedValueOnce(
      xmlResponse(`<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:"><D:sync-token>token-2</D:sync-token></D:multistatus>`),
    );

    const res = await syncAddressBook(session, 'contacts', 'token-1', testConfig);

    expect(res.full).toBe(false);
    expect(res.changed).toEqual([]);
    expect(res.syncToken).toBe('token-1');
  });

  it('surfaces non-token errors instead of treating them as a stale token', async () => {
    fetchMock.mockResolvedValueOnce(xmlResponse('<D:error xmlns:D="DAV:"/>', 500));

    const err = await syncCalendarForCache(
      session,
      'http://dav.test/dav.php/cal/alice/personal/',
      'tok',
      testConfig,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SyncTokenInvalidError);
    expect(String(err.message)).toContain('500');
  });
});
