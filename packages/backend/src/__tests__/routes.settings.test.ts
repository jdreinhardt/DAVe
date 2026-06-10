import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp, makeDb, TEST_SECRET } from './helpers.js';
import { settingsRoutes } from '../routes/settings.js';
import { createSession } from '../services/session.js';
import { COOKIE_NAME } from '../plugins/session.js';
import type { DbInstance } from '../db/index.js';
import type { SessionData } from '../services/session.js';

const SESSION_DATA: SessionData = {
  username: 'alice',
  password: 'hunter2',
  displayName: 'Alice',
  principalUrl: 'https://baikal.test/principals/alice',
  calendarHomeUrl: 'https://baikal.test/cal/alice/',
  addressBookHomeUrl: 'https://baikal.test/ab/alice/',
};

const VALID_BODY = {
  contactSortBy: 'last',
  contactSortDir: 'asc',
  contactSubtitle: 'email',
  mapService: 'osm',
  darkMode: 'system',
  taskLayout: 'list',
  notesView: 'list',
  journalsView: 'timeline',
  updatedAt: 1000,
};

describe('PUT /api/settings validation', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: DbInstance;
  let cookie: string;

  beforeEach(async () => {
    db = makeDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_settings (
        username         TEXT    PRIMARY KEY,
        contact_sort_by  TEXT    NOT NULL DEFAULT 'last',
        contact_sort_dir TEXT    NOT NULL DEFAULT 'asc',
        contact_subtitle TEXT    NOT NULL DEFAULT '',
        map_service      TEXT    NOT NULL DEFAULT 'osm',
        dark_mode        TEXT    NOT NULL DEFAULT 'system',
        task_layout      TEXT    NOT NULL DEFAULT 'list',
        notes_view       TEXT    NOT NULL DEFAULT 'list',
        journals_view    TEXT    NOT NULL DEFAULT 'timeline',
        updated_at       INTEGER NOT NULL DEFAULT 0
      );
    `);
    app = await buildApp(async (a) => {
      await a.register(settingsRoutes, { db });
    }, db);
    const id = createSession(SESSION_DATA, TEST_SECRET, db);
    cookie = `${COOKIE_NAME}=${id}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects an out-of-enum value with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { ...VALID_BODY, darkMode: 'neon' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('strips unknown properties rather than persisting them', async () => {
    // additionalProperties:false makes Fastify's ajv drop unknown fields, so the
    // request succeeds but the injected key never reaches the (fixed-column) insert.
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { ...VALID_BODY, injected: 'x' },
    });
    expect(res.statusCode).toBe(204);

    const cols = db.prepare('PRAGMA table_info(user_settings)').all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).not.toContain('injected');
  });

  it('accepts a valid body with 204', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(204);
  });

  it('clamps a far-future updatedAt to roughly now', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { ...VALID_BODY, updatedAt: 4_102_444_800_000 }, // year 2100
    });
    expect(res.statusCode).toBe(204);

    const row = db
      .prepare('SELECT updated_at FROM user_settings WHERE username = ?')
      .get('alice') as { updated_at: number };
    // Stored timestamp must not be the year-2100 value — it is clamped to now+skew.
    expect(row.updated_at).toBeLessThan(Date.now() + 120_000);
  });

  it('requires authentication', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(401);
  });
});
