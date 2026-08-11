# DAVe — CalDAV/CardDAV Web Client

A self-hosted web client for CalDAV + CardDAV servers.
Tested against [Baikal](https://sabre.io/baikal/) and [Radicale](https://radicale.org/); it speaks
standard DAV and holds no server-specific behavior, so other servers may work but are unverified.

**Stack:** Node 22 · Fastify · React 19 · Vite · Tailwind v4 · TypeScript  
**DAV:** [tsdav](https://github.com/natelindev/tsdav) · [ical.js](https://github.com/kewisch/ical.js)

---
![calendar](docs/images/calendar.png)

---

## Features

### Contacts
- Alphabetized list with letter groupings, live search, and avatar display
- Full vCard detail view: name, phone, email, address, URL, birthday, anniversary, notes, custom `X-` fields
- Create, edit, and delete with ETag conflict detection
- Photo upload with mandatory crop step, high-quality resize via `pica`, stored as inline base64
- Import `.vcf` files (batch); export all or selected contacts
- Drag-and-drop contacts between address books
- Multi-select with bulk edit and bulk delete
- Merge duplicate contacts
- Per-address-book color customization (stored locally)

### Calendar
- Month, week, and day views via [FullCalendar](https://fullcalendar.io/)
- Create, edit, and delete events
- Recurring events with a full RRULE editor; edit "this / this and following / all instances"
- Drag-to-move and drag-to-resize
- Multiple `VALARM` reminders per event (written as standards-compliant iCal so other clients fire them)
- Timezone handling: events display in browser timezone; the original timezone is shown as a secondary line when it differs
- Calendar color swatches and visibility toggles in the sidebar

### Tasks
- Based on VTODO; requires at least one calendar collection advertising VTODO support
- Three layouts: list, compact list, kanban by status
- Subtask support via `RELATED-TO` with indented tree rendering
- Recurring tasks roll forward on completion (advances DTSTART/DUE to next occurrence, resets status — no RECURRENCE-ID overrides)
- Sort by due date, priority, alphabetical, creation/modification date, or category
- Filter by status, category, calendar, due date range, and priority
- Full-text search across summary, description, and categories (debounced, runs against local cache)
- Completed tasks older than `COMPLETED_TASK_RETENTION_DAYS` are evicted from the local cache but remain on the server; a "Search Archived" toggle in the search bar queries them directly and allows restoring individual tasks
- Multi-select with bulk status, priority, category, calendar, and delete operations

### Notes
- Based on VJOURNAL (without `DTSTART`); requires at least one calendar collection advertising VJOURNAL support
- List and grid views with sort, category filters, and full-text search
- Markdown rendering via `react-markdown` + `remark-gfm` (stored as plain text in `DESCRIPTION` for interop)
- Split-pane editor (raw markdown + rendered preview) on desktop; tab-between-panes on mobile
- Multi-select with bulk edit and delete
- "Convert to Journal" button adds `DTSTART` and moves the entry to the Journals tab

### Journals
- Based on VJOURNAL (with `DTSTART`); shares collections with Notes
- Three views: Timeline (reverse-chronological, default), Calendar (month grid, desktop only), and List
- Timeline groups entries by month and day with a date-jump widget
- Calendar view built on FullCalendar's month grid; click an empty day to create a new journal entry
- Full-text search and category filters across all three views
- Multi-select with bulk edit and delete
- "Convert to Note" button removes `DTSTART` and moves the entry to the Notes tab

### Global search
- **Cmd+K** (or **Ctrl+K**) opens a modal that searches across all data types simultaneously
- Tasks, notes, and journals are searched via SQLite FTS against the local cache; calendar events are queried from the DAV server (±60 days from today); contacts are searched client-side from the in-memory cache
- Keyboard navigation (↑↓ to move, Enter to open, Esc to close)
- Navigates to the correct tab and selects and scrolls to the item in the list

### General
- Dark mode with system-preference default, toggleable in settings
- Sidebar collection visibility toggles with color swatches
- Mobile-responsive layout; sidebar collapses on small screens
- Optimistic UI for edits with rollback on failure
- Multi-user: each user authenticates with their own DAV credentials and sees only their own collections

---

## Quick start (development)

You need an existing CalDAV/CardDAV server. Point `DAV_BASE_URL` at its DAV endpoint:

- **Baikal** — `https://baikal.example.com/dav.php`. Set **Basic auth** in Settings → WebDAV auth type.
  tsdav authenticates with Basic; leaving it on Digest fails every login with 401.
- **Radicale** — `http://radicale.example.com:5232` (served from the root, no path).
  Use `[auth] type = htpasswd`; Radicale speaks Basic out of the box.

Basic auth is a hard requirement either way — Digest is not supported.

```bash
# 1. Clone and install
git clone <repo> dave && cd dave
npm install

# 2. Configure
cp .env.example .env
# Edit .env — set DAV_BASE_URL, SESSION_SECRET, etc.

# 3. Start dev servers (backend + frontend with hot reload)
npm run dev
# Backend → http://localhost:3000
# Frontend → http://localhost:5173
```

Alternatively, use the dev Docker image (source bind-mounted for hot reload):

```bash
# Edit DAV_BASE_URL in docker-compose.dev.yml, then:
docker compose -f docker-compose.dev.yml up -d
# Backend → http://localhost:3000   Frontend → http://localhost:5173
```

Backend changes restart automatically via `tsx watch`; frontend changes apply instantly via Vite HMR.

### Collection setup for Tasks, Notes, and Journals

DAVe reads `supported-calendar-component-set` from each collection on discovery and shows a
collection only in the tabs its components allow. No manual URL configuration is needed — but what
you have to do first depends on the server:

- **Baikal** — collections default to VEVENT only. In the admin UI go to
  **Users → [username] → Calendars**, then edit (or create) a calendar and check **VTODO** for
  tasks, **VJOURNAL** for notes and journals. Without this, those tabs show an empty state.
- **Radicale** — nothing to do. Radicale advertises `VEVENT,VJOURNAL,VTODO` on every calendar by
  default, so every calendar appears in all three tabs. The flip side is that the first visit to
  Tasks or Notes syncs *every* calendar rather than a chosen few; set
  `supported-calendar-component-set` explicitly on a collection to narrow that.

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and fill in:

| Variable | Required | Default | Description |
|---|---|---|---|
| `DAV_BASE_URL` | Yes | — | Root URL of the DAV endpoint, e.g. `https://baikal.example.com/dav.php` or `http://radicale.example.com:5232`. A trailing slash is stripped; a query or fragment is rejected at startup. |
| `SESSION_SECRET` | Yes | — | Random secret ≥ 32 chars for encrypting session credentials. Generate: `openssl rand -hex 32` |
| `SESSION_TTL_HOURS` | No | `168` | Session inactivity timeout in hours (sliding window). Default = 7 days. |
| `PORT` | No | `3000` | Port to listen on |
| `BIND_ADDRESS` | No | `0.0.0.0` | Address to bind |
| `TRUST_PROXY` | No | `0` | Set to `1` when running behind a reverse proxy — enables `Secure` cookies and reads the client IP from `X-Forwarded-For` (used for login rate limiting). A startup warning is logged if this is unset in production. |
| `DATA_DIR` | No | `/data` | Directory for the SQLite session and cache databases |
| `SYNC_INTERVAL_SECONDS` | No | `60` | How often the background worker polls the server for changes to tasks, notes, and journals |
| `MAX_CACHED_ENTRIES_PER_USER` | No | `10000` | Safety cap on cached task/note/journal entries per user |
| `COMPLETED_TASK_RETENTION_DAYS` | No | `7` | Days a completed task stays in the local cache after its `COMPLETED` timestamp (1–90). Older completions remain on the server and are reachable via "Search Archived." |
| `DAV_ARCHIVE_SEARCH_MAX_AGE_DAYS` | No | `365` | How far back the "Search Archived" task search queries for old completed tasks |
| `EVENT_SEARCH_RANGE_DAYS` | No | `60` | Days in each direction from today that global search queries the server for calendar events |
| `CACHE_DB_PATH` | No | `$DATA_DIR/cache.db` | Override path for the sync cache SQLite file |

---

## Production deployment

### Docker Compose

```bash
cp .env.example .env
# Fill in DAV_BASE_URL, SESSION_SECRET, etc.
docker compose up -d
```

The production image is a multi-stage build. Session data and the sync cache are stored in a named Docker volume (`data`) mounted at `/data`. Both persist across container restarts.

The container listens on HTTP only. Terminate TLS at a reverse proxy and set `TRUST_PROXY=1` in `.env`.

### Data at rest

Two things live in the `/data` volume, with deliberately different protection:

- **DAV credentials** (`sessions.sqlite`) are **encrypted** at the app layer (AES-256-GCM, key derived from `SESSION_SECRET` via HKDF-SHA256 with a per-record salt). This is the high-value secret, so it's never stored in the clear.
- **Cached content** (`cache.db` — your calendar events, contacts, tasks, and notes, including full vCard/iCalendar bodies) is stored **unencrypted**. This is a mirror of data the DAV server already holds in plaintext, and it's kept queryable so SQLite FTS5 can power global search. Encrypting it would disable full-text search for little real gain, since the running app needs the key in memory on every request anyway.

If the contents of `/data` are sensitive in your environment, protect them at the deployment layer rather than the app layer: **encrypt the underlying volume/disk** (LUKS, encrypted EBS/PD, etc.) and **encrypt your backups**. Volume encryption transparently covers both SQLite files and keeps search working. Note that if you run DAVe on a different host than the DAV server, `cache.db` becomes a second plaintext copy of that data — factor that into where you place the volume.

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name dave.example.com;

    ssl_certificate     /etc/ssl/certs/dave.crt;
    ssl_certificate_key /etc/ssl/private/dave.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Caddy

```caddyfile
dave.example.com {
    reverse_proxy localhost:3000
}
```

Caddy handles TLS automatically.

---

## Common commands

```bash
npm run dev          # Start backend + frontend dev servers
npm run build        # Production build (backend bundle + frontend SPA)
npm test             # Unit tests
npm run test:e2e     # Playwright E2E tests (app must be running)
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit across all packages

docker compose -f docker-compose.dev.yml up -d   # Dev stack with hot reload
docker compose -f docker-compose.dev.yml down -v  # Tear down + remove volumes
```

---

## Testing

### Unit tests

```bash
npm test                        # all unit tests
npm test -w packages/backend    # backend only (vCard, iCal, crypto, routes, sync worker)
npm test -w packages/frontend   # frontend only (API client, hooks)
```

### Integration tests

Integration tests use Fastify's in-process `.inject()` against a real DAV container. There are two
stacks, and the suite is identical against both — no test branches on which server is running. That
equivalence is the point: it is what keeps the app from silently re-acquiring server-specific
behavior.

```bash
npm run stack:baikal              # Baikal on 8801, seeded testuser/testpass
npm run test:integration:baikal

npm run stack:radicale            # Radicale on 8802, seeded testuser/testpass
npm run test:integration:radicale

npm run test:integration:all      # both, sequentially
npm run stack:down                # tear both down
```

Both ports are distinct from the dev stack's 8800. The two also exercise different base-URL shapes:
Baikal is served from a path (`/dav.php`), Radicale from the root.

### E2E tests (Playwright)

```bash
npx playwright install --with-deps   # first run only
npm run dev &                        # app must be running
npm run test:e2e                     # headless
npm run test:e2e:ui                  # interactive UI mode
```

---

## Project structure

```
packages/
  shared/     TypeScript types shared between frontend and backend
  backend/    Fastify server — session management, DAV proxy, sync cache, sync worker
  frontend/   React SPA (Vite + Tailwind)
scripts/
  seed.sh                  Populate a dev Baikal with a test user + collections
  seed-test.sh             Seed the integration-test Baikal (testuser/testpass)
  seed-test-radicale.sh    Seed the integration-test Radicale (testuser/testpass)
Dockerfile         Production multi-stage build
Dockerfile.dev     Development image (source bind-mounted)
docker-compose.yml           Production compose (app only)
docker-compose.dev.yml       Dev compose (app + hot reload)
docker-compose.test.yml          Integration test stack (Baikal, port 8801)
docker-compose.test.radicale.yml Integration test stack (Radicale, port 8802)
```

### Backend internals

- **Sessions:** server-side in SQLite (`/data/sessions.sqlite`), credentials AES-256-GCM encrypted (HKDF-SHA256 key from `SESSION_SECRET`, per-record salt)
- **Sync cache:** separate SQLite file (`/data/cache.db`) with FTS5 full-text search; stores normalized tasks, notes, and journals for responsive querying. Content is stored unencrypted — see [Data at rest](#data-at-rest)
- **Sync worker:** background process that runs `sync-collection` against each VTODO/VJOURNAL collection every `SYNC_INTERVAL_SECONDS`; writes are immediately reflected in the cache without waiting for the next poll
- **Rate limiting:** login is throttled to 10 attempts / 15 min per IP, with a looser global cap as a backstop; client IPs come from `X-Forwarded-For` only when `TRUST_PROXY=1`

---

## Interoperability

DAVe is tested against Baikal and Radicale, and designed to round-trip cleanly with:

- **DAVx⁵** on Android for CalDAV/CardDAV sync
- **jtx Board** on Android for tasks, notes, and journals (VTODO + VJOURNAL)

DAVe reads and writes vCard 3.0 (what Baikal stores) and preserves all unknown properties and parameters on round-trip. Notes and journals are stored as plain text in `DESCRIPTION` (with markdown syntax visible as-is in other clients) so they remain readable outside DAVe.
