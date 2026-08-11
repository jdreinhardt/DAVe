// Seed believable demo data for README screenshots.
//
// Targets an app instance backed by the Baikal/Radicale TEST stack — never a
// real server. Typical usage (see scripts/screenshots.mjs for the capture step):
//
//   npm run stack:baikal
//   npm run build
//   NODE_ENV=production DAV_BASE_URL=http://localhost:8801/dav.php \
//     SESSION_SECRET=$(openssl rand -hex 32) PORT=3100 DATA_DIR=$(mktemp -d) \
//     FRONTEND_DIST=$PWD/packages/frontend/dist node packages/backend/dist/server.js &
//   node scripts/demo-seed.mjs
//   node scripts/screenshots.mjs
//
// Dates cluster around BASE_DATE so the calendar month view looks lived-in;
// bump it when regenerating screenshots far in the future.

const BASE = process.env.DEMO_BASE_URL ?? 'http://localhost:3100';
let cookie = '';

async function api(path, method = 'GET', body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── login ─────────────────────────────────────────────────────────────────────
const loginRes = await fetch(BASE + '/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'testuser', password: 'testpass' }),
});
if (!loginRes.ok) throw new Error('login failed — is the demo backend running against a seeded test stack?');
cookie = loginRes.headers.get('set-cookie').split(';')[0];

// ── collections ───────────────────────────────────────────────────────────────
let calendars = await api('/api/calendars');
const personal = calendars.find((c) => c.id === 'personal') ?? calendars[0];
let work = calendars.find((c) => c.displayName === 'Work');
if (!work) {
  calendars = await api('/api/calendars', 'POST', {
    displayName: 'Work',
    color: '#B4306A',
    components: ['VEVENT', 'VTODO'],
  });
  work = calendars.find((c) => c.displayName === 'Work');
}
const books = await api('/api/addressbooks');
const book = books[0];

const uid = (p) => `demo-${p}-${Math.random().toString(36).slice(2, 10)}`;

// ── contacts ──────────────────────────────────────────────────────────────────
const people = [
  { given: 'Amelia', family: 'Hartley', org: 'Bluegrass Robotics', title: 'Firmware Engineer', email: 'amelia.hartley@example.com', phone: '+1 502 555 0142', bday: '1988-04-12' },
  { given: 'Marcus', family: 'Okafor', org: 'Riverbend Clinic', title: 'Physical Therapist', email: 'marcus.okafor@example.com', phone: '+1 502 555 0177' },
  { given: 'Priya', family: 'Natarajan', org: 'Cedar & Pine Coffee', title: 'Owner', email: 'priya@example.com', phone: '+1 502 555 0193', bday: '1991-11-02' },
  { given: 'Jonas', family: 'Lindqvist', org: 'Northlight Studio', title: 'Illustrator', email: 'jonas.lindqvist@example.com', phone: '+46 70 555 0111' },
  { given: 'Rosa', family: 'Delgado', org: 'City Parks Dept', title: 'Arborist', email: 'rosa.delgado@example.com', phone: '+1 502 555 0129', bday: '1979-06-27' },
  { given: 'Theo', family: 'Brandt', org: '', title: '', email: 'theo.brandt@example.com', phone: '+1 502 555 0163' },
  { given: 'Nadia', family: 'Kowalczyk', org: 'Open Shelf Library', title: 'Archivist', email: 'nadia.k@example.com', phone: '+1 502 555 0185' },
  { given: 'Sam', family: 'Whitfield', org: 'Whitfield HVAC', title: 'Owner', email: 'sam@example.com', phone: '+1 502 555 0150' },
];
for (const p of people) {
  await api(`/api/addressbooks/${book.id}/contacts`, 'POST', {
    data: {
      uid: uid('c'), version: '3.0',
      name: { prefix: '', given: p.given, middle: '', family: p.family, suffix: '' },
      fullName: `${p.given} ${p.family}`,
      nickname: '', organization: p.org, title: p.title,
      phones: [{ value: p.phone, types: ['CELL'], preferred: true }],
      emails: [{ value: p.email, types: ['HOME'], preferred: true }],
      addresses: [], urls: [], birthday: p.bday ?? null, anniversary: null,
      note: '', photo: null, customFields: [],
    },
  });
}

