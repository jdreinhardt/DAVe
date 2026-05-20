import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { DbInstance as DatabaseSync } from '../db/index.js';
import type { CacheDbInstance } from '../db/cache.js';
import type { Config } from '../config.js';
import type { CollectionSyncRequest, CollectionSyncResponse, SyncWorkerHealth } from '@dave/shared';
import { syncAddressBook, syncCalendar } from '../lib/dav.js';
import { deleteSession } from '../services/session.js';
import { requireAuth, COOKIE_NAME } from '../plugins/session.js';
import type { SyncWorker } from '../workers/syncWorker.js';

async function handleDavError(
  e: unknown,
  req: FastifyRequest,
  reply: FastifyReply,
  app: FastifyInstance,
  db: DatabaseSync,
): Promise<void> {
  const err = e as { statusCode?: number; message?: string } & Error;
  const msg = err.message ?? String(e);
  if (err.statusCode === 401 || msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
    if (req.sessionId) deleteSession(req.sessionId, db);
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    await reply.status(401).send({ error: 'Session expired, please log in again', statusCode: 401 });
    return;
  }
  app.log.error({ err: e }, 'DAV sync failed');
  await reply.status(502).send({ error: 'Failed to communicate with Baikal', statusCode: 502 });
}

export async function syncRoutes(
  app: FastifyInstance,
  opts: { config: Config; db: DatabaseSync; cacheDb: CacheDbInstance; syncWorker: SyncWorker },
) {
  const { config, db, syncWorker } = opts;

  // ── Existing collection sync (events / contacts) ──────────────────────────

  app.post<{ Body: CollectionSyncRequest }>(
    '/api/sync',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { addressbooks = [], calendars = [] } = req.body ?? {};

      try {
        const [abResults, calResults] = await Promise.all([
          Promise.allSettled(
            addressbooks.map((ab) =>
              syncAddressBook(req.sessionData!, ab.id, ab.syncToken, config).then((r) => ({
                id: ab.id,
                ...r,
              })),
            ),
          ),
          Promise.allSettled(
            calendars.map((cal) =>
              syncCalendar(req.sessionData!, cal.id, cal.syncToken, config).then((r) => ({
                id: cal.id,
                ...r,
              })),
            ),
          ),
        ]);

        const response: CollectionSyncResponse = {
          addressbooks: abResults
            .filter((r) => r.status === 'fulfilled')
            .map((r) => (r as PromiseFulfilledResult<CollectionSyncResponse['addressbooks'][0]>).value),
          calendars: calResults
            .filter((r) => r.status === 'fulfilled')
            .map((r) => (r as PromiseFulfilledResult<CollectionSyncResponse['calendars'][0]>).value),
        };

        for (const r of [...abResults, ...calResults]) {
          if (r.status === 'rejected') {
            app.log.debug({ err: r.reason }, 'Sync of one collection failed');
          }
        }

        return reply.send(response);
      } catch (e) {
        await handleDavError(e, req, reply, app, db);
      }
    },
  );

  // ── Cache sync worker ─────────────────────────────────────────────────────

  app.get<{ Reply: SyncWorkerHealth }>(
    '/api/sync/cache/health',
    { preHandler: requireAuth },
    async (_req, reply) => {
      return reply.send(syncWorker.health());
    },
  );

  app.post(
    '/api/sync/tasks',
    { preHandler: requireAuth },
    async (req, reply) => {
      const username = req.sessionData!.username;
      // Fire-and-forget; the UI doesn't wait for full sync completion.
      void syncWorker.triggerForUser(username);
      return reply.status(202).send({ ok: true });
    },
  );

  // Notes and Journals share VJOURNAL collections so one endpoint covers both.
  app.post(
    '/api/sync/notes',
    { preHandler: requireAuth },
    async (req, reply) => {
      const username = req.sessionData!.username;
      void syncWorker.triggerForUser(username);
      return reply.status(202).send({ ok: true });
    },
  );
}
