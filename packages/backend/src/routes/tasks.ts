import type { FastifyInstance } from 'fastify';
import type { CacheDbInstance } from '../db/cache.js';
import type { Task, TaskJson, TasksResponse, TaskRelation, TasksQueryParams } from '@dave/shared';
import { requireAuth } from '../plugins/session.js';

interface EntryRow {
  id: number;
  uid: string;
  etag: string;
  collection_url: string;
  summary: string;
  description: string;
  status: string | null;
  priority: number | null;
  dtstart: number | null;
  due: number | null;
  completed: number | null;
  percent_complete: number | null;
  last_modified: number | null;
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

// Escape a user query string for FTS5 MATCH: wrap each word as a phrase-prefix term.
function buildFtsQuery(q: string): string {
  const words = q.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '""';
  return words
    .map((w) => `"${w.replace(/"/g, '""')}"*`)
    .join(' ');
}

function rowToTask(
  row: EntryRow,
  categories: string[],
  relations: TaskRelation[],
): Task {
  const data: TaskJson = {
    uid: row.uid,
    summary: row.summary,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dtstart: msToIso(row.dtstart),
    due: msToIso(row.due),
    completed: msToIso(row.completed),
    percentComplete: row.percent_complete,
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

function buildTasksQuery(
  userId: string,
  params: TasksQueryParams,
): { sql: string; values: SqlValue[] } {
  const clauses: string[] = [
    "e.user_id = ?",
    "e.component_type = 'VTODO'",
  ];
  const values: SqlValue[] = [userId];

  // status filter — 'active' is a pseudo-value for incomplete tasks
  if (params.status) {
    if (params.status === 'active') {
      clauses.push("(e.status != 'COMPLETED' AND e.status != 'CANCELLED' OR e.status IS NULL)");
    } else {
      clauses.push('e.status = ?');
      values.push(params.status.toUpperCase());
    }
  }

  // category filter
  if (params.category) {
    clauses.push('e.id IN (SELECT entry_id FROM entry_categories WHERE category = ?)');
    values.push(params.category);
  }

  // due date filter
  const now = Date.now();
  if (params.due === 'overdue') {
    clauses.push('e.due IS NOT NULL AND e.due < ?');
    values.push(now);
  } else if (params.due === 'today') {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    clauses.push('e.due >= ? AND e.due <= ?');
    values.push(todayStart.getTime(), todayEnd.getTime());
  } else if (params.due === 'this_week') {
    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() + 7);
    weekEnd.setHours(23, 59, 59, 999);
    clauses.push('e.due >= ? AND e.due < ?');
    values.push(now, weekEnd.getTime());
  } else if (params.due === 'no_due_date') {
    clauses.push('e.due IS NULL');
  }

  // priority filter
  if (params.priority === 'high') {
    clauses.push('e.priority BETWEEN 1 AND 3');
  } else if (params.priority === 'medium') {
    clauses.push('e.priority BETWEEN 4 AND 6');
  } else if (params.priority === 'low') {
    clauses.push('e.priority BETWEEN 7 AND 9');
  } else if (params.priority === 'none') {
    clauses.push('e.priority IS NULL');
  }

  // collection filter
  if (params.collections) {
    const urls = params.collections.split(',').map((u) => u.trim()).filter(Boolean);
    if (urls.length > 0) {
      clauses.push(`e.collection_url IN (${urls.map(() => '?').join(',')})`);
      values.push(...urls);
    }
  }

  // full-text search via FTS5
  if (params.q?.trim()) {
    clauses.push('e.id IN (SELECT rowid FROM entries_fts WHERE entries_fts MATCH ?)');
    values.push(buildFtsQuery(params.q));
  }

  const where = clauses.join(' AND ');

  // ORDER BY — default is incomplete first, then due/priority/summary
  let orderBy: string;
  const dir = params.order === 'desc' ? 'DESC' : 'ASC';
  const dirOpp = dir === 'ASC' ? 'DESC' : 'ASC';

  switch (params.sort) {
    case 'summary':
      orderBy = `e.summary ${dir}`;
      break;
    case 'due':
      orderBy = `e.due ${dir} NULLS LAST`;
      break;
    case 'priority':
      orderBy = `e.priority ${dir} NULLS LAST`;
      break;
    case 'modified':
      orderBy = `e.last_modified ${dir} NULLS LAST`;
      break;
    case 'category': {
      // sort by the alphabetically first category for each entry
      const catDir = dirOpp; // invert: when we want ASC tasks, we want the lowest category first
      orderBy = `(
        SELECT MIN(ec.category) FROM entry_categories ec WHERE ec.entry_id = e.id
      ) ${catDir} NULLS LAST`;
      break;
    }
    default:
      // Default: incomplete before completed, then due/priority/summary
      orderBy = `
        CASE WHEN e.status = 'COMPLETED' OR e.status = 'CANCELLED' THEN 1 ELSE 0 END ASC,
        e.due ASC NULLS LAST,
        e.priority ASC NULLS LAST,
        e.summary ASC
      `;
  }

  const sql = `
    SELECT e.id, e.uid, e.etag, e.collection_url,
           e.summary, e.description, e.status, e.priority,
           e.dtstart, e.due, e.completed, e.percent_complete,
           e.last_modified
    FROM entries e
    WHERE ${where}
    ORDER BY ${orderBy}
  `;

  return { sql, values };
}

export async function tasksRoutes(
  app: FastifyInstance,
  opts: { cacheDb: CacheDbInstance },
) {
  const { cacheDb } = opts;

  app.get<{ Querystring: TasksQueryParams }>(
    '/api/tasks',
    { preHandler: requireAuth },
    async (req, reply) => {
      const userId = req.sessionData!.username;
      const { sql, values } = buildTasksQuery(userId, req.query);

      let rows: EntryRow[];
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rows = (cacheDb.prepare(sql).all(...values as any[]) as unknown) as EntryRow[];
      } catch (err) {
        app.log.warn({ err }, 'tasks query failed');
        return reply.status(500).send({ error: 'Cache query failed', statusCode: 500 });
      }

      if (rows.length === 0) {
        const response: TasksResponse = { tasks: [], total: 0 };
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

      // Group by entry_id
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

      const tasks = rows.map((row) =>
        rowToTask(row, catMap.get(row.id) ?? [], relMap.get(row.id) ?? []),
      );

      const response: TasksResponse = { tasks, total: tasks.length };
      return reply.send(response);
    },
  );

  app.get<{ Params: { uid: string } }>(
    '/api/tasks/:uid',
    { preHandler: requireAuth },
    async (req, reply) => {
      const userId = req.sessionData!.username;
      const { uid } = req.params;

      const row = cacheDb.prepare(`
        SELECT id, uid, etag, collection_url, summary, description, status, priority,
               dtstart, due, completed, percent_complete, last_modified
        FROM entries
        WHERE uid = ? AND user_id = ? AND component_type = 'VTODO'
      `).get(uid, userId) as EntryRow | undefined;

      if (!row) {
        return reply.status(404).send({ error: 'Task not found', statusCode: 404 });
      }

      const catRows = cacheDb.prepare(
        'SELECT category FROM entry_categories WHERE entry_id = ?',
      ).all(row.id) as { category: string }[];

      const relRows = cacheDb.prepare(
        'SELECT related_uid, reltype FROM entry_relations WHERE entry_id = ?',
      ).all(row.id) as { related_uid: string; reltype: string }[];

      const task = rowToTask(
        row,
        catRows.map((c) => c.category),
        relRows.map((r) => ({ relatedUid: r.related_uid, reltype: r.reltype })),
      );

      return reply.send(task);
    },
  );
}
