import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { CacheDbInstance } from '../db/cache.js';
import type { SessionData } from '../services/session.js';
import type {
  Note,
  NoteJson,
  JournalsQueryParams,
  JournalsResponse,
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

const _req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ICAL = _req('ical.js') as any;

interface EntryRow {
  id: number;
  uid: string;
  etag: string;
  collection_url: string;
  object_url: string;
  summary: string;
  description: string;
  dtstart: number | null;
  last_modified: number | null;
  raw_ics: string | null;
}

interface CategoryRow {
  entry_id: number;
  category: string;
}

interface RelationRow {
  entry_id: number;
  related_uid: string;
  reltype: string;
}

function collectionIdFromUrl(url: string): string {
  try {
    const seg = new URL(url).pathname.replace(/\/$/, '').split('/').filter(Boolean);
    return seg[seg.length - 1] ?? url;
  } catch {
    return url;
  }
}

function msToIso(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  return new Date(ms).toISOString();
}

// Re-parse dtstart from the raw ICS to preserve DATE vs DATE-TIME distinction.
function parseDtstartFromIcs(rawIcs: string | null): string | null {
  if (!rawIcs) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jcal: any = ICAL.parse(rawIcs);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vcal = new ICAL.Component(jcal) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vjournal: any = vcal.getFirstSubcomponent('vjournal');
    if (!vjournal) return null;
    const prop = vjournal.getFirstProperty('dtstart');
    if (!prop) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val: any = prop.getFirstValue();
    if (!val) return null;
    if (val.isDate) {
      const y = String(val.year as number).padStart(4, '0');
      const mo = String(val.month as number).padStart(2, '0');
      const d = String(val.day as number).padStart(2, '0');
      return `${y}-${mo}-${d}`;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsDate: Date | undefined = (val as any).toJSDate?.();
    return jsDate ? jsDate.toISOString() : null;
  } catch {
    return null;
  }
}

function buildFtsQuery(q: string): string {
  const words = q.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '""';
  return words.map((w) => `"${w.replace(/"/g, '""')}"*`).join(' ');
}

function rowToJournal(
  row: EntryRow,
  categories: string[],
  relations: TaskRelation[],
): Note {
  const dtstart = parseDtstartFromIcs(row.raw_ics ?? null) ?? msToIso(row.dtstart);
  const data: NoteJson = {
    uid: row.uid,
    summary: row.summary,
    description: row.description,
    dtstart,
    lastModified: msToIso(row.last_modified),
    categories,
    relations,
    collectionUrl: row.collection_url,
  };
  return {
    uid: row.uid,
    etag: row.etag,
    collectionUrl: row.collection_url,
    collectionId: collectionIdFromUrl(row.collection_url),
    data,
  };
}

type SqlValue = string | number | null;

function buildJournalsQuery(
  userId: string,
  params: JournalsQueryParams,
): { sql: string; values: SqlValue[] } {
  const clauses: string[] = [
    'e.user_id = ?',
    "e.component_type = 'VJOURNAL'",
    'e.dtstart_present = 1',
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

  // Date range for calendar view (milestone 9)
  if (params.from) {
    const ms = new Date(params.from + 'T00:00:00.000Z').getTime();
    if (!isNaN(ms)) {
      clauses.push('e.dtstart >= ?');
      values.push(ms);
    }
  }

  if (params.to) {
    const ms = new Date(params.to + 'T23:59:59.999Z').getTime();
    if (!isNaN(ms)) {
      clauses.push('e.dtstart <= ?');
      values.push(ms);
    }
  }

  const where = clauses.join(' AND ');
  const dir = params.order === 'asc' ? 'ASC' : 'DESC';

  let orderBy: string;
  switch (params.sort) {
    case 'summary':
      orderBy = `e.summary ${dir}`;
      break;
    case 'created':
      orderBy = `e.id ${dir}`;
      break;
    case 'modified':
      orderBy = `e.last_modified ${dir} NULLS LAST`;
      break;
    case 'journal_date':
      orderBy = `e.dtstart ${dir} NULLS LAST`;
      break;
    case 'category':
      orderBy = `(SELECT MIN(ec.category) FROM entry_categories ec WHERE ec.entry_id = e.id) ${dir} NULLS LAST`;
      break;
    default:
      orderBy = 'e.dtstart DESC NULLS LAST';
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

export async function journalsRoutes(
  app: FastifyInstance,
  opts: { cacheDb: CacheDbInstance },
) {
  const { cacheDb } = opts;

  // ── GET /api/journals ───────────────────────────────────────────────────────

  app.get<{ Querystring: JournalsQueryParams }>(
    '/api/journals',
    { preHandler: requireAuth },
    async (req, reply) => {
      const userId = req.sessionData!.username;
      const { sql, values } = buildJournalsQuery(userId, req.query);

      let rows: EntryRow[];
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rows = (cacheDb.prepare(sql).all(...values as any[]) as unknown) as EntryRow[];
      } catch (err) {
        app.log.warn({ err }, 'journals query failed');
        return reply.status(500).send({ error: 'Cache query failed', statusCode: 500 });
      }

      if (rows.length === 0) {
        const response: JournalsResponse = { journals: [], total: 0 };
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

      const journals = rows.map((row) =>
        rowToJournal(row, catMap.get(row.id) ?? [], relMap.get(row.id) ?? []),
      );

      const response: JournalsResponse = { journals, total: journals.length };
      return reply.send(response);
    },
  );

  // ── GET /api/journals/:uid ──────────────────────────────────────────────────

  app.get<{ Params: { uid: string } }>(
    '/api/journals/:uid',
    { preHandler: requireAuth },
    async (req, reply) => {
      const userId = req.sessionData!.username;
      const { uid } = req.params;

      const row = cacheDb.prepare(`
        SELECT id, uid, etag, collection_url, object_url,
               summary, description, dtstart, last_modified, raw_ics
        FROM entries
        WHERE uid = ? AND user_id = ? AND component_type = 'VJOURNAL' AND dtstart_present = 1
      `).get(uid, userId) as EntryRow | undefined;

      if (!row) {
        return reply.status(404).send({ error: 'Journal not found', statusCode: 404 });
      }

      const catRows = cacheDb.prepare(
        'SELECT category FROM entry_categories WHERE entry_id = ?',
      ).all(row.id) as { category: string }[];

      const relRows = cacheDb.prepare(
        'SELECT related_uid, reltype FROM entry_relations WHERE entry_id = ?',
      ).all(row.id) as { related_uid: string; reltype: string }[];

      const journal = rowToJournal(
        row,
        catRows.map((c) => c.category),
        relRows.map((r) => ({ relatedUid: r.related_uid, reltype: r.reltype })),
      );

      return reply.send(journal);
    },
  );

  // ── POST /api/journals — create ─────────────────────────────────────────────

  app.post<{ Body: CreateNoteRequest }>(
    '/api/journals',
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
      if (!data.dtstart) {
        return reply.status(400).send({ error: 'dtstart is required for journals', statusCode: 400 });
      }

      const journalData: NoteJson = { ...data, uid: data.uid || randomUUID() };

      let result;
      try {
        result = await davCreateJournal(session, data.collectionUrl, journalData);
      } catch (err: unknown) {
        const e = err as { statusCode?: number };
        if (e.statusCode === 409) {
          return reply.status(409).send({ error: 'A journal with this UID already exists', statusCode: 409 });
        }
        app.log.error({ err }, 'createJournal DAV PUT failed');
        return reply.status(502).send({ error: 'Failed to create journal on server', statusCode: 502 });
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
        data: { ...journalData, uid: result.uid },
      };
      return reply.status(201).send(response);
    },
  );

  // ── PUT /api/journals/:uid — update (also handles convert-to-note) ──────────

  app.put<{ Params: { uid: string }; Body: UpdateNoteRequest }>(
    '/api/journals/:uid',
    { preHandler: requireAuth },
    async (req, reply) => {
      const session = req.sessionData as SessionData;
      const { uid } = req.params;
      const { data, etag } = req.body;

      if (!data?.summary?.trim()) {
        return reply.status(400).send({ error: 'summary is required', statusCode: 400 });
      }

      // Look up by uid without dtstart_present filter so that convert-to-note
      // (dtstart: null) can still find the entry (it's currently dtstart_present=1).
      const existing = cacheDb.prepare(`
        SELECT object_url, collection_url, raw_ics
        FROM entries
        WHERE uid = ? AND user_id = ? AND component_type = 'VJOURNAL'
      `).get(uid, session.username) as { object_url: string; collection_url: string; raw_ics: string | null } | undefined;

      if (!existing) {
        return reply.status(404).send({ error: 'Journal not found', statusCode: 404 });
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
        return reply.status(502).send({ error: 'Failed to update journal on server', statusCode: 502 });
      }

      if (isMove) {
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

  // ── DELETE /api/journals/:uid ───────────────────────────────────────────────

  app.delete<{ Params: { uid: string }; Querystring: { etag: string } }>(
    '/api/journals/:uid',
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
        WHERE uid = ? AND user_id = ? AND component_type = 'VJOURNAL' AND dtstart_present = 1
      `).get(uid, session.username) as { object_url: string } | undefined;

      if (!existing) {
        return reply.status(404).send({ error: 'Journal not found', statusCode: 404 });
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
        return reply.status(502).send({ error: 'Failed to delete journal on server', statusCode: 502 });
      }

      deleteEntryByUid(cacheDb, uid, session.username);
      return reply.status(204).send();
    },
  );
}
