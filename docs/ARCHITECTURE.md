# Architecture

## Monorepo layout

```
packages/
  shared/       TypeScript types shared by frontend and backend
  backend/      Fastify server — DAV proxy, session management, REST API
  frontend/     React 19 SPA (Vite + Tailwind v4)
scripts/
  seed.sh                Populate dev Baikal with a test user + collections
  seed-test.sh           Non-interactive seed for the Baikal test stack
  seed-test-radicale.sh  Non-interactive seed for the Radicale test stack
docker-compose.yml               Production (app only)
docker-compose.dev.yml           Dev stack (source bind-mounted)
docker-compose.test.yml          Test stack (Baikal on 8801, seeded automatically)
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
routes/          HTTP handlers — parse/validate input, call services, return JSON
services/        session.ts — CRUD for encrypted server-side sessions
lib/
  dav.ts         tsdav wrappers — all CalDAV/CardDAV operations
  vcard.ts       vCard 3.0/4.0 parser + serializer
  ical.ts        iCalendar parser + serializer + mutation helpers
  crypto.ts      AES-256-GCM encrypt/decrypt for credential storage
db/
  index.ts       node:sqlite (built-in) — sessions table only
plugins/
  session.ts     Fastify plugin — authenticate request, attach session to context
config.ts        Zod-validated environment variables
```

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

## Sync model

`POST /api/sync` accepts per-collection sync tokens and returns a delta (changed + deleted items) using CalDAV `sync-collection` REPORT via tsdav. The frontend calls this on mount and after mutations to keep its local state current.

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
