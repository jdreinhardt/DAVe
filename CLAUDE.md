# CLAUDE.md

Operational context for Claude Code working on this project. The "what" lives in `SPEC.md`; this file is about the "how."

## Project at a glance

A self-hosted web client for Baikal (CalDAV + CardDAV). Replaces InfCloud. See `SPEC.md` for the full design — read it before starting any non-trivial work and treat it as the source of truth.

## Files to read at the start of any session

- `SPEC.md` — design source of truth. If a request seems to contradict it, surface the contradiction; don't silently pick a side.
- `README.md` — current build/run instructions.
- `.env.example` — current set of expected env vars.

## Common commands

(Update this section as the project evolves. The skeleton may not have all of these on day one.)

```
npm install                                    # install deps
npm run dev                                    # local dev server (Vite + tsx watch)
npm run build                                  # production build
npm test                                       # unit tests
npm run test:e2e                               # Playwright tests
npm run lint                                   # eslint
npm run typecheck                              # tsc --noEmit
docker compose -f docker-compose.dev.yml up    # full dev stack incl. Baikal
```

**Before declaring any task done:** `npm run lint && npm run typecheck && npm test`.

## Conventions

- **Language:** TypeScript everywhere, `strict: true`. No `any` without a comment justifying it.
- **Style:** prettier defaults; eslint config lives in the repo.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`). Subject in imperative mood, under 72 chars. Body explains *why*, not *what*.
- **Branches:** `feat/short-description`, `fix/short-description`. Don't merge to `main` with failing lint/tests.
- **Tests:** anything load-bearing gets a test — vCard/iCal conversion, ETag handling, RRULE expansion, timezone round-tripping, session lifecycle. Don't pad coverage with trivial tests.
- **Comments:** explain non-obvious *intent*. Don't restate the code in prose.

## Library hard rules

These decisions are made; don't relitigate them mid-task.

- **`tsdav`** owns CalDAV/CardDAV. Don't hand-roll PROPFIND/REPORT XML. If you hit a tsdav bug, wrap around it; don't replace it.
- **`ical.js`** is the iCalendar parser. One parser, not two.
- **`vcard4`** (or `vcard4-ts`) is the vCard parser. Same rule.
- **FullCalendar** owns the calendar view. Don't render events with custom DOM.
- **`pica`** does photo resizing. Canvas-native scaling is too soft for photos.

## Gotchas

- **ETags everywhere.** Every PUT/DELETE must honor `If-Match`. Treat 412 Precondition Failed as an expected case to handle, not an edge case.
- **Round-trip fidelity.** Both vCard and iCalendar carry properties this app doesn't render. Read → mutate → write must preserve unknown fields and parameters. Don't drop what you don't recognize.
- **Timezones.** Store original `TZID` + `VTIMEZONE` unchanged. Display in browser TZ. If you find yourself rewriting timezone data on save, stop — that's the wrong path.
- **CORS / proxy.** All DAV traffic goes through the backend proxy. The browser should never talk to Baikal directly. If you're tempted to add a CORS workaround, reconsider; the architecture exists specifically to avoid that.
- **Credentials.** Encrypted with `SESSION_SECRET` before storage. Never log them, never include them in error responses, never surface them in API output.

## When to ask before acting

- The request would change anything in `SPEC.md`. Propose the spec edit first; implement after confirmation.
- The change touches the auth/session layer in a non-trivial way.
- A library swap is involved (see "Library hard rules").
- Tests would need to be deleted or weakened for a change to pass.

Anything else: proceed.
