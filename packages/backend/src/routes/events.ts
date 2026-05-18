import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { DbInstance as DatabaseSync } from '../db/index.js';
import type { Config } from '../config.js';
import type { EventJson, UpdateEventRequest } from '@dave/shared';
import { createEvent, updateEvent, deleteEvent, updateEventScoped, deleteEventScoped } from '../lib/dav.js';
import { deleteSession } from '../services/session.js';
import { requireAuth, COOKIE_NAME } from '../plugins/session.js';

async function handleDavError(
  e: unknown,
  req: FastifyRequest,
  reply: FastifyReply,
  app: FastifyInstance,
  db: DatabaseSync,
): Promise<void> {
  const err = e as { statusCode?: number; message?: string } & Error;
  const code = err.statusCode;

  if (code === 412) {
    await reply.status(412).send({
      error: 'Event was modified by another client. Please reload and try again.',
      statusCode: 412,
    });
    return;
  }
  if (code === 409) {
    await reply.status(409).send({
      error: 'An event with this UID already exists.',
      statusCode: 409,
    });
    return;
  }

  const msg = err.message ?? String(e);
  if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
    if (req.sessionId) deleteSession(req.sessionId, db);
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    await reply.status(401).send({ error: 'Session expired, please log in again', statusCode: 401 });
    return;
  }

  app.log.error({ err: e }, 'DAV event write failed');
  await reply.status(502).send({ error: 'Failed to communicate with Baikal', statusCode: 502 });
}

export async function eventsRoutes(
  app: FastifyInstance,
  opts: { config: Config; db: DatabaseSync },
) {
  const { config, db } = opts;

  // ── Create ──────────────────────────────────────────────────────────────────

  app.post<{ Params: { id: string }; Body: { data: EventJson } }>(
    '/api/calendars/:id/events',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { data } = req.body;
      if (!data) {
        return reply.status(400).send({ error: 'Missing event data', statusCode: 400 });
      }
      try {
        const result = await createEvent(req.sessionData!, req.params.id, data, config);
        return reply.status(201).send(result);
      } catch (e) {
        await handleDavError(e, req, reply, app, db);
      }
    },
  );

  // ── Update ──────────────────────────────────────────────────────────────────

  app.put<{ Params: { eventId: string }; Body: UpdateEventRequest }>(
    '/api/events/:eventId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { data, etag, scope } = req.body;
      if (!data || !etag) {
        return reply.status(400).send({ error: 'Missing data or etag', statusCode: 400 });
      }
      if (!data.calendarId) {
        return reply.status(400).send({ error: 'Missing calendarId in event data', statusCode: 400 });
      }
      try {
        // When a scope is explicitly provided the request involves a recurring event
        // and must go through updateEventScoped (which preserves exceptions for
        // scope=all and handles this/following correctly). When no scope is provided
        // the event is non-recurring and we use the simpler updateEvent path.
        const result = scope != null
          ? await updateEventScoped(req.sessionData!, data.calendarId, req.params.eventId, data, etag, scope, config)
          : await updateEvent(req.sessionData!, data.calendarId, req.params.eventId, data, etag, config);
        return reply.send(result);
      } catch (e) {
        await handleDavError(e, req, reply, app, db);
      }
    },
  );

  // ── Delete ──────────────────────────────────────────────────────────────────

  app.delete<{
    Params: { eventId: string };
    Querystring: {
      etag: string;
      calendarId: string;
      scope?: string;
      recurrenceId?: string;
      allDay?: string;
    };
  }>(
    '/api/events/:eventId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { etag, calendarId, scope: scopeParam, recurrenceId, allDay: allDayParam } = req.query;
      if (!etag || !calendarId) {
        return reply.status(400).send({ error: 'Missing etag or calendarId query parameter', statusCode: 400 });
      }
      const scope = (scopeParam === 'this' || scopeParam === 'following') ? scopeParam : 'all';
      const allDay = allDayParam === 'true';
      try {
        if (scope === 'all') {
          await deleteEvent(req.sessionData!, calendarId, req.params.eventId, etag, config);
        } else {
          if (!recurrenceId) {
            return reply.status(400).send({ error: 'recurrenceId required for scoped delete', statusCode: 400 });
          }
          await deleteEventScoped(req.sessionData!, calendarId, req.params.eventId, etag, scope, recurrenceId, allDay, config);
        }
        return reply.status(204).send();
      } catch (e) {
        await handleDavError(e, req, reply, app, db);
      }
    },
  );
}
