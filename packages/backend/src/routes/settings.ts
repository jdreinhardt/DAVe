import type { FastifyInstance } from 'fastify';
import {
  SORT_BY, SORT_DIR, CONTACT_SUBTITLE_FIELDS, MAP_SERVICES,
  DARK_MODES, TASK_LAYOUTS, NOTES_VIEWS, JOURNALS_VIEWS, CALENDAR_TASK_DATES,
} from '@dave/shared';
import type { DbInstance } from '../db/index.js';
import { requireAuth } from '../plugins/session.js';

interface SettingsRow {
  username: string;
  contact_sort_by: string;
  contact_sort_dir: string;
  contact_subtitle: string;
  map_service: string;
  dark_mode: string;
  task_layout: string;
  notes_view: string;
  journals_view: string;
  calendar_task_date: string;
  updated_at: number;
}

interface SettingsBody {
  contactSortBy: string;
  contactSortDir: string;
  contactSubtitle: string;
  mapService: string;
  darkMode: string;
  taskLayout: string;
  notesView: string;
  journalsView: string;
  calendarTaskDate: string;
  updatedAt: number;
}

export async function settingsRoutes(
  app: FastifyInstance,
  opts: { db: DbInstance },
): Promise<void> {
  const { db } = opts;

  app.get('/api/settings', { preHandler: requireAuth }, async (req, reply) => {
    const row = db
      .prepare('SELECT * FROM user_settings WHERE username = ?')
      .get(req.sessionData!.username) as SettingsRow | undefined;

    if (!row) {
      return reply.status(404).send({ error: 'Not found' });
    }

    return reply.send({
      contactSortBy:  row.contact_sort_by,
      contactSortDir: row.contact_sort_dir,
      contactSubtitle: row.contact_subtitle,
      mapService:     row.map_service,
      darkMode:       row.dark_mode,
      taskLayout:     row.task_layout,
      notesView:      row.notes_view,
      journalsView:   row.journals_view,
      calendarTaskDate: row.calendar_task_date,
      updatedAt:      row.updated_at,
    } satisfies SettingsBody);
  });

  app.put('/api/settings', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        // enums come from @dave/shared so they can't drift from the frontend
        // types. Spread into a mutable array — the shared consts are readonly.
        properties: {
          contactSortBy:   { type: 'string', enum: [...SORT_BY] },
          contactSortDir:  { type: 'string', enum: [...SORT_DIR] },
          contactSubtitle: { type: 'string', enum: [...CONTACT_SUBTITLE_FIELDS] },
          mapService:      { type: 'string', enum: [...MAP_SERVICES] },
          darkMode:        { type: 'string', enum: [...DARK_MODES] },
          taskLayout:      { type: 'string', enum: [...TASK_LAYOUTS] },
          notesView:       { type: 'string', enum: [...NOTES_VIEWS] },
          journalsView:    { type: 'string', enum: [...JOURNALS_VIEWS] },
          calendarTaskDate: { type: 'string', enum: [...CALENDAR_TASK_DATES] },
          updatedAt:       { type: 'integer', minimum: 0 },
        },
      },
    },
  }, async (req, reply) => {
    const body = req.body as SettingsBody;

    // Clamp to now (+ small clock-skew tolerance) so a client can't pin its
    // settings against future writes with an arbitrarily large timestamp.
    const updatedAt = Math.min(body.updatedAt ?? Date.now(), Date.now() + 60_000);

    db.prepare(`
      INSERT INTO user_settings
        (username, contact_sort_by, contact_sort_dir, contact_subtitle,
         map_service, dark_mode, task_layout, notes_view, journals_view,
         calendar_task_date, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        contact_sort_by  = excluded.contact_sort_by,
        contact_sort_dir = excluded.contact_sort_dir,
        contact_subtitle = excluded.contact_subtitle,
        map_service      = excluded.map_service,
        dark_mode        = excluded.dark_mode,
        task_layout      = excluded.task_layout,
        notes_view       = excluded.notes_view,
        journals_view    = excluded.journals_view,
        calendar_task_date = excluded.calendar_task_date,
        updated_at       = excluded.updated_at
      WHERE excluded.updated_at > user_settings.updated_at
    `).run(
      req.sessionData!.username,
      body.contactSortBy  ?? 'last',
      body.contactSortDir ?? 'asc',
      body.contactSubtitle ?? '',
      body.mapService     ?? 'osm',
      body.darkMode       ?? 'system',
      body.taskLayout     ?? 'list',
      body.notesView      ?? 'list',
      body.journalsView   ?? 'timeline',
      body.calendarTaskDate ?? 'due',
      updatedAt,
    );

    return reply.status(204).send();
  });
}