// ── events ────────────────────────────────────────────────────────────────────
// Screenshots are captured with the browser pinned to UTC (see screenshots.mjs),
// so these naive local times are exactly what the month grid displays.
const ev = (calendarId, summary, start, end, opts = {}) => ({
  uid: uid('e'), summary, description: opts.description ?? '', location: opts.location ?? '',
  start, end, allDay: opts.allDay ?? false, tzid: opts.allDay ? null : 'America/New_York',
  recurrenceRule: opts.rrule ?? null, recurrenceId: null, alarms: opts.alarms ?? [],
  attendees: [], calendarId, color: null,
});
const events = [
  ev(work.id, 'Team standup', '2026-08-03T09:15:00', '2026-08-03T09:30:00', {
    rrule: { freq: 'WEEKLY', interval: 1, byDay: ['MO','WE','FR'], raw: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' }, location: 'Video call' }),
  ev(work.id, 'Sprint review', '2026-08-14T14:00:00', '2026-08-14T15:00:00', { location: 'Conf room B' }),
  ev(work.id, 'Quarterly planning', '2026-08-19T10:00:00', '2026-08-19T12:30:00'),
  ev(personal.id, 'Dentist — cleaning', '2026-08-12T08:30:00', '2026-08-12T09:30:00', {
    location: 'Riverbend Dental', alarms: [{ action: 'DISPLAY', trigger: '-PT1H', description: '' }] }),
  ev(personal.id, 'Yoga class', '2026-08-04T18:00:00', '2026-08-04T19:00:00', {
    rrule: { freq: 'WEEKLY', interval: 1, byDay: ['TU','TH'], raw: 'FREQ=WEEKLY;BYDAY=TU,TH' }, location: 'Community center' }),
  ev(personal.id, "Priya's birthday dinner", '2026-08-15T19:00:00', '2026-08-15T21:30:00', {
    location: 'Cedar & Pine Coffee' }),
  ev(personal.id, 'Camping — Red River Gorge', '2026-08-21', '2026-08-24', { allDay: true }),
  ev(personal.id, 'Farmers market', '2026-08-08T09:00:00', '2026-08-08T10:30:00', {
    rrule: { freq: 'WEEKLY', interval: 1, byDay: ['SA'], raw: 'FREQ=WEEKLY;BYDAY=SA' } }),
  ev(personal.id, 'Car service appointment', '2026-08-27T07:45:00', '2026-08-27T09:00:00', {
    location: "Miller's Auto" }),
];
for (const e of events) await api(`/api/calendars/${e.calendarId}/events`, 'POST', { data: e });

// ── tasks ─────────────────────────────────────────────────────────────────────
const task = (collectionUrl, summary, opts = {}) => ({
  uid: opts.uid ?? uid('t'), summary, description: opts.description ?? '',
  status: opts.status ?? 'NEEDS-ACTION', priority: opts.priority ?? null,
  dtstart: opts.dtstart ?? null, due: opts.due ?? null,
  completed: opts.completed ?? null, percentComplete: opts.percent ?? null,
  lastModified: null, categories: opts.categories ?? [], relations: opts.relations ?? [],
  collectionUrl, alarms: [], rrule: opts.rrule ?? null,
});
const P = personal.url, W = work.url;
const campingUid = uid('t');
const tasks = [
  task(P, 'Plan camping trip', { uid: campingUid, priority: 3, categories: ['Outdoors'],
    dtstart: '2026-08-10T09:00:00', due: '2026-08-20T18:00:00', status: 'IN-PROCESS', percent: 40 }),
  task(P, 'Reserve campsite', { categories: ['Outdoors'], status: 'COMPLETED',
    completed: '2026-08-06T12:00:00',
    relations: [{ relatedUid: campingUid, reltype: 'PARENT' }] }),
  task(P, 'Meal plan + grocery list', { categories: ['Outdoors'], due: '2026-08-18T18:00:00',
    relations: [{ relatedUid: campingUid, reltype: 'PARENT' }] }),
  task(P, 'Patch and waterproof tent', { categories: ['Outdoors'],
    dtstart: '2026-08-13T09:00:00', due: '2026-08-16T18:00:00',
    relations: [{ relatedUid: campingUid, reltype: 'PARENT' }] }),
  task(P, 'Renew car registration', { priority: 1, due: '2026-08-13T17:00:00', categories: ['Errands'] }),
  task(P, 'Water the garden', { rrule: 'FREQ=DAILY;INTERVAL=2', categories: ['Home'] }),
  task(P, 'Clean gutters before fall', { priority: 7, categories: ['Home'],
    dtstart: '2026-08-24T09:00:00', due: '2026-08-29T18:00:00' }),
  task(W, 'Draft Q3 report outline', { priority: 2, status: 'IN-PROCESS', percent: 60,
    dtstart: '2026-08-10T09:00:00', due: '2026-08-14T17:00:00', categories: ['Reports'] }),
  task(W, 'Review firmware PR backlog', { priority: 5, due: '2026-08-12T17:00:00', categories: ['Code review'] }),
  task(W, 'Prepare demo for sprint review', { dtstart: '2026-08-12T09:00:00', due: '2026-08-14T13:00:00', priority: 4 }),
  task(W, 'Book conference travel', { status: 'COMPLETED', completed: '2026-08-07T10:00:00', categories: ['Admin'] }),
  task(P, 'Return library books', { due: '2026-08-11T17:00:00', categories: ['Errands'] }),
];
for (const t of tasks) await api('/api/tasks', 'POST', { data: t });

// ── notes ─────────────────────────────────────────────────────────────────────
const note = (summary, description, categories = [], dtstart = null) => ({
  uid: uid('n'), summary, description, dtstart, lastModified: null,
  categories, relations: [], collectionUrl: P,
});
const notes = [
  note('Camping packing list', '## Gear\n\n- [x] Tent + footprint\n- [x] Sleeping bags\n- [ ] Water filter\n- [ ] Headlamps (check batteries)\n\n## Food\n\n- [ ] Coffee kit\n- [ ] Foil-pack dinners\n- [ ] Marshmallows', ['Outdoors']),
  note('Sourdough notes', 'Starter is liveliest when fed **1:5:5** the night before.\n\n| Bake | Hydration | Result |\n|---|---|---|\n| #12 | 72% | dense crumb |\n| #13 | 78% | best yet |\n\nNext: try 30 min longer bulk ferment.', ['Kitchen']),
  note('Home lab ideas', 'Things to try on the home server:\n\n1. Move DNS to a container\n2. Nightly `restic` backups to the NAS\n3. Dashboard for DAV sync status\n\n```bash\nrestic backup /data --tag nightly\n```', ['Tech']),
  note('Gift ideas', '- Priya: pour-over kettle\n- Marcus: trail guide for the Gorge\n- Rosa: grafting knife', []),
];
for (const n of notes) await api('/api/notes', 'POST', { data: n });

// ── journals ──────────────────────────────────────────────────────────────────
const journals = [
  ['First tomato harvest', 'Picked the first ripe tomatoes this morning — the Cherokee Purples finally turned. Sliced one for lunch with just salt. Worth every hour of watering.', '2026-08-09', ['Garden']],
  ['Long ride on the river trail', 'Did the full 22-mile loop before it got hot. Legs felt strong after two weeks of the Tuesday yoga class. Saw a heron near the boat ramp.', '2026-08-08', ['Fitness']],
  ['Bake #13', 'Best loaf yet — 78% hydration, longer bulk ferment. Crumb was open and even. Writing down everything in the sourdough note before I forget.', '2026-08-05', ['Kitchen']],
  ['Planning the Gorge trip', 'Sat down with the maps tonight. Three days, two nights at Red River Gorge late this month. Campsite is booked; meal planning is next weekend.', '2026-08-03', ['Outdoors']],
  ['Quiet Sunday', 'Rain most of the day. Finished the illustration book Jonas recommended and started sketching again for the first time in months.', '2026-08-02', []],
];
for (const [summary, description, dtstart, categories] of journals) {
  await api('/api/journals', 'POST', { data: {
    uid: uid('j'), summary, description, dtstart, lastModified: null,
    categories, relations: [], collectionUrl: P,
  }});
}

console.log('Seeded:', people.length, 'contacts,', events.length, 'events,', tasks.length, 'tasks,', notes.length, 'notes,', journals.length, 'journals');
