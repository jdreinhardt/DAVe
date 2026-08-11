# CLAUDE.md

Operational context for Claude Code working on this project. Read the "Codebase map" below before grepping around — it answers most "where does X live" questions without opening files.

## Project at a glance

**Dave** is a self-hosted web client for CalDAV/CardDAV servers — contacts, calendar, tasks, notes, and journals in one SPA. It replaces InfCloud. It targets *standard* CalDAV/CardDAV and is tested against both **Baikal** and **Radicale**; server-specific behavior is a bug, not a feature.

Project docs:

- `docs/ARCHITECTURE.md` — how the pieces connect (request flow, session model, cache/sync model, data pipelines). Read it before any non-trivial backend work.
- `docs/ROADMAP.md` — planned features by release. The "what's next" list.
- `docs/FIXES.md` — running bug list (resolved + open).
- `docs/CONTRIBUTING.md` — human-facing setup and test instructions.
- `COMPLETED_SPEC1.md` / `COMPLETED_SPEC2.md` — historical build specs, already implemented. Reference only; do not treat as current requirements.
- `.env.example` — the authoritative list of env vars, with comments.

## Codebase map

```
packages/shared/src/index.ts   All API/domain types + settings enums. Both sides import from here.
packages/backend/src/
  server.ts                    Fastify bootstrap; registers all routes; serves frontend dist in prod
  config.ts                    Zod-validated env vars
  routes/                      One file per API area: auth, me, collections, contacts, events,
                               tasks, notes, journals, settings, search, sync, health
  lib/dav.ts                   ALL tsdav/DAV operations (large; search by function name)
  lib/ical.ts                  iCalendar parse/serialize/mutation (ical.js via createRequire)
  lib/vcard.ts                 Hand-rolled vCard 3.0/4.0 parser + serializer
  lib/entryParser.ts           Raw ICS → cache-row shape for tasks/notes/journals
  lib/routeUtils.ts            Cache-row → API JSON helpers shared by task/note/journal routes
  lib/crypto.ts                AES-256-GCM credential encryption
  db/index.ts                  sessions.sqlite: sessions, user_settings, address_book_colors
  db/cache.ts + cacheOps.ts    cache.db: entries, entry_categories, entry_relations, collection_sync
  services/session.ts          Session CRUD
  services/cacheSync.ts        Initial + incremental collection sync into the cache
  workers/syncWorker.ts        Background poller (SYNC_INTERVAL_SECONDS) driving cacheSync
  plugins/session.ts           Auth plugin — decrypts creds, attaches session to request
packages/frontend/src/
  App.tsx                      react-router routes; HomeRedirect honors the default-page setting
  api/                         Typed fetch wrappers, one file per API area (client.ts = base)
  pages/                       One page per view: Contacts, Calendar, Tasks, Notes, Journals,
                               Login, AppLayout (shell: sidebar, topbar, bottom nav)
  components/                  Modals, forms, detail panes; TaskGantt.tsx = gantt view
  contexts/                    Settings (server-persisted), CollectionVisibility, MobileHeader,
                               ContactDrag, NoteDrag
  hooks/                       useIsMobile, useHotkey, useSyncCollections, useViewNavItems
  lib/                         gantt.ts (gantt layout math), calendarLayers.ts (task/journal
                               overlay on FullCalendar), utils.ts
e2e/                           Playwright specs; auth.setup.ts logs in once, specs share the session
scripts/                       seed.sh (dev), seed-test-{baikal,radicale}.sh (test stacks)
```

**Two data paths — know which one you're on:**

1. **Contacts + calendar events** are proxied live: route → `lib/dav.ts` → DAV server. No local storage.
2. **Tasks + notes + journals** are served from the local SQLite cache (`cache.db`), kept current by the background sync worker. Writes go DAV-first, then upsert the cache. The cache is disposable — it can always be rebuilt from the server.

Notes and journals are both VJOURNAL components in the same collections; a **journal has a DTSTART, a note does not** (`dtstart_present` in the cache). That one bit is the entire distinction.

Settings are persisted server-side (`user_settings` table) via `/api/settings` and hydrated into the frontend `Settings` context; add new settings in `packages/shared` (enum + type), the settings route, and the context.

## Common commands

```
npm install                       # install all workspaces
npm run dev                       # backend :3000 (tsx watch) + Vite :5173 (proxies /api)
npm run build                     # backend tsup + frontend vite build
npm start                         # production run of the build (requires .env; reads it via --env-file)
npm test                          # all unit tests (backend + frontend)
npm run lint                      # eslint
npm run typecheck                 # tsc --noEmit, per workspace

npm run stack:baikal              # Baikal test stack on :8801 (seeded testuser/testpass)
npm run stack:radicale            # Radicale test stack on :8802 (seeded)
npm run test:integration:all      # integration suite against both servers
npm run test:e2e                  # Playwright (app must be running)
npm run stack:down                # tear down both test stacks
```

