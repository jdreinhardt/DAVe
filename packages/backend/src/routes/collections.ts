import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { DbInstance as DatabaseSync } from '../db/index.js';
import type { Config } from '../config.js';
import type {
  AddressBook, Calendar, Contact, CalendarEvent,
  CreateAddressBookRequest, UpdateAddressBookRequest,
  CreateCalendarRequest, UpdateCalendarRequest,
} from '@dave/shared';
import {
  listAddressBooks, listCalendars, fetchContacts, fetchEvents,
  createAddressBook, updateAddressBook, deleteAddressBook,
  createCalendar, updateCalendar, deleteCalendar,
} from '../lib/dav.js';
import { deleteSession } from '../services/session.js';
import { requireAuth, COOKIE_NAME } from '../plugins/session.js';

function davStatusCode(e: unknown): number | null {
  if (e && typeof e === 'object' && 'statusCode' in e) {
    return (e as { statusCode: number }).statusCode;
  }
  return null;
}

async function handleDavError(
  e: unknown,
  req: FastifyRequest,
  reply: FastifyReply,
  app: FastifyInstance,
  db: DatabaseSync,
): Promise<void> {
  const msg = e instanceof Error ? e.message : String(e);
  const code = davStatusCode(e);

  if (code === 401 || msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
    if (req.sessionId) deleteSession(req.sessionId, db);
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    await reply.status(401).send({ error: 'Session expired, please log in again', statusCode: 401 });
    return;
  }
  if (code === 403) {
    await reply.status(403).send({ error: 'Permission denied', statusCode: 403 });
    return;
  }
  if (code === 404) {
    await reply.status(404).send({ error: 'Not found', statusCode: 404 });
    return;
  }
  if (code === 409) {
    await reply.status(409).send({ error: 'Conflict — a collection with that name may already exist', statusCode: 409 });
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

  // ── Address book management ──────────────────────────────────────────────────

  app.post<{ Body: CreateAddressBookRequest }>(
    '/api/addressbooks',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { displayName, description } = req.body ?? {};
      if (!displayName?.trim()) {
        return reply.status(400).send({ error: 'displayName is required', statusCode: 400 });
      }
      try {
        await createAddressBook(req.sessionData!, { displayName: displayName.trim(), description }, config);
        const books = await listAddressBooks(req.sessionData!, config);
        return reply.status(201).send(books as AddressBook[]);
      } catch (e) {
        await handleDavError(e, req, reply, app, db);
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: UpdateAddressBookRequest }>(
    '/api/addressbooks/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { displayName, description } = req.body ?? {};
      if (!displayName?.trim()) {
        return reply.status(400).send({ error: 'displayName is required', statusCode: 400 });
      }
      try {
        await updateAddressBook(req.sessionData!, req.params.id, { displayName: displayName.trim(), description }, config);
        const books = await listAddressBooks(req.sessionData!, config);
        return reply.send(books as AddressBook[]);
      } catch (e) {
        await handleDavError(e, req, reply, app, db);
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/addressbooks/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        await deleteAddressBook(req.sessionData!, req.params.id, config);
        return reply.status(204).send();
      } catch (e) {
        await handleDavError(e, req, reply, app, db);
      }
    },
  );

  // ── Calendar management ──────────────────────────────────────────────────────

  app.post<{ Body: CreateCalendarRequest }>(
    '/api/calendars',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { displayName, description, color, components } = req.body ?? {};
      if (!displayName?.trim()) {
        return reply.status(400).send({ error: 'displayName is required', statusCode: 400 });
      }
      try {
        await createCalendar(
          req.sessionData!,
          {
            displayName: displayName.trim(),
            description,
            color: color || '#0082C9',
            components: Array.isArray(components) && components.length > 0 ? components : ['VEVENT'],
          },
          config,
        );
        const calendars = await listCalendars(req.sessionData!, config);
        return reply.status(201).send(calendars as Calendar[]);
      } catch (e) {
        await handleDavError(e, req, reply, app, db);
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: UpdateCalendarRequest }>(
    '/api/calendars/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { displayName, description, color } = req.body ?? {};
      if (!displayName?.trim()) {
        return reply.status(400).send({ error: 'displayName is required', statusCode: 400 });
      }
      try {
        await updateCalendar(
          req.sessionData!,
          req.params.id,
          { displayName: displayName.trim(), description, color: color || '#0082C9' },
          config,
        );
        const calendars = await listCalendars(req.sessionData!, config);
        return reply.send(calendars as Calendar[]);
      } catch (e) {
        await handleDavError(e, req, reply, app, db);
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/calendars/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        await deleteCalendar(req.sessionData!, req.params.id, config);
        return reply.status(204).send();
      } catch (e) {
        await handleDavError(e, req, reply, app, db);
      }
    },
  );
}
