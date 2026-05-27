import type { FastifyInstance } from 'fastify';
import type { CacheDbInstance } from '../db/cache.js';
import { requireAuth } from '../plugins/session.js';

// Stub routes for Journals (Milestone 8).
// The full implementation (Timeline view, List view, Calendar view) is Milestone 8.
// These stubs exist so the frontend /journals route has valid endpoints to call,
// and so the convert-to-journal flow (PUT /api/notes/:uid with dtstart set) works
// end-to-end today — the converted entry is stored in the cache and will appear
// here once the real list endpoint is wired up.
export async function journalsRoutes(
  app: FastifyInstance,
  _opts: { cacheDb: CacheDbInstance },
) {
  app.get('/api/journals', { preHandler: requireAuth }, async (_req, reply) => {
    return reply.send({ journals: [], total: 0 });
  });
}
