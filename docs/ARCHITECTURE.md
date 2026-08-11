# Architecture

## Monorepo layout

```
packages/
  shared/       TypeScript types shared by frontend and backend
  backend/      Fastify server — DAV proxy, session management, REST API
  frontend/     React 19 SPA (Vite + Tailwind v4)
e2e/            Playwright specs; auth.setup.ts signs in once and specs share the session
scripts/
  seed.sh                Populate dev Baikal with a test user + collections
  seed-test-baikal.sh    Non-interactive seed for the Baikal test stack
  seed-test-radicale.sh  Non-interactive seed for the Radicale test stack
  demo-seed.mjs          Fake-but-believable demo data for README screenshots
  screenshots.mjs        Playwright capture of docs/images (see file headers)
docker-compose.yml               Production (app only)
docker-compose.dev.yml           Dev stack (source bind-mounted)
docker-compose.test.baikal.yml   Test stack (Baikal on 8801, seeded automatically)
docker-compose.test.radicale.yml Test stack (Radicale on 8802, seeded automatically)
playwright.config.ts        E2E test config
```

## Request flow

```
Browser (React SPA)
   │  JSON REST  /api/*
   ▼
Backend (Fastify)
   │  CalDAV/CardDAV  HTTP+XML
   ▼
DAV server (Baikal / Radicale)
```

The frontend never contacts the DAV server directly. All DAV traffic goes through the backend proxy. This removes the CORS problem and keeps credentials server-side.

## Backend layers

```
routes/              HTTP handlers — parse/validate input, call lib/services, return JSON
  auth, me           login/logout, current user
  collections        address books + calendars (list/create/update/delete, colors)
  contacts, events   live-proxied CardDAV/CalDAV reads and writes
  tasks, notes,      cache-backed reads; DAV-first writes (see "Two data paths")
  journals
  settings           per-user settings persisted in sessions.sqlite
  search             global search — cache for tasks/notes/journals, ranged DAV query for events
  sync               client-driven delta sync + initial cache seeding endpoints
  health             liveness probe
services/
  session.ts         CRUD for encrypted server-side sessions
  cacheSync.ts       initial + incremental collection sync into the cache
workers/
  syncWorker.ts      background poller (SYNC_INTERVAL_SECONDS) — runs cacheSync for
                     every collection already known to the cache, for each live session
lib/
  dav.ts             tsdav wrappers — all CalDAV/CardDAV operations
  vcard.ts           vCard 3.0/4.0 parser + serializer (hand-rolled; no vCard library)
  ical.ts            iCalendar parser + serializer + mutation helpers (ical.js)
  entryParser.ts     raw ICS → cache-row shape for tasks/notes/journals
  routeUtils.ts      cache-row → API JSON helpers shared by task/note/journal routes
  crypto.ts          AES-256-GCM encrypt/decrypt for credential storage
db/
  index.ts           sessions.sqlite — sessions, user_settings, address_book_colors
  cache.ts           cache.db schema — entries, entry_categories, entry_relations,
                     collection_sync (per-collection sync tokens)
  cacheOps.ts        prepared-statement helpers over cache.db
plugins/
  session.ts         Fastify plugin — authenticate request, attach session to context
config.ts            Zod-validated environment variables
```

## Two data paths

**Contacts and calendar events are proxied live.** Route handlers call `lib/dav.ts` directly; nothing is stored locally. The frontend drives freshness via `POST /api/sync` (below).

**Tasks, notes, and journals are served from a local SQLite cache** (`cache.db`). The DAV model (one HTTP round-trip per object) is too slow for list views, so:

- Reads query the `entries` table (filter/sort/search happens in SQL).
- Writes go **DAV-first**: the route PUTs/DELETEs on the server, then upserts the cache row from the server's response. A failed cache upsert is logged and tolerated — the worker will repair it.
- The background `SyncWorker` polls every `SYNC_INTERVAL_SECONDS`, running an incremental `sync-collection` REPORT per known collection. Initial seeding happens on first navigation to Tasks/Notes/Journals (via `/api/sync/tasks` and `/api/sync/notes`), not in the worker — so idle sessions generate no PROPFIND traffic.
- If the server rejects a stored sync token (`SyncTokenInvalidError` — Radicale prunes tokens after ~30 days), `cacheSync` clears that collection's rows and re-syncs from an empty token. This is the only correct rebuild path: a full REPORT lists current members but reports no deletions, so clearing first is what keeps gap-deleted objects out of the cache.
- Eviction: completed tasks older than `COMPLETED_TASK_RETENTION_DAYS` leave the cache (not the server); `MAX_CACHED_ENTRIES_PER_USER` hard-caps growth. The "Search Archived" toggle in Tasks reaches past the cache with a ranged DAV query (`DAV_ARCHIVE_SEARCH_MAX_AGE_DAYS`).

The cache is disposable by design — deleting `cache.db` loses nothing; it rebuilds from the server.

**Notes vs journals:** both are VJOURNAL components living in the same collections. A journal has a `DTSTART`; a note does not (`dtstart_present` in the cache schema). That single bit is the entire distinction — the two route files differ only in that filter plus journal-specific date sorting.

## Session model

Sessions are stored in a local SQLite database (not on the DAV server). On login:

