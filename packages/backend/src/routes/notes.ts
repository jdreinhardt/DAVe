import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { CacheDbInstance } from '../db/cache.js';
import type { SessionData } from '../services/session.js';
import type {
  NoteJson,
  NotesResponse,
  NotesQueryParams,
  NoteWriteResponse,
  CreateNoteRequest,
  UpdateNoteRequest,
  TaskRelation,
} from '@dave/shared';
import { requireAuth } from '../plugins/session.js';
import { serializeIcalJournal } from '../lib/ical.js';
import {
  createJournal as davCreateJournal,
  updateJournal as davUpdateJournal,
  deleteJournal as davDeleteJournal,
} from '../lib/dav.js';
import { parseEntry } from '../lib/entryParser.js';
import { upsertEntry, deleteEntryByUid } from '../db/cacheOps.js';
import {
  collectionIdFromUrl,
  buildFtsQuery,
  rowToVJournalEntry,
  type VJournalEntryRow,
  type CategoryRow,
  type RelationRow,
} from '../lib/routeUtils.js';

type SqlValue = string | number | null;

// component_type filter is injected by the caller (notes vs journals differ only here)
function buildNotesQuery(
  userId: string,
  params: NotesQueryParams,
  dtStartPresent: 0 | 1,
): { sql: string; values: SqlValue[] } {
  const clauses: string[] = [
    'e.user_id = ?',
    "e.component_type = 'VJOURNAL'",
    `e.dtstart_present = ${dtStartPresent}`,
  ];
  const values: SqlValue[] = [userId];

  if (params.category) {
    const all = params.category.split(',').map((c) => c.trim()).filter(Boolean);
    const includeNoTags = all.includes('__none__');
    const cats = all.filter((c) => c !== '__none__');
    const sub: string[] = [];
    if (cats.length === 1) {
      sub.push('e.id IN (SELECT entry_id FROM entry_categories WHERE category = ?)');
      values.push(cats[0]!);
    } else if (cats.length > 1) {
      sub.push(`e.id IN (SELECT entry_id FROM entry_categories WHERE category IN (${cats.map(() => '?').join(',')}))`);
      values.push(...cats);
    }
    if (includeNoTags) {
      sub.push('e.id NOT IN (SELECT DISTINCT entry_id FROM entry_categories)');
    }
    if (sub.length === 1) clauses.push(sub[0]!);
    else if (sub.length > 1) clauses.push(`(${sub.join(' OR ')})`);
  }

  if (params.collections) {
    const urls = params.collections.split(',').map((u) => u.trim()).filter(Boolean);
    if (urls.length > 0) {
      clauses.push(`e.collection_url IN (${urls.map(() => '?').join(',')})`);
      values.push(...urls);
    }
  }

  if (params.q?.trim()) {
    const words = params.q.trim().split(/\s+/).filter(Boolean);
    const catMatch = words.map(() => 'lower(category) LIKE lower(?)||\'%\'').join(' OR ');
    clauses.push(`(e.id IN (SELECT rowid FROM entries_fts WHERE entries_fts MATCH ?)
      OR e.id IN (SELECT entry_id FROM entry_categories WHERE ${catMatch}))`);
    values.push(buildFtsQuery(params.q), ...words);
  }

  const where = clauses.join(' AND ');

  const dir = params.order === 'asc' ? 'ASC' : 'DESC';

  let orderBy: string;
  switch (params.sort) {
    case 'summary':
      orderBy = `e.summary ${dir}`;
      break;
    case 'created':
      // id is auto-increment so it serves as a creation-order proxy
      orderBy = `e.id ${dir}`;
      break;
    case 'modified':
      orderBy = `e.last_modified ${dir} NULLS LAST`;
      break;
    case 'category':
      orderBy = `(SELECT MIN(ec.category) FROM entry_categories ec WHERE ec.entry_id = e.id) ${dir} NULLS LAST`;
      break;
    default:
      // Default: modification date descending
      orderBy = 'e.last_modified DESC NULLS LAST';
  }

  const sql = `
    SELECT e.id, e.uid, e.etag, e.collection_url, e.object_url,
           e.summary, e.description, e.dtstart, e.last_modified, e.raw_ics
    FROM entries e
    WHERE ${where}
    ORDER BY ${orderBy}
  `;

  return { sql, values };
}

