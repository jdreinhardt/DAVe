import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { CacheDbInstance } from '../db/cache.js';
import type { SessionData } from '../services/session.js';
import type { Config } from '../config.js';
import type { Task, TaskJson, TasksResponse, TaskRelation, TasksQueryParams, AlarmJson, TaskWriteResponse, CreateTaskRequest, UpdateTaskRequest, ArchivedTask, ArchivedTasksResponse, RestoreArchivedTaskRequest } from '@dave/shared';
import { requireAuth } from '../plugins/session.js';
import { resolveCollectionUrl, resolveObjectUrl } from '../services/collectionResolver.js';
import {
  applyCompletion, rollForwardTask, serializeIcalTask, parseVTodoToTaskJson,
  parseDateStringsFromIcs, parseAlarmsFromIcs, parseRruleFromIcs, parseRecurringInstanceFromIcs,
} from '../lib/ical.js';
import { createTask as davCreateTask, updateTask as davUpdateTask, deleteTask as davDeleteTask, createTaskRaw, fetchArchivedCompletedTasks, archiveSearchWindow, restoreArchivedTask as davRestoreArchivedTask } from '../lib/dav.js';
import { parseEntry } from '../lib/entryParser.js';
import { upsertEntry, deleteEntryByUid } from '../db/cacheOps.js';
import { collectionIdFromUrl, msToIso, buildFtsQuery, isWithinArchiveWindow, type CategoryRow, type RelationRow } from '../lib/routeUtils.js';

interface EntryRow {
  id: number;
  uid: string;
  etag: string;
  collection_url: string;
  object_url: string;
  summary: string;
  description: string;
  status: string | null;
  priority: number | null;
  dtstart: number | null;
  due: number | null;
  completed: number | null;
  percent_complete: number | null;
  last_modified: number | null;
  raw_ics: string | null;
  rrule: string | null;
}


