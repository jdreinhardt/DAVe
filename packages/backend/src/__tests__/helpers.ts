import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import type { DbInstance } from '../db/index.js';
import type { CacheDbInstance } from '../db/cache.js';
import { applySchema } from '../db/cache.js';
import type { Config } from '../config.js';
import sessionPlugin from '../plugins/session.js';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

export const TEST_SECRET = 'test-secret-that-is-32-chars-min!!';

export const testConfig: Config = {
  BAIKAL_BASE_URL: 'http://baikal.test/dav.php',
  SESSION_SECRET: TEST_SECRET,
  SESSION_TTL_HOURS: 168,
  PORT: 3001,
  BIND_ADDRESS: '0.0.0.0',
  TRUST_PROXY: false,
  NODE_ENV: 'test',
  DATA_DIR: '/tmp/test-dave',
  SYNC_INTERVAL_SECONDS: 60,
  MAX_CACHED_ENTRIES_PER_USER: 10000,
  COMPLETED_TASK_RETENTION_DAYS: 7,
  BAIKAL_ARCHIVE_SEARCH_MAX_AGE_DAYS: 365,
  EVENT_SEARCH_RANGE_DAYS: 60,
};

/** Create an in-memory SQLite DB with the sessions table schema. */
export function makeDb(): DbInstance {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id               TEXT    PRIMARY KEY,
      data             TEXT    NOT NULL,
      created_at       INTEGER NOT NULL,
      last_activity_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_last_activity
      ON sessions(last_activity_at);
  `);
  return db;
}

/** Create an in-memory SQLite DB with the cache schema. */
export function makeCacheDb(): CacheDbInstance {
  const db = new DatabaseSync(':memory:');
  applySchema(db);
  return db;
}

/**
 * Build a minimal Fastify instance with cookie + session plugins registered.
 * Pass a route registration callback to add routes under test.
 */
export async function buildApp(
  registerRoutes: (app: FastifyInstance, config: Config, db: DbInstance) => Promise<void>,
  db?: DbInstance,
): Promise<FastifyInstance> {
  const testDb = db ?? makeDb();
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  await app.register(sessionPlugin, { config: testConfig, db: testDb });
  await registerRoutes(app, testConfig, testDb);
  await app.ready();
  return app;
}
