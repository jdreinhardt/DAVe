import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { DbInstance as DatabaseSync } from '../db/index.js';
import type { Config } from '../config.js';
import type { AddressBook, Calendar, Contact, CalendarEvent } from '@dave/shared';
import { listAddressBooks, listCalendars, fetchContacts, fetchEvents } from '../lib/dav.js';
import { deleteSession } from '../services/session.js';
import { requireAuth, COOKIE_NAME } from '../plugins/session.js';

async function handleDavError(
  e: unknown,
  req: FastifyRequest,
  reply: FastifyReply,
  app: FastifyInstance,
  db: DatabaseSync,
): Promise<void> {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
    if (req.sessionId) deleteSession(req.sessionId, db);
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    await reply
      .status(401)
      .send({ error: 'Session expired, please log in again', statusCode: 401 });
    return;
  }
  app.log.error({ err: e }, 'DAV request failed');
  await reply.status(502).send({ error: 'Failed to communicate with Baikal', statusCode: 502 });
}

export async function collectionsRoutes(
  app: FastifyInstance,
  opts: { config: Config; db: DatabaseSync },
) {
  const { config, db } = opts;

  app.get('/api/addressbooks', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const books = await listAddressBooks(req.sessionData!, config);
      return reply.send(books as AddressBook[]);
    } catch (e) {
      await handleDavError(e, req, reply, app, db);
    }
  });

  app.get('/api/calendars', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const calendars = await listCalendars(req.sessionData!, config);
      return reply.send(calendars as Calendar[]);
    } catch (e) {
      await handleDavError(e, req, reply, app, db);
    }
  });

  app.get<{ Params: { id: string } }>(
    '/api/addressbooks/:id/contacts',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const contacts = await fetchContacts(req.sessionData!, req.params.id, config);
        return reply.send(contacts as Contact[]);
      } catch (e) {
        await handleDavError(e, req, reply, app, db);
      }
    },
  );

  app.get<{ Params: { id: string }; Querystring: { start?: string; end?: string } }>(
    '/api/calendars/:id/events',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { start, end } = req.query;
      if (!start || !end) {
        return reply.status(400).send({ error: 'start and end query params are required', statusCode: 400 });
      }
      try {
        const events = await fetchEvents(req.sessionData!, req.params.id, start, end, config);
        return reply.send(events as CalendarEvent[]);
      } catch (e) {
        await handleDavError(e, req, reply, app, db);
      }
    },
  );
}
