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
docker compose -f docker-compose.dev.yml up -d   # start app + Baikal
npm run dev                                       # backend tsx watch + Vite HMR
```

The first time you start the dev Baikal container, complete the wizard at `http://localhost:8800/admin/` and switch **WebDAV auth type** from Digest to Basic. `tsdav` uses Basic auth; Digest causes 401 failures.

## Testing

### Unit tests

```bash
npm test                            # all unit tests (backend + frontend)
npm test -w packages/backend        # backend only
npm test -w packages/frontend       # frontend only
```

Backend tests cover: crypto, session lifecycle, vCard parse/serialize/round-trip, iCal parse/serialize/round-trip/mutation, and all route handlers. Frontend tests cover the API client and `useHotkey` hook.

### Integration tests

Integration tests run Fastify in-process against a real Baikal container. Start the test stack first:

```bash
docker compose -f docker-compose.test.yml up -d
# Wait for baikal-init to complete (it seeds testuser/testpass)
npm run test:integration -w packages/backend
```

The test stack runs on port 8801 to avoid colliding with the dev stack on 8800.

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
- **All DAV traffic through the proxy.** The browser should never talk to Baikal directly.
