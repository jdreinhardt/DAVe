import type { FastifyInstance } from 'fastify';
import type { DbInstance as DatabaseSync } from '../db/index.js';
import type { Config } from '../config.js';
import { discoverAndValidate } from '../lib/dav.js';
import { createSession, deleteSession } from '../services/session.js';
import { COOKIE_NAME, requireAuth } from '../plugins/session.js';

export async function authRoutes(
  app: FastifyInstance,
  opts: { config: Config; db: DatabaseSync },
) {
  const { config, db } = opts;

  // POST /api/auth/login
  app.post<{ Body: { username: string; password: string } }>(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', minLength: 1 },
            password: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      const { username, password } = req.body;

      let discovery;
      try {
        discovery = await discoverAndValidate(username, password, config);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // tsdav surfaces 401 in the error message or as an HTTP status.
        if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
          return reply.status(401).send({ error: 'Invalid credentials', statusCode: 401 });
        }
        app.log.error({ err: e }, 'DAV discovery failed');
        // ECONNREFUSED / ENOTFOUND → server is not reachable at all.
        // Anything else (e.g. Baikal setup wizard returning HTML) → reachable but not ready.
        const isNetworkError =
          e instanceof Error &&
          ('code' in e
            ? (e as NodeJS.ErrnoException).code === 'ECONNREFUSED' ||
              (e as NodeJS.ErrnoException).code === 'ENOTFOUND'
            : msg.toLowerCase().includes('econnrefused') ||
              msg.toLowerCase().includes('enotfound'));
        const errorText = isNetworkError
          ? 'Could not reach the Baikal server — check BAIKAL_BASE_URL and that Baikal is running'
          : 'Baikal responded unexpectedly — make sure the Baikal admin setup wizard has been completed';
        return reply.status(502).send({ error: errorText, statusCode: 502 });
      }

      const sessionId = createSession(
        {
          username,
          password,
          displayName: discovery.displayName,
          principalUrl: discovery.principalUrl,
          calendarHomeUrl: discovery.calendarHomeUrl,
          addressBookHomeUrl: discovery.addressBookHomeUrl,
        },
        config.SESSION_SECRET,
        db,
      );

      reply.setCookie(COOKIE_NAME, sessionId, {
        httpOnly: true,
        secure: config.TRUST_PROXY, // only set Secure when behind HTTPS proxy
        sameSite: 'lax',
        path: '/',
      });

      return reply.status(200).send({ ok: true });
    },
  );

  // POST /api/auth/logout
  app.post(
    '/api/auth/logout',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (req.sessionId) deleteSession(req.sessionId, db);
      reply.clearCookie(COOKIE_NAME, { path: '/' });
      return reply.status(204).send();
    },
  );
}
