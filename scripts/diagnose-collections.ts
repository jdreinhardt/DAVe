// Report what the DAV server says about each collection, and what each sync
// path actually returns for it.
//
// Read-only: discovery, a PROPFIND for the collection list, and REPORTs. It
// writes nothing, so it is safe to point at a real server. Credentials are read
// from the environment and never printed.
//
//   DAV_BASE_URL=https://dav.example.com/dav.php \
//     DAV_USER=alice DAV_PASS=... npm run diagnose:collections
//
// Use it when notes, journals or tasks are missing from one collection but not
// others. The two columns that matter are whether a component type is
// advertised in supported-calendar-component-set, and how many objects the
// filtered calendar-query REPORT returns versus the unfiltered sync-collection
// REPORT. Initial sync only visits collections that advertise the type it is
// seeding, and it fetches them with the filtered query — so a collection that
// holds objects the server does not advertise support for is invisible to it.

import {
  initDavBase,
  discoverAndValidate,
  listCalendars,
  fetchAllCalendarObjects,
  syncCalendarForCache,
} from '../packages/backend/src/lib/dav.js';
import type { Config } from '../packages/backend/src/config.js';
import type { SessionData } from '../packages/backend/src/services/session.js';

const BASE = process.env.DAV_BASE_URL;
const USER = process.env.DAV_USER;
const PASS = process.env.DAV_PASS;

if (!BASE || !USER || !PASS) {
  console.error('Set DAV_BASE_URL, DAV_USER and DAV_PASS.');
  process.exit(1);
}

// Only the fields the read paths below touch.
const config = {
  DAV_BASE_URL: BASE.replace(/\/+$/, ''),
  DAV_ARCHIVE_SEARCH_MAX_AGE_DAYS: 365,
  COMPLETED_TASK_RETENTION_DAYS: 7,
} as Config;

initDavBase(config);

const discovery = await discoverAndValidate(USER, PASS, config);
console.log('DAV_BASE_URL       :', config.DAV_BASE_URL);
console.log('calendarHomeUrl    :', discovery.calendarHomeUrl);
console.log('addressBookHomeUrl :', discovery.addressBookHomeUrl);

const session = { username: USER, password: PASS, ...discovery } as SessionData;
const calendars = await listCalendars(session, config);
console.log(`\n${calendars.length} calendar collection(s):\n`);

let findings = 0;

for (const cal of calendars) {
  console.log(`── ${cal.displayName}`);
  console.log(`   url        : ${cal.url}`);
  console.log(`   id         : ${JSON.stringify(cal.id)}`);
  console.log(`   components : ${JSON.stringify(cal.components)}`);
  console.log(`   syncToken  : ${cal.syncToken ? 'present' : 'MISSING'}`);

  for (const componentType of ['VJOURNAL', 'VTODO'] as const) {
    const advertised = cal.components.includes(componentType);
    let report: string;
    let found = 0;
    try {
      const objects = await fetchAllCalendarObjects(session, cal.url, config, componentType);
      found = objects.length;
      const withData = objects.filter((o) => o.rawIcs && o.rawIcs.length > 0).length;
      report = `${objects.length} object(s), ${withData} with data`;
    } catch (err) {
      report = `ERROR ${(err as Error).message}`;
    }

    let note = '';
    if (!advertised && found === 0) {
      // Not advertised and nothing there: initial sync skips it, correctly.
      note = '   (skipped by initial sync — nothing to seed)';
    } else if (!advertised) {
      note = '   <-- NOT ADVERTISED but objects exist: invisible to initial sync';
      findings++;
    }
    console.log(
      `   ${componentType}: advertised=${advertised ? 'yes' : 'NO'}  filtered REPORT -> ${report}${note}`,
    );
  }

  try {
    const full = await syncCalendarForCache(session, cal.url, '', config);
    console.log(`   unfiltered sync-collection REPORT -> ${full.changed.length} object(s)`);
  } catch (err) {
    console.log(`   unfiltered sync-collection REPORT -> ERROR ${(err as Error).message}`);
  }
  console.log('');
}

console.log(
  findings === 0
    ? 'No collections holding objects the server does not advertise support for.'
    : `${findings} collection/type pair(s) hold objects the server does not advertise; ` +
      'initial sync cannot see them.',
);
