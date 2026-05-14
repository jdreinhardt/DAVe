import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './config.js';
import { healthRoutes } from './routes/health.js';

const config = loadConfig();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// ── Routes ────────────────────────────────────────────────────────────────────

await app.register(healthRoutes);

// ── Static frontend (production only) ────────────────────────────────────────
// In development the Vite dev server serves the frontend on its own port.

if (config.NODE_ENV === 'production') {
  const publicDir =
    config.FRONTEND_DIST ?? path.resolve(__dirname, 'public');

  if (fs.existsSync(publicDir)) {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
    });

    // SPA fallback — all non-API routes return index.html.
    app.setNotFoundHandler(async (_req, reply) => {
      return reply.sendFile('index.html');
    });
  } else {
    app.log.warn(`Frontend build not found at ${publicDir} — static serving disabled`);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

try {
  await app.listen({ port: config.PORT, host: config.BIND_ADDRESS });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