**Before declaring any task done:** `npm run lint && npm run typecheck && npm test`.
Integration and e2e suites need Docker; run them when the change touches DAV interaction, sync, or user-visible flows.

## Conventions

- **Language:** TypeScript everywhere, `strict: true`. No `any` without a comment justifying it.
- **Style:** prettier defaults; eslint config lives in the repo.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`). Subject in imperative mood, under 72 chars. Body explains *why*, not *what*.
- **Branches:** `feat/short-description`, `fix/short-description`. Don't merge to `main` with failing lint/tests.
- **Tests:** anything load-bearing gets a test — vCard/iCal conversion, ETag handling, RRULE expansion, timezone round-tripping, session lifecycle, sync-token handling. Don't pad coverage with trivial tests.
- **Comments:** explain non-obvious *intent*. Don't restate the code in prose.

## License constraints

The project is **AGPL-3.0-only**. This shapes dependency choices:

- Every new runtime dependency must be AGPL-compatible: MIT/ISC/BSD/Apache-2.0/MPL-2.0 are fine; proprietary or commercially-licensed packages are not. Check the license before adding, not after.
- **FullCalendar premium plugins are off the table** (resource timeline, scheduler, etc. are commercial). If a feature needs premium-plugin behavior, build it custom — the gantt view (`TaskGantt.tsx` + `lib/gantt.ts`) is the precedent.
- `ical.js` is MPL-2.0: fine as a dependency, but if its source files are ever vendored and modified, those files stay MPL.
- The login page links to the source repo; AGPL §13 requires that offer to network users. Don't remove it.

## Library hard rules

These decisions are made; don't relitigate them mid-task.

- **`tsdav`** owns CalDAV/CardDAV transport. Don't hand-roll PROPFIND/REPORT XML. If you hit a tsdav bug, wrap around it; don't replace it.
- **`ical.js`** is the iCalendar parser. One parser, not two. (Loaded via `createRequire` in `lib/ical.ts` — it has no ESM build.)
- **vCard parsing is hand-rolled** in `lib/vcard.ts` (the `vcard4` library couldn't handle the vCard 3.0 that real servers emit). Extend the existing parser; don't add a vCard library.
- **FullCalendar** owns the calendar view. Don't render events with custom DOM — task/journal overlays are done with CSS classes (see `lib/calendarLayers.ts` and `.dave-task-tile` in `index.css`).
- **FullCalendar is not used for the gantt view** — `TaskGantt.tsx` + `lib/gantt.ts` are custom, deliberately.
- **`pica`** does photo resizing. Canvas-native scaling is too soft for photos.
- **`@tanstack/react-query`** owns server state on the frontend. No hand-rolled fetch-and-setState for API data.

## Gotchas

- **ETags everywhere.** Every PUT/DELETE must honor `If-Match`. Treat 412 Precondition Failed as an expected case to handle, not an edge case.
- **Round-trip fidelity.** Both vCard and iCalendar carry properties this app doesn't render. Read → mutate → write must preserve unknown fields and parameters. Don't drop what you don't recognize.
- **Timezones.** Store original `TZID` + `VTIMEZONE` unchanged. Display in browser TZ. If you find yourself rewriting timezone data on save, stop — that's the wrong path.
- **CORS / proxy.** All DAV traffic goes through the backend. The browser never talks to the DAV server directly. If you're tempted to add a CORS workaround, reconsider; the architecture exists specifically to avoid that.
- **Credentials.** Encrypted with `SESSION_SECRET` before storage. Never log them, never include them in error responses, never surface them in API output.
- **No server-specific branches.** The integration and e2e suites run unchanged against Baikal and Radicale. If a test (or the app) needs to know which server it's talking to, that's a portability regression to fix, not accommodate. The known shape differences (path-served vs root-served base URL, shared vs distinct home sets, sync-token pruning, redirect/trailing-slash behavior) are handled generically in `lib/dav.ts` and `services/cacheSync.ts`.
- **Sync tokens expire.** Radicale prunes tokens after ~30 days; `cacheSync` handles `SyncTokenInvalidError` by clearing the collection's cache rows and re-syncing from scratch. Preserve that rebuild path when touching sync.
- **Basic auth only.** tsdav does not speak Digest — the DAV server must be configured for Basic auth or every request 401s.

## When to ask before acting

- The request adds scope beyond `docs/ROADMAP.md` or contradicts an architecture decision in `docs/ARCHITECTURE.md`. Surface the conflict first; don't silently pick a side.
- The change touches the auth/session layer in a non-trivial way.
- A library swap is involved (see "Library hard rules").
- Tests would need to be deleted or weakened for a change to pass.

Anything else: proceed.
