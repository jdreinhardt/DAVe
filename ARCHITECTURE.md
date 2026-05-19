# Architecture

## Monorepo layout

```
packages/
  shared/       TypeScript types shared by frontend and backend
  backend/      Fastify server — DAV proxy, session management, REST API
  frontend/     React 19 SPA (Vite + Tailwind v4)
scripts/
  seed.sh       Populate dev Baikal with a test user + collections
  seed-test.sh  Non-interactive seed for the integration-test Docker stack
docker-compose.yml          Production (app only)
docker-compose.dev.yml      Dev stack (app + Baikal, source bind-mounted)
docker-compose.test.yml     Test stack (Baikal on 8801, seeded automatically)
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
Baikal (sabre/dav)
```

The frontend never contacts Baikal directly. All DAV traffic goes through the backend proxy. This removes the CORS problem and keeps credentials server-side.

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

Sessions are stored in a local SQLite database (not in Baikal). On login:

1. The backend makes a PROPFIND to Baikal with the supplied credentials to verify they work.
2. If successful, the credentials are encrypted with AES-256-GCM (key derived from `SESSION_SECRET` via SHA-256) and stored in the `sessions` table alongside a random session ID.
3. The session ID is set as an `HttpOnly; SameSite=Strict` cookie.

On each authenticated request, the session plugin decrypts the stored credentials and creates a fresh `tsdav` client scoped to that request. Sessions use a sliding TTL (`SESSION_TTL_HOURS`, default 7 days) updated on every authenticated request.

## vCard pipeline

```
Baikal (vCard text)
  └─ parseVCard()      → ContactJson   (normalised TypeScript object)
        │
        │  edit in UI
        ▼
  serializeVCard()     → vCard text    (round-trips unknown fields)
  └─ PUT to Baikal
```

The parser handles vCard 3.0 and 4.0, line unfolding, escaped characters, grouped properties, and ENCODING=b (base64) photos. Unknown properties are preserved in `customFields` and written back verbatim.

## iCalendar pipeline

```
Baikal (iCal text)
  └─ parseIcalEvents()      → EventJson[]  (one entry per expanded occurrence)
        │
        │  edit in UI
        ▼
  serializeIcalEvent()      → iCal text
  └─ PUT to Baikal
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

Baikal **must** be configured for **Basic auth** (not Digest). tsdav's auth layer uses Basic; Digest causes 401 failures. The dev and test seed scripts write `auth_type: 'Basic'` into `baikal.yaml` automatically. A manual Baikal install requires switching this in the admin UI under Settings → WebDAV auth type.
