import fs from 'fs';
import { test as teardown, expect, type APIRequestContext } from '@playwright/test';
import { AUTH_STATE_PATH, TEST_USER, TEST_PASS } from './helpers';

/**
 * Removes everything the suite creates, so a run always starts from the seeded
 * baseline.
 *
 * The specs share one account and one set of collections, and they chain within
 * a file (create -> view -> edit -> delete), so they cannot clean up per test.
 * Without a sweep at the end, a failed run leaves entities behind and the next
 * run inherits them — `.first()` locators then bind to stale rows and the damage
 * compounds. Observed going 1 -> 5 -> 8 failures over successive runs before
 * this existed.
 *
 * Matching is by the naming convention every spec follows rather than by ids
 * recorded during the run, so this also clears debris left by *earlier* runs
 * (including ones that crashed before reaching teardown).
 */

/** Titles the specs use. Anything matching is ours to delete. */
const isFixture = (name: string | undefined): boolean => {
  const s = (name ?? '').trim();
  return s.startsWith('E2E') || s.startsWith('e2e-gantt-');
};

const isFixtureUid = (uid: string): boolean => uid.startsWith('e2e-gantt-');

/** DELETE, tolerating a 404/412 — a concurrent worker may have removed it. */
async function tryDelete(api: APIRequestContext, url: string, label: string): Promise<boolean> {
  const res = await api.delete(url);
  if (res.ok() || res.status() === 404) return res.ok();
  // 412 means the etag moved under us; the next run's sweep will catch it.
  console.warn(`  cleanup: ${label} -> ${res.status()}`);
  return false;
}

teardown('remove fixtures created by the suite', async ({ playwright, baseURL }) => {
  // Prefer the session the setup project already established — /api/auth/login is
  // rate limited to 10 attempts per 15 minutes per IP, so a run should not spend
  // an attempt it does not need. Fall back to signing in when that state is
  // missing or stale, since teardown still has to work if setup never got there.
  const storageState = fs.existsSync(AUTH_STATE_PATH) ? AUTH_STATE_PATH : undefined;
  const api = await playwright.request.newContext({ baseURL, storageState });

  if (!(await api.get('/api/me')).ok()) {
    const auth = await api.post('/api/auth/login', {
      data: { username: TEST_USER, password: TEST_PASS },
    });
    expect(auth.ok(), 'cleanup could not sign in').toBeTruthy();
  }

  let removed = 0;

  // ── Contacts ──────────────────────────────────────────────────────────────
  const books = await (await api.get('/api/addressbooks')).json();
  for (const ab of books) {
    const contacts = await (
      await api.get(`/api/addressbooks/${encodeURIComponent(ab.id)}/contacts`)
    ).json();
    for (const c of contacts) {
      const name =
        c.data?.fullName ||
        [c.data?.name?.given, c.data?.name?.family].filter(Boolean).join(' ');
      if (!isFixture(name)) continue;
      const url =
        `/api/addressbooks/${encodeURIComponent(ab.id)}/contacts/${encodeURIComponent(c.id)}` +
        `?etag=${encodeURIComponent(c.etag)}`;
      if (await tryDelete(api, url, `contact ${name}`)) removed++;
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────
  // No unbounded list endpoint, so sweep a window wide enough for any fixture.
  const cals = await (await api.get('/api/calendars')).json();
  const start = '2000-01-01T00:00:00.000Z';
  const end = '2100-01-01T00:00:00.000Z';
  for (const cal of cals) {
    const events = await (
      await api.get(
        `/api/calendars/${encodeURIComponent(cal.id)}/events` +
          `?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
      )
    ).json();
    for (const ev of events) {
      if (!isFixture(ev.data?.summary)) continue;
      const url =
        `/api/events/${encodeURIComponent(ev.id)}` +
        `?calendarId=${encodeURIComponent(ev.calendarId)}&etag=${encodeURIComponent(ev.etag)}`;
      if (await tryDelete(api, url, `event ${ev.data?.summary}`)) removed++;
    }
  }

  // ── Tasks, notes, journals ────────────────────────────────────────────────
  // All three are cache-backed and share the uid+etag delete shape.
  for (const kind of ['tasks', 'notes', 'journals'] as const) {
    const body = await (await api.get(`/api/${kind}`)).json();
    for (const item of body[kind] ?? []) {
      if (!isFixture(item.data?.summary) && !isFixtureUid(item.uid)) continue;
      // deleteChildren so a parent sweep doesn't strand its subtasks.
      const extra = kind === 'tasks' ? '&deleteChildren=true' : '';
      const url =
        `/api/${kind}/${encodeURIComponent(item.uid)}?etag=${encodeURIComponent(item.etag)}${extra}`;
      if (await tryDelete(api, url, `${kind} ${item.uid}`)) removed++;
    }
  }

  console.log(`cleanup: removed ${removed} fixture object(s)`);
  await api.dispose();
});
