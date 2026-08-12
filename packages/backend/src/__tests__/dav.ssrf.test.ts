import { describe, it, expect, vi, beforeEach } from 'vitest';

// tsdav binds globalThis.fetch at module-init time, so the stub has to be
// installed before the import of ../lib/dav.js pulls tsdav in (see
// dav.syncToken.test.ts for the same seam).
const { fetchMock } = vi.hoisted(() => {
  const fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return { fetchMock };
});

import {
  initDavBase,
  assertDavTarget,
  createContact,
  updateContact,
  deleteContact,
  fetchContacts,
  createTask,
  createJournal,
  syncAddressBook,
  updateAddressBook,
  deleteAddressBook,
  updateCalendar,
  deleteCalendar,
} from '../lib/dav.js';
import type { SessionData } from '../services/session.js';
import type { ContactJson, TaskJson, NoteJson } from '@dave/shared';
import { testConfig } from './helpers.js';

// testConfig.DAV_BASE_URL is http://dav.test/dav.php — a path-served base, the
// shape that makes an origin-only check insufficient.
initDavBase(testConfig);

const session: SessionData = {
  username: 'alice',
  password: 'pw',
  displayName: 'Alice',
  principalUrl: 'http://dav.test/dav.php/principals/alice',
  calendarHomeUrl: 'http://dav.test/dav.php/cal/alice/',
  addressBookHomeUrl: 'http://dav.test/dav.php/ab/alice/',
};

const contact: ContactJson = {
  uid: 'u1',
  version: '4.0',
  name: { prefix: '', given: 'Bob', middle: '', family: 'Smith', suffix: '' },
  fullName: 'Bob Smith',
  nickname: '',
  organization: '',
  title: '',
  phones: [],
  emails: [],
  addresses: [],
  urls: [],
  birthday: null,
  anniversary: null,
  note: '',
  photo: null,
  customFields: [],
};

const task: TaskJson = {
  uid: 't1',
  summary: 'T',
  description: '',
  status: null,
  priority: null,
  dtstart: null,
  due: null,
  completed: null,
  percentComplete: null,
  lastModified: null,
  categories: [],
  relations: [],
  collectionUrl: '',
  alarms: [],
  rrule: null,
};

const note: NoteJson = {
  uid: 'n1',
  summary: 'N',
  description: '',
  dtstart: null,
  lastModified: null,
  categories: [],
  relations: [],
  collectionUrl: '',
};

function okResponse(): Response {
  return new Response('', { status: 200, headers: { ETag: '"e1"' } });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(okResponse());
});

/** The URL every stubbed fetch was called with. */
function calledUrls(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0]));
}

