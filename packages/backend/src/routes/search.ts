import type { FastifyInstance } from 'fastify';
import type { CacheDbInstance } from '../db/cache.js';
import type { Config } from '../config.js';
import type { GlobalSearchResult, GlobalSearchResponse } from '@dave/shared';
import { requireAuth } from '../plugins/session.js';
import { listCalendars, fetchEventsForSearch } from '../lib/dav.js';
import { parseIcalEvents } from '../lib/ical.js';

type SqlValue = string | number | null;

function buildFtsQuery(q: string): string {
  const words = q.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '""';
  return words.map((w) => `"${w.replace(/"/g, '""')}"*`).join(' ');
}

function collectionIdFromUrl(url: string): string {
  try {
    const seg = new URL(url).pathname.replace(/\/$/, '').split('/').filter(Boolean);
    return seg[seg.length - 1] ?? url;
  } catch {
    return url;
  }
}

function snippet(description: string): string {
  const trimmed = description.trim();
  return trimmed.length <= 120 ? trimmed : trimmed.slice(0, 120) + '…';
}

function msToIso(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  return new Date(ms).toISOString();
}

interface CacheRow {
  id: number;
  uid: string;
  collection_url: string;
  summary: string;
  description: string;
  dtstart: number | null;
  due: number | null;
}

interface CategoryRow {
  entry_id: number;
  category: string;
}

function queryCacheEntries(
  cacheDb: CacheDbInstance,
  userId: string,
  componentType: string,
  dtStartPresent: 0 | 1 | null,
  q: string,
  limit: number,
): CacheRow[] {
  const ftsQ = buildFtsQuery(q);
  const words = q.trim().split(/\s+/).filter(Boolean);
  const catMatch = words.map(() => "lower(category) LIKE lower(?)||'%'").join(' OR ');

  const clauses: string[] = ['e.user_id = ?', 'e.component_type = ?'];
  const values: SqlValue[] = [userId, componentType];

  if (dtStartPresent !== null) {
    clauses.push(`e.dtstart_present = ${dtStartPresent}`);
  }

  clauses.push(
    `(e.id IN (SELECT rowid FROM entries_fts WHERE entries_fts MATCH ?)` +
    ` OR e.id IN (SELECT entry_id FROM entry_categories WHERE ${catMatch}))`,
  );
  values.push(ftsQ, ...words);

  const sql = `
    SELECT e.id, e.uid, e.collection_url, e.summary, e.description, e.dtstart, e.due
    FROM entries e
    WHERE ${clauses.join(' AND ')}
    ORDER BY e.last_modified DESC NULLS LAST
    LIMIT ${limit}
  `;

  return cacheDb.prepare(sql).all(...values) as unknown as CacheRow[];
}

function fetchCategories(cacheDb: CacheDbInstance, ids: number[]): Map<number, string[]> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = cacheDb
    .prepare(`SELECT entry_id, category FROM entry_categories WHERE entry_id IN (${placeholders})`)
    .all(...ids) as unknown as CategoryRow[];
  const map = new Map<number, string[]>();
  for (const row of rows) {
    const list = map.get(row.entry_id) ?? [];
    list.push(row.category);
    map.set(row.entry_id, list);
  }
  return map;
}

function rowToResult(
  row: CacheRow,
  type: GlobalSearchResult['type'],
  categories: Map<number, string[]>,
): GlobalSearchResult {
  const collectionId = collectionIdFromUrl(row.collection_url);
  return {
    type,
    uid: row.uid,
    summary: row.summary,
    snippet: snippet(row.description),
    categories: categories.get(row.id) ?? [],
    date: type === 'task' ? msToIso(row.due) : msToIso(row.dtstart),
    collectionId,
    collectionUrl: row.collection_url,
  };
}

function matchesQuery(text: string, q: string): boolean {
  const lower = text.toLowerCase();
  return q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => lower.includes(word.toLowerCase()));
}

export async function searchRoutes(
  app: FastifyInstance,
  opts: { cacheDb: CacheDbInstance; config: Config },
) {
  const { cacheDb, config } = opts;

  app.get<{ Querystring: { q?: string } }>(
    '/api/search',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { q } = req.query;
      if (!q?.trim()) {
        return reply.status(400).send({ error: 'q is required', statusCode: 400 });
      }

      const userId = req.sessionData!.username;
      const MAX_CACHE = 10;
      const MAX_EVENTS = 50;

      // ── SQLite cache: tasks ───────────────────────────────────────────────
      const taskRows = queryCacheEntries(cacheDb, userId, 'VTODO', null, q, MAX_CACHE);
      const noteRows = queryCacheEntries(cacheDb, userId, 'VJOURNAL', 0, q, MAX_CACHE);
      const journalRows = queryCacheEntries(cacheDb, userId, 'VJOURNAL', 1, q, MAX_CACHE);

      const allIds = [
        ...taskRows.map((r) => r.id),
        ...noteRows.map((r) => r.id),
        ...journalRows.map((r) => r.id),
      ];
      const categories = fetchCategories(cacheDb, allIds);

      const tasks = taskRows.map((r) => rowToResult(r, 'task', categories));
      const notes = noteRows.map((r) => rowToResult(r, 'note', categories));
      const journals = journalRows.map((r) => rowToResult(r, 'journal', categories));

      // ── Baikal VEVENT search ──────────────────────────────────────────────
      const events: GlobalSearchResult[] = [];
      try {
        const allCalendars = await listCalendars(req.sessionData!, config);
        const veventCalendars = allCalendars
          .filter((cal) => cal.components.includes('VEVENT'))
          .map((cal) => ({ id: cal.id, url: cal.url }));

        if (veventCalendars.length > 0) {
          const rawObjects = await fetchEventsForSearch(
            req.sessionData!,
            veventCalendars,
            config.EVENT_SEARCH_RANGE_DAYS,
          );

          for (const { rawIcs, calendarId, url } of rawObjects) {
            if (events.length >= MAX_EVENTS) break;
            const parsed = parseIcalEvents(rawIcs, calendarId);
            for (const ev of parsed) {
              if (events.length >= MAX_EVENTS) break;
              const searchText = [ev.summary, ev.description, ev.location]
                .filter(Boolean)
                .join(' ');
              if (!matchesQuery(searchText, q)) continue;
              events.push({
                type: 'event',
                uid: ev.uid,
                summary: ev.summary,
                snippet: snippet(ev.description),
                categories: [],
                date: ev.start,
                collectionId: calendarId,
                collectionUrl: url.replace(/[^/]+\.ics$/, ''),
                eventStart: ev.start,
              });
            }
          }
        }
      } catch (err) {
        app.log.warn({ err }, 'Event search failed — returning partial results');
        // Return cache results even if event search fails
      }

      const response: GlobalSearchResponse = { tasks, notes, journals, events };
      return reply.send(response);
    },
  );
}
