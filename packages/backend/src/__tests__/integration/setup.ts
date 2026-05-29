import path from 'path';
import os from 'os';
import fs from 'fs';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import sessionPlugin from '../../plugins/session.js';
import { healthRoutes } from '../../routes/health.js';
import { authRoutes } from '../../routes/auth.js';
import { meRoutes } from '../../routes/me.js';
import { collectionsRoutes } from '../../routes/collections.js';
import { contactsRoutes } from '../../routes/contacts.js';
import { eventsRoutes } from '../../routes/events.js';
import { syncRoutes } from '../../routes/sync.js';
import type { DbInstance } from '../../db/index.js';
import { applySchema } from '../../db/cache.js';
import type { CacheDbInstance } from '../../db/cache.js';
import { SyncWorker } from '../../workers/syncWorker.js';
import type { Config } from '../../config.js';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

export const TEST_USER = process.env.TEST_USER ?? 'testuser';
export const TEST_PASS = process.env.TEST_PASS ?? 'testpass';

export const integrationConfig: Config = {
  BAIKAL_BASE_URL: process.env.TEST_BAIKAL_URL ?? 'http://localhost:8801/dav.php',
  SESSION_SECRET: 'integration-test-secret-32-chars!!',
  SESSION_TTL_HOURS: 1,
  PORT: 3001,
  BIND_ADDRESS: '0.0.0.0',
  TRUST_PROXY: false,
  NODE_ENV: 'test',
  DATA_DIR: path.join(os.tmpdir(), 'dave-integration-test'),
  SYNC_INTERVAL_SECONDS: 60,
  MAX_CACHED_ENTRIES_PER_USER: 10000,
  COMPLETED_TASK_RETENTION_DAYS: 7,
  BAIKAL_ARCHIVE_SEARCH_MAX_AGE_DAYS: 365,
  EVENT_SEARCH_RANGE_DAYS: 60,
};

let _db: DbInstance | null = null;
let _cacheDb: CacheDbInstance | null = null;

export function getTestDb(): DbInstance {
  if (_db) return _db;
  fs.mkdirSync(integrationConfig.DATA_DIR, { recursive: true });
  const dbPath = path.join(integrationConfig.DATA_DIR, 'sessions.sqlite');
  _db = new DatabaseSync(dbPath);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id               TEXT    PRIMARY KEY,
      data             TEXT    NOT NULL,
      created_at       INTEGER NOT NULL,
      last_activity_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_last_activity
      ON sessions(last_activity_at);
  `);
  return _db;
}

export function getTestCacheDb(): CacheDbInstance {
  if (_cacheDb) return _cacheDb;
  _cacheDb = new DatabaseSync(':memory:');
  applySchema(_cacheDb);
  return _cacheDb;
}

export async function buildIntegrationApp(): Promise<FastifyInstance> {
  const db = getTestDb();
  const cacheDb = getTestCacheDb();
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  await app.register(sessionPlugin, { config: integrationConfig, db });
  await app.register(healthRoutes);
  await app.register(authRoutes, { config: integrationConfig, db });
  await app.register(meRoutes);
  await app.register(collectionsRoutes, { config: integrationConfig, db });
  await app.register(contactsRoutes, { config: integrationConfig, db });
  await app.register(eventsRoutes, { config: integrationConfig, db });
  const syncWorker = new SyncWorker(db, cacheDb, integrationConfig);
  await app.register(syncRoutes, { config: integrationConfig, db, cacheDb, syncWorker });
  await app.ready();
  return app;
}

/** Log in as the test user and return the raw cookie string for inject calls. */
export async function loginAndGetCookie(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: TEST_USER, password: TEST_PASS },
  });
  if (res.statusCode !== 200) {
    throw new Error(
      `Integration login failed (${res.statusCode}): ${res.body}. ` +
      `Is Baikal running at ${integrationConfig.BAIKAL_BASE_URL} with Basic auth and seeded?`,
    );
  }
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error('No set-cookie header after login');
  return raw.split(';')[0]!; // 'dave_session=<value>'
}
