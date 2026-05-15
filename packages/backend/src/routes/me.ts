import type { FastifyInstance } from 'fastify';
import type { MeResponse } from '@dave/shared';
import { requireAuth } from '../plugins/session.js';

export async function meRoutes(app: FastifyInstance) {
  app.get<{ Reply: MeResponse }>(
    '/api/me',
    { preHandler: requireAuth },
    async (req, reply) => {
      const s = req.sessionData!;
      return reply.send({
        username: s.username,
        displayName: s.displayName,
        principalUrl: s.principalUrl,
      });
    },
  );
}
