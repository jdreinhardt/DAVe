# DAVe — CalDAV/CardDAV Web Client

A self-hosted web client for CalDAV + CardDAV servers.
Tested against [Baikal](https://sabre.io/baikal/) and [Radicale](https://radicale.org/); it speaks
standard DAV and holds no server-specific behavior, so other servers may work but are unverified.

---

## Screenshots

All screenshots use seeded demo data (regenerate with `scripts/demo-seed.mjs` + `scripts/screenshots.mjs`).

| | | |
|---|---|---|
| **Calendar** ![calendar](docs/images/calendar.png) | **Contacts** ![contacts](docs/images/contacts.png) | **Tasks — list** ![tasks list](docs/images/tasks-list.png) |
| **Tasks — kanban** ![tasks kanban](docs/images/tasks-kanban.png) | **Tasks — gantt** ![tasks gantt](docs/images/tasks-gantt.png) | **Notes** ![notes](docs/images/notes.png) |
| **Journals** ![journals](docs/images/journals.png) | **Global search** ![search](docs/images/search.png) | **Mobile** ![mobile calendar](docs/images/mobile-calendar.png) |

---

## Quick start

You need an existing CalDAV/CardDAV server. Point `DAV_BASE_URL` at its DAV endpoint:

- **Baikal** — `https://baikal.example.com/dav.php`. Set **Basic auth** in Settings → WebDAV auth type.
  tsdav authenticates with Basic; leaving it on Digest fails every login with 401.
- **Radicale** — `http://radicale.example.com:5232` (served from the root, no path).
  Use `[auth] type = htpasswd`; Radicale speaks Basic out of the box.

Basic auth is a hard requirement. Digest is not supported. The one alternative is
[OIDC sign-in](#oidc-sign-in), for a DAV server that trusts a user header from DAVe.

```bash
git clone https://github.com/jdreinhardt/dave && cd dave

cp .env.example .env

# Update .env with correct DAV_BASE_URL and other
# adjustments for your environment
nano .env
```

### Docker

```bash
docker compose up -d
# Login at http://localhost:3000
```

### Node

```bash
npm install
npm run build
DATA_DIR="$PWD/data" npm start
# Login at http://localhost:3000
```

`npm start` reads `.env` via Node's `--env-file` and **fails to launch if `.env` does not exist** —
create it first (see above). `DATA_DIR` overrides the `/data` default, which a bare host usually
can't write to; alternatively set it in `.env`. The built frontend is found automatically
(`packages/frontend/dist`); set `FRONTEND_DIST` only to serve it from somewhere else.

For development setup (hot reload, dev Docker stack), see [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

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
- Optional single sign-on via OIDC, against a DAV server that trusts a user header (see [OIDC sign-in](#oidc-sign-in))


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
| `OIDC_ISSUER_URL` | No | — | Enables [OIDC sign-in](#oidc-sign-in) and disables password login. Issuer URL of the provider (its `/.well-known/openid-configuration` must be served under it). |
| `OIDC_CLIENT_ID` | With OIDC | — | Client ID registered at the provider |
| `OIDC_CLIENT_SECRET` | No | — | Client secret for a confidential client; omit for a public client. PKCE is used either way. |
| `OIDC_REDIRECT_URI` | With OIDC | — | `https://<dave-host>/api/auth/oidc/callback`, registered at the provider exactly as written |
| `OIDC_SCOPES` | No | `openid profile email` | Scopes to request; must include `openid` |
| `OIDC_USERNAME_CLAIM` | No | `preferred_username` | Claim holding the DAV username. Read from the ID token, falling back to userinfo. |
| `OIDC_POST_LOGOUT_REDIRECT_URI` | No | — | Where the provider sends the browser after sign-out, e.g. `https://<dave-host>/login?signedOut`. Must be registered at the provider. |
| `DAV_REMOTE_USER_HEADER` | No | `X-Remote-User` | Header that carries the username to the DAV server in OIDC mode |

---

## Production deployment

Run commands live in [Quick start](#quick-start). Production-specific notes:

The production image is a multi-stage build. Session data and the sync cache are stored in a named Docker volume (`data`) mounted at `/data`. Both persist across container restarts.

The container listens on HTTP only. Terminate TLS at a reverse proxy and set `TRUST_PROXY=1` in `.env`.

### Data at rest

Two things live in the `/data` volume, with deliberately different protection:

- **DAV credentials** (`sessions.sqlite`) are **encrypted** at the app layer (AES-256-GCM, key derived from `SESSION_SECRET` via HKDF-SHA256 with a per-record salt). This is the high-value secret, so it's never stored in the clear.
- **Cached content** (`cache.db` — your calendar events, contacts, tasks, and notes, including full vCard/iCalendar bodies) is stored **unencrypted**. This is a mirror of data the DAV server already holds in plaintext, and it's kept queryable so SQLite FTS5 can power global search. Encrypting it would disable full-text search for little real gain, since the running app needs the key in memory on every request anyway.

If the contents of `/data` are sensitive in your environment, protect them at the deployment layer rather than the app layer: **encrypt the underlying volume/disk** (LUKS, encrypted EBS/PD, etc.) and **encrypt your backups**. Volume encryption transparently covers both SQLite files and keeps search working. Note that if you run DAVe on a different host than the DAV server, `cache.db` becomes a second plaintext copy of that data — factor that into where you place the volume.

### OIDC sign-in

By default DAVe signs users in with their DAV username and password and replays them as Basic
auth. If you already run an identity provider (Authentik, Keycloak, Authelia, …), DAVe can instead
sign users in with OIDC — but only against a DAV server configured to **trust a user header**,
because after an OIDC login DAVe has no DAV password to send.

With `OIDC_ISSUER_URL` set:

- There is no login form. Opening DAVe without a session redirects straight to the provider.
  Failed sign-ins and explicit sign-outs land on a page with a "Sign in" button rather than
  redirecting again, so a broken setup can't loop.
- DAVe runs the authorization code flow with PKCE, state and nonce, verifies the ID token, and
  takes the DAV username from `OIDC_USERNAME_CLAIM`. Every DAV request then carries
  `X-Remote-User: <username>` (see `DAV_REMOTE_USER_HEADER`) instead of an `Authorization` header.
- Password login (`POST /api/auth/login`) is refused: the DAV server trusts the header, so a
  password would prove nothing.
- Sign-out also ends the provider session when the provider advertises an `end_session_endpoint`;
  otherwise only the DAVe session ends.
- Who may use DAVe is decided at the provider — restrict the client to the right users or groups
  there.

The header carries the user's identity with no proof attached, so the DAV server will believe
anyone who can reach it. That makes the network layout the security boundary:

- The header-trusting DAV endpoint must be reachable **only from DAVe** — a private network or
  firewall rule, never the internet and never the same reverse proxy that serves clients.
- DAVe never forwards a header from the browser; the value always comes from the verified ID token.
- The username must match what the DAV server expects (Radicale uses it as the principal path, and
  creates an empty principal for any new name it sees).

**Radicale example.** Desktop and mobile clients (Thunderbird, DAVx⁵, Outlook add-ins) still need
Basic auth, so the usual setup is **two Radicale instances sharing one storage folder** — Radicale
locks its storage, so concurrent instances are safe:

```ini
# radicale-dave: only reachable by DAVe
[auth]
type = http_x_remote_user

[rights]
type = owner_only

[storage]
filesystem_folder = /data/collections
```

```yaml
services:
  radicale:           # existing instance, htpasswd auth, published via the reverse proxy for clients
    image: tomsquest/docker-radicale
    volumes: [./radicale/data:/data, ./radicale/config:/config:ro]
    networks: [frontend]

  radicale-dave:      # header auth, private to DAVe
    image: tomsquest/docker-radicale
    volumes: [./radicale/data:/data, ./radicale-dave/config:/config:ro]
    networks: [dave-radicale]

  dave:
    image: ghcr.io/jdreinhardt/dave
    environment:
      DAV_BASE_URL: http://radicale-dave:5232
      OIDC_ISSUER_URL: https://auth.example.com/application/o/dave/
      OIDC_CLIENT_ID: dave
      OIDC_CLIENT_SECRET: ${OIDC_CLIENT_SECRET}
      OIDC_REDIRECT_URI: https://dave.example.com/api/auth/oidc/callback
      OIDC_POST_LOGOUT_REDIRECT_URI: https://dave.example.com/login?signedOut
    networks: [frontend, dave-radicale]

networks:
  frontend: {}
  dave-radicale:
    internal: true    # no other container, and no route out
```

Plain `http://` to `radicale-dave` is fine here: the hop stays on the private network and carries no
password. (DAVe only refuses plaintext when `DAV_BASE_URL` itself is `https://`.)

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
  seed-test-baikal.sh      Seed the integration-test Baikal (testuser/testpass)
  seed-test-radicale.sh    Seed the integration-test Radicale (testuser/testpass)
  demo-seed.mjs            Fake demo data for README screenshots
  screenshots.mjs          Playwright capture of docs/images (see file headers)
Dockerfile         Production multi-stage build
Dockerfile.dev     Development image (source bind-mounted)
docker-compose.yml           Production compose (app only)
docker-compose.dev.yml       Dev compose (app + hot reload)
docker-compose.test.baikal.yml   Integration test stack (Baikal, port 8801)
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

DAVe reads and writes vCard 3.0 and preserves all unknown properties and parameters on round-trip. Notes and journals are stored as plain text in `DESCRIPTION` (with markdown syntax visible as-is in other clients) so they remain readable outside DAVe.

---

**Stack:** Node 22 · Fastify · React 19 · Vite · Tailwind v4 · TypeScript  
**DAV:** [tsdav](https://github.com/natelindev/tsdav) · [ical.js](https://github.com/kewisch/ical.js)

***Disclaimer***: This project is almost entirely vibe-coded with [Claude Code](https://claude.com/product/claude-code). It has been thoroughly tested with my real data and calendars, but that doesn't mean I have caught everything. If you find issues please open a bug report.

---

## License

DAVe is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only).