function rowToTask(
  row: EntryRow,
  categories: string[],
  relations: TaskRelation[],
  alarms: AlarmJson[] = [],
): Task {
  const dateDates = parseDateStringsFromIcs(row.raw_ics ?? null);
  let data: TaskJson = {
    uid: row.uid,
    summary: row.summary,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dtstart: dateDates.dtstart ?? msToIso(row.dtstart),
    due: dateDates.due ?? msToIso(row.due),
    completed: msToIso(row.completed),
    percentComplete: row.percent_complete,
    lastModified: msToIso(row.last_modified),
    categories,
    relations,
    collectionUrl: row.collection_url,
    alarms,
    rrule: parseRruleFromIcs(row.raw_ics ?? null),
    recurringInstance: parseRecurringInstanceFromIcs(row.raw_ics ?? null) || undefined,
  };

  // For active recurring tasks with no due date: fill one in so the task
  // always has a visible anchor. A user-supplied due (even in the past) is
  // preserved as-is — it serves as the seed for future roll-forward math.
  if (
    data.rrule &&
    data.status !== 'COMPLETED' &&
    data.status !== 'CANCELLED' &&
    !data.due
  ) {
    const todayStr = new Date().toISOString().substring(0, 10);
    const dtstartDate = data.dtstart?.substring(0, 10) ?? null;
    // Mirror DTSTART when present; fall back to today for completely dateless tasks.
    data = { ...data, due: dtstartDate ?? todayStr };
  }

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
    const words = params.q.trim().split(/\s+/).filter(Boolean);
    const catMatch = words.map(() => 'lower(category) LIKE lower(?)||\'%\'').join(' OR ');
    clauses.push(`(e.id IN (SELECT rowid FROM entries_fts WHERE entries_fts MATCH ?)
      OR e.id IN (SELECT entry_id FROM entry_categories WHERE ${catMatch}))`);
    values.push(buildFtsQuery(params.q), ...words);
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
    SELECT e.id, e.uid, e.etag, e.collection_url, e.object_url,
           e.summary, e.description, e.status, e.priority,
           e.dtstart, e.due, e.completed, e.percent_complete,
           e.last_modified, e.raw_ics
    FROM entries e
    WHERE ${where}
    ORDER BY ${orderBy}
  `;

  return { sql, values };
}

// Recursively find all descendant UIDs (BFS) for a given parent task.
// Returns descendant UIDs in BFS order (parents before their children).
function getDescendantUids(cacheDb: CacheDbInstance, parentUid: string, userId: string): string[] {
  const result: string[] = [];
  const queue = [parentUid];
  const seen = new Set<string>([parentUid]);

  while (queue.length > 0) {
    const uid = queue.shift()!;
    const children = cacheDb.prepare(`
      SELECT e.uid
      FROM entries e
      JOIN entry_relations er ON er.entry_id = e.id
      WHERE er.related_uid = ? AND er.reltype = 'PARENT'
        AND e.user_id = ? AND e.component_type = 'VTODO'
    `).all(uid, userId) as { uid: string }[];

    for (const child of children) {
      if (!seen.has(child.uid)) {
        seen.add(child.uid);
        result.push(child.uid);
        queue.push(child.uid);
      }
    }
  }

  return result;
}

function matchesQuery(task: ArchivedTask, q: string): boolean {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = [task.data.summary, task.data.description, ...task.data.categories]
    .join(' ')
    .toLowerCase();
  return words.every((w) => text.includes(w));
}

function objectUrlToCollectionUrl(objectUrl: string, knownCollections: string[]): string {
  // Try to find the collection URL by prefix-matching against known ones.
  const match = knownCollections.find((c) => objectUrl.startsWith(c) || objectUrl.startsWith(c.replace(/\/$/, '')));
  if (match) return match;
  // Fallback: strip the last path segment.
  try {
    const u = new URL(objectUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    parts.pop();
    u.pathname = '/' + parts.join('/') + '/';
    return u.href;
  } catch {
    return objectUrl;
  }
}

export async function tasksRoutes(
  app: FastifyInstance,
  opts: { cacheDb: CacheDbInstance; config: Config },
) {
  const { cacheDb, config } = opts;

  // ── GET /api/tasks/archive-search — search the DAV server for old completed tasks ─
  // Registered before /api/tasks/:uid so Fastify's router doesn't capture
  // "archive-search" as a UID value (static segments win, but explicit ordering
  // makes the intent clear).

  app.get<{ Querystring: { q?: string } }>(
    '/api/tasks/archive-search',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { q } = req.query;
      if (!q?.trim()) {
        return reply.status(400).send({ error: 'q is required', statusCode: 400 });
      }

      const session = req.sessionData!;
      const userId = session.username;

      const collectionRows = cacheDb
        .prepare("SELECT DISTINCT collection_url FROM entries WHERE user_id = ? AND component_type = 'VTODO'")
        .all(userId) as { collection_url: string }[];

      if (collectionRows.length === 0) {
        return reply.send({ tasks: [] } as ArchivedTasksResponse);
      }

      const collectionUrls = collectionRows.map((r) => r.collection_url);

      let rawObjects;
      try {
        rawObjects = await fetchArchivedCompletedTasks(session, collectionUrls, config);
      } catch (err) {
        app.log.error({ err }, 'archive search failed');
        return reply.status(502).send({ error: 'Failed to search the DAV server', statusCode: 502 });
      }

      // Re-check the window locally. The CalDAV time-range filter is a request,
      // not a guarantee: a server that ignores prop-filter/time-range returns
      // every VTODO it has, which would bury the archive view in tasks the user
      // can already see in the normal list.
      const { startMs, endMs } = archiveSearchWindow(config);

      const tasks: ArchivedTask[] = [];
      for (const { url, etag, rawIcs } of rawObjects) {
        const parsed = parseVTodoToTaskJson(rawIcs);
        if (!parsed || parsed.data.status !== 'COMPLETED') continue;
        if (!isWithinArchiveWindow(parsed.data.completed, startMs, endMs)) continue;
        const collectionUrl = objectUrlToCollectionUrl(url, collectionUrls);
        const task: ArchivedTask = {
          uid: parsed.uid,
          etag,
          url,
          collectionUrl,
          collectionId: collectionIdFromUrl(collectionUrl),
          data: { ...parsed.data, collectionUrl },
        };
        if (matchesQuery(task, q)) tasks.push(task);
      }

      return reply.send({ tasks } as ArchivedTasksResponse);
    },
  );

  // ── POST /api/tasks/archive-restore — restore a completed task to active ────

  app.post<{ Body: RestoreArchivedTaskRequest }>(
    '/api/tasks/archive-restore',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { url: objectUrl, etag, collectionUrl } = req.body ?? {};
      if (!objectUrl?.trim() || !etag?.trim() || !collectionUrl?.trim()) {
        return reply.status(400).send({ error: 'url, etag, and collectionUrl are required', statusCode: 400 });
      }

      const session = req.sessionData!;

      let result;
      try {
        // Both URLs come from the body. Resolving the collection says nothing
        // about the object, so the object is separately constrained to be a
        // direct member of the collection we just vouched for.
        const target = await resolveCollectionUrl(
          session, session.username, collectionUrl, cacheDb, config,
        );
        const objectTarget = resolveObjectUrl(objectUrl, target);
        result = await davRestoreArchivedTask(session, objectTarget, target, etag, config);
      } catch (err: unknown) {
        const e = err as { statusCode?: number };
        if (e.statusCode === 400) {
          return reply.status(400).send({ error: 'Invalid request', statusCode: 400 });
        }
        if (e.statusCode === 412) {
          return reply.status(409).send({ error: 'Task was modified on the server — reload and try again', statusCode: 409 });
        }
        app.log.error({ err }, 'restoreArchivedTask failed');
        return reply.status(502).send({ error: 'Failed to restore task', statusCode: 502 });
      }

      const parsed = parseEntry(result.rawIcs, result.url, result.collectionUrl, session.username, result.etag);
      if (parsed) {
        try { upsertEntry(cacheDb, parsed); } catch (e) { app.log.warn({ e }, 'cache upsert failed after restore'); }
      }

      const taskParsed = parseVTodoToTaskJson(result.rawIcs);
      const taskData: TaskJson = taskParsed
        ? { ...taskParsed.data, collectionUrl: result.collectionUrl, alarms: [] }
        : {
            uid: result.uid, summary: '', description: '', status: 'NEEDS-ACTION',
            priority: null, dtstart: null, due: null, completed: null,
            percentComplete: 0, lastModified: null, categories: [], relations: [],
            collectionUrl: result.collectionUrl, alarms: [], rrule: null,
          };

      const response: TaskWriteResponse = {
        uid: result.uid,
        url: result.url,
        etag: result.etag,
        collectionId: collectionIdFromUrl(result.collectionUrl),
        collectionUrl: result.collectionUrl,
        data: taskData,
      };
      return reply.send(response);
    },
  );

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
        rowToTask(
          row,
          catMap.get(row.id) ?? [],
          relMap.get(row.id) ?? [],
          parseAlarmsFromIcs(row.raw_ics ?? null),
        ),
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
        SELECT id, uid, etag, collection_url, object_url, summary, description, status, priority,
               dtstart, due, completed, percent_complete, last_modified, raw_ics
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

      const alarms = parseAlarmsFromIcs(row.raw_ics ?? null);

      const task = rowToTask(
        row,
        catRows.map((c) => c.category),
        relRows.map((r) => ({ relatedUid: r.related_uid, reltype: r.reltype })),
        alarms,
      );

      return reply.send(task);
    },
  );

  // ── POST /api/tasks — create ────────────────────────────────────────────────

  app.post<{ Body: CreateTaskRequest }>(
    '/api/tasks',
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

      let taskData = applyCompletion(data);

      // Auto-set due to today (or dtstart if it's future) when rrule is set
      // and the user didn't provide an explicit due date.
      if (taskData.rrule && !taskData.due) {
        const todayStr = new Date().toISOString().substring(0, 10);
        const dtstartDate = taskData.dtstart?.substring(0, 10) ?? null;
        taskData = {
          ...taskData,
          due: dtstartDate && dtstartDate >= todayStr ? dtstartDate : todayStr,
        };
      }

      let result;
      try {
        const target = await resolveCollectionUrl(
          session, session.username, data.collectionUrl, cacheDb, config,
        );
        result = await davCreateTask(session, target, taskData, config);
      } catch (err: unknown) {
        const e = err as { statusCode?: number };
        if (e.statusCode === 400) {
          return reply.status(400).send({ error: 'Invalid request', statusCode: 400 });
        }
        if (e.statusCode === 409) {
          return reply.status(409).send({ error: 'A task with this UID already exists', statusCode: 409 });
        }
        app.log.error({ err }, 'createTask DAV PUT failed');
        return reply.status(502).send({ error: 'Failed to create task on server', statusCode: 502 });
      }

      const parsed = parseEntry(result.rawIcs, result.url, result.collectionUrl, session.username, result.etag);
      if (parsed) {
        try { upsertEntry(cacheDb, parsed); } catch (e) { app.log.warn({ e }, 'cache upsert failed after create'); }
      }

      const response: TaskWriteResponse = {
        uid: result.uid,
        url: result.url,
        etag: result.etag,
        collectionId: collectionIdFromUrl(result.collectionUrl),
        collectionUrl: result.collectionUrl,
        data: { ...taskData, uid: result.uid, alarms: taskData.alarms ?? [], rrule: taskData.rrule ?? null },
      };
      return reply.status(201).send(response);
    },
  );

  // ── PUT /api/tasks/:uid — update ────────────────────────────────────────────

  app.put<{ Params: { uid: string }; Body: UpdateTaskRequest }>(
    '/api/tasks/:uid',
    { preHandler: requireAuth },
    async (req, reply) => {
      const session = req.sessionData as SessionData;
      const { uid } = req.params;
      const { data, etag } = req.body;

      if (!data?.summary?.trim()) {
        return reply.status(400).send({ error: 'summary is required', statusCode: 400 });
      }

      // Look up existing entry from cache for object_url and raw_ics.
      const existing = cacheDb.prepare(`
        SELECT object_url, collection_url, raw_ics
        FROM entries
        WHERE uid = ? AND user_id = ? AND component_type = 'VTODO'
      `).get(uid, session.username) as { object_url: string; collection_url: string; raw_ics: string | null } | undefined;

      if (!existing) {
        return reply.status(404).send({ error: 'Task not found', statusCode: 404 });
      }

      let taskData = applyCompletion({ ...data, uid });

      // Recurring roll-forward: completing a recurring task advances it to the
      // next occurrence instead of marking it done (spec §5.5).
      if (taskData.status === 'COMPLETED' && taskData.rrule && existing.raw_ics) {
        const today = new Date().toISOString().substring(0, 10);
        const rolled = rollForwardTask(taskData, existing.raw_ics, today);
        if (rolled !== null) {
          // Persist the just-completed occurrence as a history record before
          // advancing the main task. Non-fatal if the copy fails.
          const completedCopy: TaskJson = {
            ...taskData,
            uid: randomUUID(),
            rrule: null,            // one-time completed instance
            recurringInstance: true, // marks this as a history copy
            relations: [],          // don't inherit parent/child hierarchy
            alarms: [],             // no alarms needed on a completed copy
          };
          try {
            const copyTarget = await resolveCollectionUrl(
              session, session.username, completedCopy.collectionUrl, cacheDb, config,
            );
            const copyResult = await davCreateTask(session, copyTarget, completedCopy, config);
            // Upsert into local cache immediately so the copy appears in the
            // next GET without waiting for a background sync.
            const copyParsed = parseEntry(
              copyResult.rawIcs,
              copyResult.url,
              copyResult.collectionUrl,
              session.username,
              copyResult.etag,
            );
            if (copyParsed) {
              try { upsertEntry(cacheDb, copyParsed); } catch (e) {
                app.log.warn({ e }, 'cache upsert failed after completed copy');
              }
            }
          } catch (err) {
            app.log.warn({ err }, 'Failed to create completed-instance copy for recurring task');
          }
          taskData = rolled;
        }
      }

      const isMove = data.collectionUrl && data.collectionUrl !== existing.collection_url;
      // Resolved once here and reused by the descendant cascade below, so parent
      // and children cannot land in different collections.
      let moveTarget = '';

      let result;
      try {
        if (isMove) {
          // Resolve before the delete: an unresolvable target must not cost the
          // user the original task.
          moveTarget = await resolveCollectionUrl(
            session, session.username, data.collectionUrl, cacheDb, config,
          );
          // Move = delete from old collection + create in new.
          await davDeleteTask(session, existing.object_url, etag);
          result = await davCreateTask(session, moveTarget, taskData, config);
        } else {
          result = await davUpdateTask(
            session,
            existing.object_url,
            existing.collection_url,
            taskData,
            etag,
            existing.raw_ics ?? serializeIcalTask(taskData),
          );
        }
      } catch (err: unknown) {
        const e = err as { statusCode?: number };
        if (e.statusCode === 400) {
          return reply.status(400).send({ error: 'Invalid request', statusCode: 400 });
        }
        if (e.statusCode === 412) {
          return reply.status(412).send({
            error: 'conflict',
            message: 'This task was modified elsewhere. Reload to see the latest version.',
            statusCode: 412,
          });
        }
        app.log.error({ err }, 'updateTask DAV PUT failed');
        return reply.status(502).send({ error: 'Failed to update task on server', statusCode: 502 });
      }

      const parsed = parseEntry(result.rawIcs, result.url, result.collectionUrl, session.username, result.etag);
      if (parsed) {
        try { upsertEntry(cacheDb, parsed); } catch (e) { app.log.warn({ e }, 'cache upsert failed after update'); }
      }

      // Cascade collection move to all descendants.
      const childMoveErrors: Array<{ uid: string; error: string }> = [];
      if (isMove) {
        const descendants = getDescendantUids(cacheDb, uid, session.username);
        for (const childUid of descendants) {
          const childRow = cacheDb.prepare(`
            SELECT object_url, etag, raw_ics
            FROM entries
            WHERE uid = ? AND user_id = ? AND component_type = 'VTODO'
          `).get(childUid, session.username) as { object_url: string; etag: string; raw_ics: string | null } | undefined;

          if (!childRow?.raw_ics) continue;

          try {
            const newChild = await createTaskRaw(session, moveTarget, childUid, childRow.raw_ics, config);
            await davDeleteTask(session, childRow.object_url, childRow.etag);
            const childParsed = parseEntry(childRow.raw_ics, newChild.url, moveTarget, session.username, newChild.etag);
            if (childParsed) {
              try { upsertEntry(cacheDb, childParsed); } catch (e) { app.log.warn({ e }, 'cache upsert failed after child move'); }
            }
          } catch (err) {
            app.log.warn({ err, childUid }, 'cascade move failed for child task');
            childMoveErrors.push({ uid: childUid, error: 'Move failed' });
          }
        }
      }

      const response: TaskWriteResponse = {
        uid: result.uid,
        url: result.url,
        etag: result.etag,
        collectionId: collectionIdFromUrl(result.collectionUrl),
        collectionUrl: result.collectionUrl,
        data: { ...taskData, alarms: taskData.alarms ?? [], rrule: taskData.rrule ?? null },
        ...(childMoveErrors.length > 0 ? { childMoveErrors } : {}),
      };
      return reply.send(response);
    },
  );

  // ── DELETE /api/tasks/:uid — delete ────────────────────────────────────────

  app.delete<{ Params: { uid: string }; Querystring: { etag: string; deleteChildren?: string } }>(
    '/api/tasks/:uid',
    { preHandler: requireAuth },
    async (req, reply) => {
      const session = req.sessionData as SessionData;
      const { uid } = req.params;
      const { etag, deleteChildren } = req.query;

      if (!etag) {
        return reply.status(400).send({ error: 'etag query parameter is required', statusCode: 400 });
      }

      const existing = cacheDb.prepare(`
        SELECT object_url
        FROM entries
        WHERE uid = ? AND user_id = ? AND component_type = 'VTODO'
      `).get(uid, session.username) as { object_url: string } | undefined;

      if (!existing) {
        return reply.status(404).send({ error: 'Task not found', statusCode: 404 });
      }

      // Cascade delete all descendants first (leaves last so parents aren't orphaned briefly).
      const childErrors: Array<{ uid: string; error: string }> = [];
      if (deleteChildren === 'true') {
        const descendants = getDescendantUids(cacheDb, uid, session.username);
        // Delete in reverse BFS order so leaves are deleted before their parents.
        for (const childUid of [...descendants].reverse()) {
          const childRow = cacheDb.prepare(`
            SELECT object_url, etag
            FROM entries
            WHERE uid = ? AND user_id = ? AND component_type = 'VTODO'
          `).get(childUid, session.username) as { object_url: string; etag: string } | undefined;

          if (!childRow) continue;

          try {
            await davDeleteTask(session, childRow.object_url, childRow.etag);
            deleteEntryByUid(cacheDb, childUid, session.username);
          } catch (err) {
            app.log.warn({ err, childUid }, 'cascade delete failed for child task');
            childErrors.push({ uid: childUid, error: 'Delete failed' });
          }
        }
      }

      try {
        await davDeleteTask(session, existing.object_url, etag);
      } catch (err: unknown) {
        const e = err as { statusCode?: number };
        if (e.statusCode === 400) {
          return reply.status(400).send({ error: 'Invalid request', statusCode: 400 });
        }
        if (e.statusCode === 412) {
          return reply.status(412).send({
            error: 'conflict',
            message: 'This task was modified elsewhere. Reload before deleting.',
            statusCode: 412,
          });
        }
        app.log.error({ err }, 'deleteTask DAV DELETE failed');
        return reply.status(502).send({ error: 'Failed to delete task on server', statusCode: 502 });
      }

      deleteEntryByUid(cacheDb, uid, session.username);

      if (childErrors.length > 0) {
        return reply.status(207).send({ childErrors });
      }
      return reply.status(204).send();
    },
  );

  void config; // consumed only by write handlers above
}
