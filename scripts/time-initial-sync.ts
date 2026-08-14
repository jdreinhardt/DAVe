// Time each phase of the initial VJOURNAL / VTODO cache seeding pass.
//
// Read-only: discovery, one PROPFIND for the collection list, then the same
// filtered calendar-query + calendar-multiget REPORTs that
// initialSyncForComponentType issues. It writes nothing.
//
//   DAV_BASE_URL=https://dav.example.com/dav.php \
//     DAV_USER=alice DAV_PASS=... npm run diagnose:sync-timing
//
// Use it when a first visit to Notes / Journals / Tasks is slow. The pass is
// sequential over every collection advertising the component type, so the
// column that matters is per-collection milliseconds: one slow collection is
// the whole wait. `objects` is what the filtered REPORT matched, so a
// collection that costs seconds and returns 0 objects is pure server-side
// filter cost over an unrelated collection.

import {
  initDavBase,
  discoverAndValidate,
  listCalendars,
  fetchAllCalendarObjects,
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

const config = {
  DAV_BASE_URL: BASE.replace(/\/+$/, ''),
  DAV_ARCHIVE_SEARCH_MAX_AGE_DAYS: 365,
  COMPLETED_TASK_RETENTION_DAYS: 7,
} as Config;

initDavBase(config);

async function timed<T>(label: string, fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now();
  const value = await fn();
  const ms = performance.now() - t0;
  console.log(`${label.padEnd(52)} ${ms.toFixed(0).padStart(7)} ms`);
  return [value, ms];
}

const [discovery] = await timed('discoverAndValidate', () =>
  discoverAndValidate(USER, PASS, config),
);
const session = { username: USER, password: PASS, ...discovery } as SessionData;

const [calendars] = await timed('listCalendars (PROPFIND + supportedReportSet)', () =>
  listCalendars(session, config),
);
console.log(`\n${calendars.length} calendar collection(s) total\n`);

for (const componentType of ['VJOURNAL', 'VTODO'] as const) {
  const matching = calendars.filter((c) => c.components.includes(componentType));
  console.log(`── ${componentType}: ${matching.length} collection(s) advertise it`);

  let total = 0;
  for (const cal of matching) {
    const t0 = performance.now();
    let found: number | string;
    let bytes = 0;
    try {
      const objects = await fetchAllCalendarObjects(session, cal.url, config, componentType);
      found = objects.length;
      bytes = objects.reduce((n, o) => n + o.rawIcs.length, 0);
    } catch (err) {
      found = `ERROR ${(err as Error).message}`;
    }
    const ms = performance.now() - t0;
    total += ms;
    console.log(
      `   ${String(cal.displayName).slice(0, 34).padEnd(34)} ` +
        `${ms.toFixed(0).padStart(7)} ms   ${String(found).padStart(5)} objects   ` +
        `${(bytes / 1024).toFixed(0)} KiB`,
    );
  }
  console.log(`   ${'TOTAL'.padEnd(34)} ${total.toFixed(0).padStart(7)} ms\n`);
}
