import type { FastifyInstance } from 'fastify';
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
      updatedAt:      row.updated_at,
    } satisfies SettingsBody);
  });

  app.put('/api/settings', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          contactSortBy:   { type: 'string', enum: ['first', 'last'] },
          contactSortDir:  { type: 'string', enum: ['asc', 'desc'] },
          contactSubtitle: { type: 'string', enum: ['nickname', 'email', 'phone', 'organization', 'title', ''] },
          mapService:      { type: 'string', enum: ['osm', 'google', 'apple'] },
          darkMode:        { type: 'string', enum: ['light', 'dark', 'system'] },
          taskLayout:      { type: 'string', enum: ['list', 'compact', 'kanban'] },
          notesView:       { type: 'string', enum: ['list', 'grid'] },
          journalsView:    { type: 'string', enum: ['timeline', 'list', 'calendar'] },
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
         map_service, dark_mode, task_layout, notes_view, journals_view, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        contact_sort_by  = excluded.contact_sort_by,
        contact_sort_dir = excluded.contact_sort_dir,
        contact_subtitle = excluded.contact_subtitle,
        map_service      = excluded.map_service,
        dark_mode        = excluded.dark_mode,
        task_layout      = excluded.task_layout,
        notes_view       = excluded.notes_view,
        journals_view    = excluded.journals_view,
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
      updatedAt,
    );

    return reply.status(204).send();
  });
}
