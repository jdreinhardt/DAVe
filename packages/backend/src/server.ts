import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './config.js';
import { getDb } from './db/index.js';
import { sweepExpiredSessions } from './services/session.js';
import sessionPlugin from './plugins/session.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { collectionsRoutes } from './routes/collections.js';

const config = loadConfig();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = getDb(config);

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

// ── Routes ────────────────────────────────────────────────────────────────────

await app.register(healthRoutes);
await app.register(authRoutes, { config, db });
await app.register(meRoutes);
await app.register(collectionsRoutes, { config, db });

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

// Sweep expired sessions once an hour.
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
