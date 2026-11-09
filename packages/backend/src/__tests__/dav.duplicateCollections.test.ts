import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Same seam as dav.syncToken.test.ts: stub globalThis.fetch before ../lib/dav.js
// pulls tsdav in, so the real request/parse path runs.
const { fetchMock } = vi.hoisted(() => {
  const fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return { fetchMock };
});

import { initDavBase, listAddressBooks, listCalendars } from '../lib/dav.js';
import type { SessionData } from '../services/session.js';
import { makeDb, testConfig } from './helpers.js';

initDavBase(testConfig);

const session: SessionData = {
  username: 'alice',
  password: 'pw',
  displayName: 'Alice',
  principalUrl: 'http://dav.test/dav.php/principals/alice',
  calendarHomeUrl: 'http://dav.test/dav.php/cal/alice/',
  addressBookHomeUrl: 'http://dav.test/dav.php/ab/alice/',
};

function xml(body: string): Response {
  return new Response(body, {
    status: 207,
    statusText: 'Multi-Status',
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
}

/**
 * A store holding several rows for one URI reports the same href repeatedly,
 * differing only in ctag/sync-token. Baikal does this when its `addressbooks`
 * table (which has no UNIQUE on principaluri+uri) accumulates duplicate rows.
 */
const DUPLICATE_ADDRESSBOOKS = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:response>
    <d:href>/dav.php/ab/alice/contacts/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Contacts</d:displayname>
        <cs:getctag>75</cs:getctag>
        <d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>
        <d:sync-token>http://sabre.io/ns/sync/75</d:sync-token>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav.php/ab/alice/contacts/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Contacts</d:displayname>
        <cs:getctag>1</cs:getctag>
        <d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>
        <d:sync-token>http://sabre.io/ns/sync/1</d:sync-token>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav.php/ab/alice/work/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Work</d:displayname>
        <cs:getctag>4</cs:getctag>
        <d:resourcetype><d:collection/><card:addressbook/></d:resourcetype>
        <d:sync-token>http://sabre.io/ns/sync/4</d:sync-token>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

const DUPLICATE_CALENDARS = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/dav.php/cal/alice/personal/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Personal</d:displayname>
        <cs:getctag>9</cs:getctag>
        <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
        <d:sync-token>http://sabre.io/ns/sync/9</d:sync-token>
        <cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav.php/cal/alice/personal/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Personal</d:displayname>
        <cs:getctag>2</cs:getctag>
        <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
        <d:sync-token>http://sabre.io/ns/sync/2</d:sync-token>
        <cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

describe('collection listings collapse duplicate hrefs', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('returns one address book per id when the server repeats an href', async () => {
    // A Response body reads once, and tsdav may issue several requests.
    fetchMock.mockImplementation(() => Promise.resolve(xml(DUPLICATE_ADDRESSBOOKS)));

    const books = await listAddressBooks(session, testConfig, makeDb());

    expect(books.map((b) => b.id)).toEqual(['contacts', 'work']);
    // First occurrence wins, so the surviving row keeps the leading sync-token.
    expect(books[0]?.syncToken).toBe('http://sabre.io/ns/sync/75');
  });

  it('returns one calendar per id when the server repeats an href', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(xml(DUPLICATE_CALENDARS)));

    const cals = await listCalendars(session, testConfig);

    expect(cals.map((c) => c.id)).toEqual(['personal']);
  });
});