describe('collection/object id path traversal', () => {
  // Fastify percent-decodes route params, so `..%2F..%2F` reaches the DAV layer
  // as `../../`. Without encoding, fetch() resolves those segments and the
  // request escapes the user's home set with the Authorization header attached.
  const traversals = ['../../../admin', '..', '.', 'a/b', 'a\\b', ''];

  it.each(traversals)('rejects %j as an address book id without issuing a request', async (id) => {
    await expect(createContact(session, id, contact, testConfig)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(traversals)('rejects %j as a contact id without issuing a request', async (id) => {
    await expect(
      updateContact(session, 'default', id, contact, '"e"', testConfig),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a traversing id on delete', async () => {
    await expect(
      deleteContact(session, '../../../admin', 'c1', '"e"', testConfig),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects traversal on the tsdav-backed read path, which never reaches davFetch', async () => {
    await expect(fetchContacts(session, '../../../admin', testConfig)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects traversal on the sync path', async () => {
    await expect(
      syncAddressBook(session, '../../../admin', '', testConfig),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still builds the expected URL for an ordinary id', async () => {
    await createContact(session, 'default', contact, testConfig);
    expect(calledUrls()).toEqual(['http://dav.test/dav.php/ab/alice/default/u1.vcf']);
  });

  it('percent-encodes an id with URL-significant characters rather than passing it through', async () => {
    await createContact(session, 'my books', contact, testConfig);
    expect(calledUrls()[0]).toBe('http://dav.test/dav.php/ab/alice/my%20books/u1.vcf');
  });

  // Ids arrive both decoded (Fastify route params) and still encoded
  // (collectionId slices a URL pathname). Encoding unconditionally double-encodes
  // the second form, so a collection named "my books" 404s. Both forms must land
  // on the same URL.
  describe('encoding is idempotent across both id sources', () => {
    const cases: [string, string, string][] = [
      ['my books', 'my%20books', 'my%20books'],
      ['café', 'caf%C3%A9', 'caf%C3%A9'],
      ['a+b', 'a%2Bb', 'a%2Bb'],
      ['100%', '100%25', '100%25'],
      ['personal', 'personal', 'personal'],
    ];

    it.each(cases)('decoded %j and encoded %j both target %s', async (decoded, encoded, expected) => {
      fetchMock.mockClear();
      await createContact(session, decoded, contact, testConfig);
      await createContact(session, encoded, contact, testConfig);
      const urls = calledUrls();
      expect(urls[0]).toBe(`http://dav.test/dav.php/ab/alice/${expected}/u1.vcf`);
      expect(urls[1]).toBe(urls[0]);
    });
  });
});

describe('assertDavTarget on client-supplied collection URLs', () => {
  it('rejects a different host', async () => {
    await expect(
      createTask(session, 'http://evil.test/dav.php/cal/alice/', task, testConfig),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects link-local metadata addresses', async () => {
    await expect(
      createTask(session, 'http://169.254.169.254/latest/meta-data/', task, testConfig),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-http scheme', async () => {
    await expect(createTask(session, 'file:///etc/passwd', task, testConfig)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The case an origin-only check would let through: same host, different app
  // behind the same reverse proxy.
  it('rejects a same-origin URL outside the configured base path', async () => {
    await expect(
      createJournal(session, 'http://dav.test/some-other-app/', note, testConfig),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a path that only prefix-matches the base as a string', async () => {
    await expect(
      createJournal(session, 'http://dav.test/dav.php-evil/', note, testConfig),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a collection URL inside the base path', async () => {
    await createJournal(session, 'http://dav.test/dav.php/cal/alice/', note, testConfig);
    expect(calledUrls()).toEqual(['http://dav.test/dav.php/cal/alice/n1.ics']);
  });
});

// The collection-management writes are the case assertDavTarget cannot cover on
// its own: `../bob` from alice's home set stays under the configured base path,
// so only the segment check stops it — and two of these issue a DELETE.
describe('collection management ids', () => {
  const abReq = { displayName: 'X', description: '' } as never;
  const calReq = { displayName: 'X', description: '', color: '#000000' } as never;
  const sneaky = '../bob';

  it('rejects a sibling-home-set traversal on updateAddressBook', async () => {
    await expect(
      updateAddressBook(session, sneaky, abReq, testConfig),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a sibling-home-set traversal on deleteAddressBook', async () => {
    await expect(deleteAddressBook(session, sneaky, testConfig)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a sibling-home-set traversal on updateCalendar', async () => {
    await expect(updateCalendar(session, sneaky, calReq, testConfig)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a sibling-home-set traversal on deleteCalendar', async () => {
    await expect(deleteCalendar(session, sneaky, testConfig)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still targets the right collection for an ordinary id', async () => {
    await deleteCalendar(session, 'personal', testConfig);
    expect(calledUrls()).toEqual(['http://dav.test/dav.php/cal/alice/personal/']);
  });
});

// assertDavTarget is the one predicate the whole defense rests on — including
// the check applied to the home-set URLs the DAV server returns at discovery,
// which otherwise become the base for every later request.
describe('assertDavTarget predicate', () => {
  const accepted = [
    'http://dav.test/dav.php',
    'http://dav.test/dav.php/',
    'http://dav.test/dav.php/ab/alice/',
    'http://dav.test/dav.php/principals/alice/',
    'http://DAV.TEST/dav.php/ab/alice/', // host casing is normalized by URL
    'http://dav.test:80/dav.php/ab/alice/', // default port is normalized away
  ];
  it.each(accepted)('accepts %s', (url) => {
    expect(() => assertDavTarget(url)).not.toThrow();
  });

  const rejected = [
    'http://evil.test/dav.php/',
    'https://dav.test/dav.php/', // scheme is part of the origin
    'http://dav.test:8443/dav.php/', // as is the port
    'http://dav.test/other-app/',
    'http://dav.test/', // above the base path
    'http://dav.test/dav.php-evil/', // string-prefix lookalike
    'http://dav.test/dav.phpx/ab/', // ditto, no separator
    'http://dav.test@evil.test/dav.php/', // userinfo trick: real host is evil.test
    'http://169.254.169.254/latest/meta-data/',
    'file:///etc/passwd',
    'not a url',
    '',
  ];
  it.each(rejected)('rejects %s', (url) => {
    expect(() => assertDavTarget(url)).toThrow();
  });

  it('rejects a URL that traverses out of the base path once normalized', () => {
    // new URL() resolves the dot segments before we inspect the pathname.
    expect(() => assertDavTarget('http://dav.test/dav.php/../admin/')).toThrow();
  });
});

describe('davFetch request options', () => {
  it('never follows redirects, so credentials cannot be replayed to another target', async () => {
    await createContact(session, 'default', contact, testConfig);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
  });
});

describe('fail-closed behaviour', () => {
  it('refuses to issue any request before the DAV base is pinned', async () => {
    vi.resetModules();
    const fresh = await import('../lib/dav.js');
    await expect(
      fresh.createContact(session, 'default', contact, testConfig),
    ).rejects.toThrow(/not initialized/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
