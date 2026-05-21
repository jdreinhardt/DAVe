import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './config.js';
import { getDb } from './db/index.js';
import { getCacheDb } from './db/cache.js';
import { sweepExpiredSessions } from './services/session.js';
import { SyncWorker } from './workers/syncWorker.js';
import sessionPlugin from './plugins/session.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { collectionsRoutes } from './routes/collections.js';
import { contactsRoutes } from './routes/contacts.js';
import { eventsRoutes } from './routes/events.js';
import { syncRoutes } from './routes/sync.js';
import { tasksRoutes } from './routes/tasks.js';

const config = loadConfig();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = getDb(config);
const cacheDb = getCacheDb(config);

const app = Fastify({
  logger: {
    level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    transport:
      config.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
  trustProxy: config.TRUST_PROXY,
});

// ── Plugins ───────────────────────────────────────────────────────────────────

await app.register(fastifyCookie);
await app.register(sessionPlugin, { config, db });

// ── Sync worker (created before routes so routes can reference it) ─────────

const syncWorker = new SyncWorker(db, cacheDb, config);

// ── Routes ────────────────────────────────────────────────────────────────────

await app.register(healthRoutes);
await app.register(authRoutes, { config, db });
await app.register(meRoutes);
await app.register(collectionsRoutes, { config, db });
await app.register(contactsRoutes, { config, db });
await app.register(eventsRoutes, { config, db });
await app.register(syncRoutes, { config, db, cacheDb, syncWorker });
await app.register(tasksRoutes, { cacheDb, config });

// ── Static frontend (production only) ────────────────────────────────────────

if (config.NODE_ENV === 'production') {
  const publicDir =
    config.FRONTEND_DIST ?? path.resolve(__dirname, 'public');

  if (fs.existsSync(publicDir)) {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
    });

    // SPA fallback — /api/* gets a 404 JSON; everything else gets index.html.
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'Not found', statusCode: 404 });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.log.warn(`Frontend build not found at ${publicDir} — static serving disabled`);
  }
}

// ── Background tasks ──────────────────────────────────────────────────────────

setInterval(
  () => {
    const deleted = sweepExpiredSessions(config.SESSION_TTL_HOURS, db);
    if (deleted > 0) app.log.info(`Swept ${deleted} expired session(s)`);
  },
  60 * 60 * 1000,
);

// ── Start ─────────────────────────────────────────────────────────────────────

try {
  await app.listen({ port: config.PORT, host: config.BIND_ADDRESS });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Start the sync worker after the server is listening so app.log is fully set up.
syncWorker.start(app.log);

// ── Graceful shutdown ─────────────────────────────────────────────────────────

const shutdown = async () => {
  syncWorker.stop();
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
