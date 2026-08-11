# Contributing

## Prerequisites

- Node.js 22+ (project uses `node:sqlite` built-in)
- Docker + Docker Compose (integration tests and dev stack)
- `npm` (workspaces)

## Setup

```bash
git clone <repo> dave && cd dave
npm install
cp .env.example .env   # fill in DAV_BASE_URL and SESSION_SECRET
```

## Development

```bash
docker compose -f docker-compose.dev.yml up -d   # start the app
npm run dev                                       # backend tsx watch + Vite HMR
```

`DAV_BASE_URL` must point at a reachable CalDAV/CardDAV server using **Basic auth** — `tsdav` does not do Digest, which fails with 401. For a fully local stack, uncomment the `radicale` service in `docker-compose.dev.yml`; Radicale needs no install wizard and no auth-type switch. If you point at a fresh Baikal instead, complete the wizard at `http://localhost:8800/admin/` first and switch **WebDAV auth type** from Digest to Basic.

## Testing

### Unit tests

```bash
npm test                            # all unit tests (backend + frontend)
npm test -w packages/backend        # backend only
npm test -w packages/frontend       # frontend only
```

Backend tests cover: crypto, session lifecycle, vCard parse/serialize/round-trip, iCal parse/serialize/round-trip/mutation, and all route handlers. Frontend tests cover the API client and `useHotkey` hook.

### Integration tests

Integration tests run Fastify in-process against a real DAV container. There are two stacks, and
the suite must pass against both **without any test branching on which server is running** — that
equivalence is what keeps the app from re-acquiring server-specific behavior.

```bash
npm run stack:baikal              # Baikal on 8801
npm run test:integration:baikal

npm run stack:radicale            # Radicale on 8802
npm run test:integration:radicale

npm run test:integration:all      # both, sequentially
npm run stack:down                # tear both down
```

Both avoid colliding with the dev stack on 8800. Each seeds `testuser`/`testpass` with a `Personal`
calendar and a `Contacts` address book.

### E2E tests (Playwright)

```bash
npm run dev &                        # app must be running on localhost:3000
npx playwright install --with-deps  # first run only
npm run test:e2e
npm run test:e2e:ui                  # interactive mode
```

## Before opening a PR

```bash
npm run lint && npm run typecheck && npm test
```

All three must pass. Do not skip or weaken existing tests to make a change land.

## Commit style

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add recurring event edit dialog
fix: preserve TZID on contact save
chore: bump tsdav to 2.1.0
```

Subject in imperative mood, under 72 characters. Body explains *why*, not *what*.

## Branches

`feat/short-description` or `fix/short-description`. Don't merge to `main` with failing lint or tests.

## Key invariants

- **ETags on every mutation.** Every PUT and DELETE must send `If-Match`. Handle 412 as an expected case, not an edge case.
- **Round-trip fidelity.** Read → mutate → write must preserve unknown vCard/iCal fields. Don't drop what you don't recognise.
- **Credentials never leave the backend.** Don't log them, don't include them in API responses, don't surface them in error messages.
- **All DAV traffic through the proxy.** The browser should never talk to the DAV server directly.
- **No server-specific behavior.** The app targets standard CalDAV/CardDAV. If something only works on one server, fix it generically rather than branching — and make sure the integration suite still passes on both.
