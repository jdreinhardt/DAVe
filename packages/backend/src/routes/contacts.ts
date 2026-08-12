import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { DbInstance as DatabaseSync } from '../db/index.js';
import type { Config } from '../config.js';
import type {
  ContactJson,
  UpdateContactRequest,
  ImportContactsRequest,
} from '@dave/shared';
import {
  createContact,
  updateContact,
  deleteContact,
  fetchRawContacts,
  fetchContacts,
} from '../lib/dav.js';
import { parseVCard, serializeVCard } from '../lib/vcard.js';
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

  // A rejected request target never reached the DAV server, so it's a client
  // error rather than a bad gateway.
  if (code === 400) {
    await reply.status(400).send({ error: 'Invalid request', statusCode: 400 });
    return;
  }
  if (code === 412) {
    await reply.status(412).send({
      error: 'Contact was modified by another client. Please reload and try again.',
      statusCode: 412,
    });
    return;
  }
  if (code === 409) {
    await reply.status(409).send({
      error: 'A contact with this UID already exists.',
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

  app.log.error({ err: e }, 'DAV contact write failed');
  await reply.status(502).send({ error: 'Failed to communicate with the DAV server', statusCode: 502 });
}

export async function contactsRoutes(
  app: FastifyInstance,
  opts: { config: Config; db: DatabaseSync },
) {
  const { config, db } = opts;

  // ── Create ──────────────────────────────────────────────────────────────────

  app.post<{ Params: { id: string }; Body: { data: ContactJson } }>(
    '/api/addressbooks/:id/contacts',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { data } = req.body;
      if (!data) {
        return reply.status(400).send({ error: 'Missing contact data', statusCode: 400 });
      }
      try {
        const result = await createContact(req.sessionData!, req.params.id, data, config);
        return reply.status(201).send(result);
      } catch (e) {
        await handleDavError(e, req, reply, app, db);
      }
    },
  );

  // ── Update ──────────────────────────────────────────────────────────────────

  app.put<{
    Params: { id: string; contactId: string };
    Body: UpdateContactRequest;
  }>(
    '/api/addressbooks/:id/contacts/:contactId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { data, etag } = req.body;
      if (!data || !etag) {
        return reply.status(400).send({ error: 'Missing data or etag', statusCode: 400 });
      }
      try {
        const result = await updateContact(
          req.sessionData!,
          req.params.id,
          req.params.contactId,
          data,
          etag,
          config,
        );
        return reply.send(result);
      } catch (e) {
        await handleDavError(e, req, reply, app, db);
      }
    },
  );

  // ── Delete ──────────────────────────────────────────────────────────────────

  app.delete<{
    Params: { id: string; contactId: string };
    Querystring: { etag: string };
  }>(
    '/api/addressbooks/:id/contacts/:contactId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { etag } = req.query;
      if (!etag) {
        return reply.status(400).send({ error: 'Missing etag query parameter', statusCode: 400 });
      }
      try {
        await deleteContact(req.sessionData!, req.params.id, req.params.contactId, etag, config);
        return reply.status(204).send();
      } catch (e) {
        await handleDavError(e, req, reply, app, db);
      }
    },
  );

  // ── Import ──────────────────────────────────────────────────────────────────

  app.post<{ Params: { id: string }; Body: ImportContactsRequest }>(
    '/api/addressbooks/:id/import',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { vcf } = req.body;
      if (typeof vcf !== 'string' || !vcf.trim()) {
        return reply.status(400).send({ error: 'Missing vcf content', statusCode: 400 });
      }

      // Split raw .vcf into individual VCARD blocks
      const blocks = vcf
        .split(/(?=BEGIN:VCARD)/i)
        .map((b) => b.trim())
        .filter((b) => /BEGIN:VCARD/i.test(b) && /END:VCARD/i.test(b));

      let imported = 0;
      let failed = 0;

      for (const block of blocks) {
        try {
          const parsed = parseVCard(block);
          // Generate a new UID if missing to avoid collisions
          if (!parsed.uid) parsed.uid = crypto.randomUUID();
          await createContact(req.sessionData!, req.params.id, parsed, config);
          imported++;
        } catch {
          failed++;
        }
      }

      return reply.send({ imported, failed });
    },
  );

  // ── Export ──────────────────────────────────────────────────────────────────

  app.get<{ Params: { id: string }; Querystring: { ids?: string } }>(
    '/api/addressbooks/:id/export',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        // Optional filter: comma-separated contact IDs (last path segment without .vcf)
        const filterIds = req.query.ids
          ? new Set(req.query.ids.split(',').filter(Boolean))
          : null;

        const urlToId = (url: string): string => {
          const seg = url.replace(/\/$/, '').split('/').filter(Boolean);
          return (seg[seg.length - 1] ?? url).replace(/\.vcf$/i, '');
        };

        let vcfContent: string;
        try {
          const raws = await fetchRawContacts(req.sessionData!, req.params.id, config);
          const filtered = filterIds ? raws.filter((r) => filterIds.has(urlToId(r.url))) : raws;
          vcfContent = filtered.map((r) => r.raw.trim()).join('\r\n') + '\r\n';
        } catch {
          const contacts = await fetchContacts(req.sessionData!, req.params.id, config);
          const filtered = filterIds ? contacts.filter((c) => filterIds.has(c.id)) : contacts;
          vcfContent = filtered.map((c) => serializeVCard(c.data)).join('');
        }

        reply.header('Content-Type', 'text/vcard; charset=utf-8');
        reply.header('Content-Disposition', 'attachment');
        return reply.send(vcfContent);
      } catch (e) {
        await handleDavError(e, req, reply, app, db);
      }
    },
  );
}
