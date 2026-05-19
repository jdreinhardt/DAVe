import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { healthRoutes } from '../routes/health.js';

describe('GET /healthz', () => {
  it('returns 200 with { status: "ok" }', async () => {
    const app = Fastify({ logger: false });
    await app.register(healthRoutes);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