1. The backend makes a PROPFIND to the DAV server with the supplied credentials to verify they work.
2. If successful, the credentials are encrypted with AES-256-GCM (key derived from `SESSION_SECRET` via HKDF-SHA256 with a random per-record salt) and stored in the `sessions` table alongside a random session ID.
3. The session ID is set as an `HttpOnly; SameSite=Lax` cookie (also `Secure` when `TRUST_PROXY=1`).

On each authenticated request, the session plugin decrypts the stored credentials and creates a fresh `tsdav` client scoped to that request. Sessions use a sliding TTL (`SESSION_TTL_HOURS`, default 7 days) updated on every authenticated request.

## vCard pipeline

```
DAV server (vCard text)
  └─ parseVCard()      → ContactJson   (normalised TypeScript object)
        │
        │  edit in UI
        ▼
  serializeVCard()     → vCard text    (round-trips unknown fields)
  └─ PUT to the DAV server
```

The parser handles vCard 3.0 and 4.0, line unfolding, escaped characters, grouped properties, and ENCODING=b (base64) photos. Unknown properties are preserved in `customFields` and written back verbatim.

## iCalendar pipeline

```
DAV server (iCal text)
  └─ parseIcalEvents()      → EventJson[]  (one entry per expanded occurrence)
        │
        │  edit in UI
        ▼
  serializeIcalEvent()      → iCal text
  └─ PUT to the DAV server
```

Recurring event mutations use helpers in `lib/ical.ts`:
- `addExdate` — adds an EXDATE to exclude a single occurrence (scope=this delete)
- `injectException` — inserts or replaces a VEVENT RECURRENCE-ID override
- `truncateRrule` — rewrites RRULE with an UNTIL date (scope=future delete/edit)
- `updateMasterVevent` — updates the master VEVENT fields without touching exceptions

`ical.js` (Mozilla) is the underlying parser. Do not add a second iCal parser.

## Client sync model

`POST /api/sync` accepts per-collection sync tokens and returns a delta (changed + deleted items) using CalDAV `sync-collection` REPORT via tsdav. The frontend calls this on mount and after mutations to keep its contact/event state current. (Task/note/journal freshness is the backend cache's job — see "Two data paths".)

## Frontend structure

```
src/
  App.tsx          react-router route table; HomeRedirect resolves "/" to the
                   user's configured default page
  api/             typed fetch wrappers, one module per API area (client.ts = base fetch)
  pages/           one component per view — Contacts, Calendar, Tasks, Notes, Journals,
                   Login, and AppLayout (shell: sidebar, topbar, mobile bottom nav)
  components/      modals, forms, detail panes; TaskGantt.tsx renders the gantt view
  contexts/        Settings (server-persisted via /api/settings), CollectionVisibility,
                   MobileHeader, ContactDrag, NoteDrag
  hooks/           useIsMobile, useHotkey, useSyncCollections, useViewNavItems
  lib/             gantt.ts (pure gantt layout math — unit-tested), calendarLayers.ts
                   (maps tasks/journals onto FullCalendar event inputs), utils.ts
```

Server state is owned by `@tanstack/react-query`; UI state lives in contexts. The calendar view is FullCalendar; tasks and journals appear on it as derived event inputs (`lib/calendarLayers.ts`) styled with CSS classes rather than custom `eventContent` DOM. The gantt view is deliberately *not* FullCalendar — `lib/gantt.ts` computes the layout and `TaskGantt.tsx` renders it.

Settings are persisted per-user in the backend (`user_settings` table) and hydrated into the `Settings` context on login. Adding a setting touches three places: the enum/type in `packages/shared`, the settings route's validation, and the context.

In dev, Vite serves the frontend on :5173 and proxies `/api` to the backend on :3000. In production the backend serves the built frontend via `@fastify/static`, so the app is a single origin.

## Auth note

The server **must** be configured for **Basic auth** (not Digest). tsdav's auth layer uses Basic; Digest causes 401 failures.

- **Baikal** — the test seed script writes `dav_auth_type: 'Basic'` into `baikal.yaml`. A manual install requires switching this in the admin UI under Settings → WebDAV auth type.
- **Radicale** — `[auth] type = htpasswd` is Basic already; nothing to switch.

## Server portability

The runtime speaks standard CalDAV/CardDAV (RFC 4791 / 6352 / 6578) through tsdav and holds no
server-specific behavior. The integration and e2e suites run unchanged against both Baikal and
Radicale; if a test ever needs to branch on the server, treat that as a portability regression.

Two things are worth knowing when adding a third server:

- **Collection URLs are rebuilt, not remembered.** `listCalendars`/`listAddressBooks` return the
  hrefs PROPFIND gave us, but the read and write paths discard them and reconstruct
  `homeUrl + '/' + id + '/'` (see `collectionId` and the URL builders in `lib/dav.ts`). This holds
  for Baikal and Radicale, where collections are direct children of the home set, but it would break
  for shared or delegated collections living elsewhere. The task/journal paths already do the right
  thing by carrying absolute collection URLs.
- **Home sets are not necessarily distinct.** Radicale returns the same URL (`/<user>/`) for both
  `calendar-home-set` and `addressbook-home-set`, so calendars and address books are siblings in one
  collection. The listing code separates them by `resourcetype`, which is the only reliable
  discriminator — do not assume the two homes differ.
