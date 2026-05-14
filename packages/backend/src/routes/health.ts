import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/healthz', async (_req, reply) => {
    return reply.send({ status: 'ok' });
  });
}
