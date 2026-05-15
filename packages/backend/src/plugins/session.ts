import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { DbInstance as DatabaseSync } from '../db/index.js';
import type { Config } from '../config.js';
import { getSession, touchSession, type SessionData } from '../services/session.js';

export const COOKIE_NAME = 'dave_session';

// Augment FastifyRequest so routes have typed access to session data.
declare module 'fastify' {
  interface FastifyRequest {
    sessionId: string | null;
    sessionData: SessionData | null;
  }
}

export default fp(
  async function sessionPlugin(
    app: FastifyInstance,
    opts: { config: Config; db: DatabaseSync },
  ) {
    const { config, db } = opts;

    app.decorateRequest('sessionId', null);
    app.decorateRequest('sessionData', null);

    // Resolve session after @fastify/cookie has parsed cookies.
    app.addHook('onRequest', async (req, reply) => {
      const rawId = req.cookies[COOKIE_NAME];
      if (!rawId) return;

      const data = getSession(rawId, config.SESSION_SECRET, config.SESSION_TTL_HOURS, db);
      if (!data) {
        reply.clearCookie(COOKIE_NAME, { path: '/' });
        return;
      }

      req.sessionId = rawId;
      req.sessionData = data;
      touchSession(rawId, db);
    });
  },
  { name: 'session' },
);

// ── requireAuth preHandler ─────────────────────────────────────────────────────

export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!req.sessionData) {
    await reply.status(401).send({ error: 'Not authenticated', statusCode: 401 });
  }
}