export async function notesRoutes(
  app: FastifyInstance,
  opts: { cacheDb: CacheDbInstance },
) {
  const { cacheDb } = opts;

  // ── GET /api/notes ──────────────────────────────────────────────────────────

  app.get<{ Querystring: NotesQueryParams }>(
    '/api/notes',
    { preHandler: requireAuth },
    async (req, reply) => {
      const userId = req.sessionData!.username;
      const { sql, values } = buildNotesQuery(userId, req.query, 0);

      let rows: VJournalEntryRow[];
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rows = (cacheDb.prepare(sql).all(...values as any[]) as unknown) as VJournalEntryRow[];
      } catch (err) {
        app.log.warn({ err }, 'notes query failed');
        return reply.status(500).send({ error: 'Cache query failed', statusCode: 500 });
      }

      if (rows.length === 0) {
        const response: NotesResponse = { notes: [], total: 0 };
        return reply.send(response);
      }

      const ids = rows.map((r) => r.id);
      const placeholders = ids.map(() => '?').join(',');

      const catRows = cacheDb.prepare(
        `SELECT entry_id, category FROM entry_categories WHERE entry_id IN (${placeholders})`,
      ).all(...ids) as unknown as CategoryRow[];

      const relRows = cacheDb.prepare(
        `SELECT entry_id, related_uid, reltype FROM entry_relations WHERE entry_id IN (${placeholders})`,
      ).all(...ids) as unknown as RelationRow[];

      const catMap = new Map<number, string[]>();
      for (const cr of catRows) {
        const arr = catMap.get(cr.entry_id) ?? [];
        arr.push(cr.category);
        catMap.set(cr.entry_id, arr);
      }

      const relMap = new Map<number, TaskRelation[]>();
      for (const rr of relRows) {
        const arr = relMap.get(rr.entry_id) ?? [];
        arr.push({ relatedUid: rr.related_uid, reltype: rr.reltype });
        relMap.set(rr.entry_id, arr);
      }

      const notes = rows.map((row) =>
        rowToVJournalEntry(row, catMap.get(row.id) ?? [], relMap.get(row.id) ?? []),
      );

      const response: NotesResponse = { notes, total: notes.length };
      return reply.send(response);
    },
  );

  // ── GET /api/notes/:uid ─────────────────────────────────────────────────────

  app.get<{ Params: { uid: string } }>(
    '/api/notes/:uid',
    { preHandler: requireAuth },
    async (req, reply) => {
      const userId = req.sessionData!.username;
      const { uid } = req.params;

      const row = cacheDb.prepare(`
        SELECT id, uid, etag, collection_url, object_url,
               summary, description, dtstart, last_modified, raw_ics
        FROM entries
        WHERE uid = ? AND user_id = ? AND component_type = 'VJOURNAL'
      `).get(uid, userId) as VJournalEntryRow | undefined;

      if (!row) {
        return reply.status(404).send({ error: 'Note not found', statusCode: 404 });
      }

      const catRows = cacheDb.prepare(
        'SELECT category FROM entry_categories WHERE entry_id = ?',
      ).all(row.id) as { category: string }[];

      const relRows = cacheDb.prepare(
        'SELECT related_uid, reltype FROM entry_relations WHERE entry_id = ?',
      ).all(row.id) as { related_uid: string; reltype: string }[];

      const note = rowToVJournalEntry(
        row,
        catRows.map((c) => c.category),
        relRows.map((r) => ({ relatedUid: r.related_uid, reltype: r.reltype })),
      );

      return reply.send(note);
    },
  );

  // ── POST /api/notes — create ────────────────────────────────────────────────

  app.post<{ Body: CreateNoteRequest }>(
    '/api/notes',
    { preHandler: requireAuth },
    async (req, reply) => {
      const session = req.sessionData as SessionData;
      const { data } = req.body;

      if (!data?.collectionUrl) {
        return reply.status(400).send({ error: 'collectionUrl is required', statusCode: 400 });
      }
      if (!data.summary?.trim()) {
        return reply.status(400).send({ error: 'summary is required', statusCode: 400 });
      }

      // Notes must not carry a DTSTART; journals must have one.
      // Enforce the boundary: creating via /api/notes always clears dtstart.
      const noteData: NoteJson = { ...data, uid: data.uid || randomUUID(), dtstart: null };

      let result;
      try {
        result = await davCreateJournal(session, data.collectionUrl, noteData);
      } catch (err: unknown) {
        const e = err as { statusCode?: number };
        if (e.statusCode === 409) {
          return reply.status(409).send({ error: 'A note with this UID already exists', statusCode: 409 });
        }
        app.log.error({ err }, 'createJournal DAV PUT failed');
        return reply.status(502).send({ error: 'Failed to create note on server', statusCode: 502 });
      }

      const parsed = parseEntry(result.rawIcs, result.url, result.collectionUrl, session.username, result.etag);
      if (parsed) {
        try { upsertEntry(cacheDb, parsed); } catch (e) { app.log.warn({ e }, 'cache upsert failed after create'); }
      }

      const response: NoteWriteResponse = {
        uid: result.uid,
        url: result.url,
        etag: result.etag,
        collectionId: collectionIdFromUrl(result.collectionUrl),
        collectionUrl: result.collectionUrl,
        data: { ...noteData, uid: result.uid },
      };
      return reply.status(201).send(response);
    },
  );

  // ── PUT /api/notes/:uid — update (also handles convert-to-journal) ──────────

  app.put<{ Params: { uid: string }; Body: UpdateNoteRequest }>(
    '/api/notes/:uid',
    { preHandler: requireAuth },
    async (req, reply) => {
      const session = req.sessionData as SessionData;
      const { uid } = req.params;
      const { data, etag } = req.body;

      if (!data?.summary?.trim()) {
        return reply.status(400).send({ error: 'summary is required', statusCode: 400 });
      }

      const existing = cacheDb.prepare(`
        SELECT object_url, collection_url, raw_ics
        FROM entries
        WHERE uid = ? AND user_id = ? AND component_type = 'VJOURNAL'
      `).get(uid, session.username) as { object_url: string; collection_url: string; raw_ics: string | null } | undefined;

      if (!existing) {
        return reply.status(404).send({ error: 'Note not found', statusCode: 404 });
      }

      const entryData: NoteJson = { ...data, uid };

      const isMove = data.collectionUrl && data.collectionUrl !== existing.collection_url;

      let result;
      try {
        if (isMove) {
          await davDeleteJournal(session, existing.object_url, etag);
          result = await davCreateJournal(session, data.collectionUrl, entryData);
        } else {
          result = await davUpdateJournal(
            session,
            existing.object_url,
            existing.collection_url,
            entryData,
            etag,
            existing.raw_ics ?? serializeIcalJournal(entryData),
          );
        }
      } catch (err: unknown) {
        const e = err as { statusCode?: number };
        if (e.statusCode === 412) {
          return reply.status(412).send({
            error: 'conflict',
            message: 'This entry was modified elsewhere. Reload to see the latest version.',
            statusCode: 412,
          });
        }
        app.log.error({ err }, 'updateJournal DAV PUT failed');
        return reply.status(502).send({ error: 'Failed to update note on server', statusCode: 502 });
      }

      if (isMove) {
        // Remove old cache entry under the old object_url before upserting the new one.
        deleteEntryByUid(cacheDb, uid, session.username);
      }

      const parsed = parseEntry(result.rawIcs, result.url, result.collectionUrl, session.username, result.etag);
      if (parsed) {
        try { upsertEntry(cacheDb, parsed); } catch (e) { app.log.warn({ e }, 'cache upsert failed after update'); }
      }

      const response: NoteWriteResponse = {
        uid: result.uid,
        url: result.url,
        etag: result.etag,
        collectionId: collectionIdFromUrl(result.collectionUrl),
        collectionUrl: result.collectionUrl,
        data: entryData,
      };
      return reply.send(response);
    },
  );

  // ── DELETE /api/notes/:uid ──────────────────────────────────────────────────

  app.delete<{ Params: { uid: string }; Querystring: { etag: string } }>(
    '/api/notes/:uid',
    { preHandler: requireAuth },
    async (req, reply) => {
      const session = req.sessionData as SessionData;
      const { uid } = req.params;
      const { etag } = req.query;

      if (!etag) {
        return reply.status(400).send({ error: 'etag query parameter is required', statusCode: 400 });
      }

      const existing = cacheDb.prepare(`
        SELECT object_url
        FROM entries
        WHERE uid = ? AND user_id = ? AND component_type = 'VJOURNAL'
      `).get(uid, session.username) as { object_url: string } | undefined;

      if (!existing) {
        return reply.status(404).send({ error: 'Note not found', statusCode: 404 });
      }

      try {
        await davDeleteJournal(session, existing.object_url, etag);
      } catch (err: unknown) {
        const e = err as { statusCode?: number };
        if (e.statusCode === 412) {
          return reply.status(412).send({
            error: 'conflict',
            message: 'This entry was modified elsewhere. Reload before deleting.',
            statusCode: 412,
          });
        }
        app.log.error({ err }, 'deleteJournal DAV DELETE failed');
        return reply.status(502).send({ error: 'Failed to delete note on server', statusCode: 502 });
      }

      deleteEntryByUid(cacheDb, uid, session.username);
      return reply.status(204).send();
    },
  );
}
