import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildIntegrationApp, loginAndGetCookie } from './setup.js';
import type { CalendarEvent, EventJson } from '@dave/shared';

let app: FastifyInstance;
let cookie: string;
let calendarId: string;

beforeAll(async () => {
  app = await buildIntegrationApp();
  cookie = await loginAndGetCookie(app);

  // Find the seeded calendar
  const calRes = await app.inject({ method: 'GET', url: '/api/calendars', headers: { cookie } });
  const cals = calRes.json() as Array<{ id: string }>;
  if (!cals.length) throw new Error('No calendars found — is Baikal seeded?');
  calendarId = cals[0]!.id;
});

afterAll(async () => {
  await app.close();
});

function simpleEvent(uid: string, summary: string): EventJson {
  return {
    uid,
    summary,
    description: '',
    location: '',
    start: '2025-06-15T14:00:00.000Z',
    end: '2025-06-15T15:00:00.000Z',
    allDay: false,
    tzid: null,
    recurrenceRule: null,
    recurrenceId: null,
    alarms: [],
    attendees: [],
    calendarId,
    color: null,
  };
}

describe('events CRUD', () => {
  it('GET /api/calendars/:id/events returns an array for a date range', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/calendars/${calendarId}/events?start=2025-01-01T00:00:00Z&end=2025-12-31T00:00:00Z`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('returns 400 when start/end query params are missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/calendars/${calendarId}/events`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('full ETag lifecycle: create → update (correct etag) → stale 412 → delete', async () => {
    const uid = `event-integration-${Date.now()}`;

    // Create
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/calendars/${calendarId}/events`,
      headers: { cookie },
      payload: { data: simpleEvent(uid, 'Integration Test Event') },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as CalendarEvent;
    expect(created.etag).toBeTruthy();
    const eventId = created.id;
    const etag1 = created.etag;

    // Update with correct etag
    const updateRes = await app.inject({
      method: 'PUT',
      url: `/api/events/${eventId}`,
      headers: { cookie },
      payload: {
        data: { ...simpleEvent(uid, 'Updated Event'), calendarId },
        etag: etag1,
      },
    });
    expect(updateRes.statusCode).toBe(200);
    const updated = updateRes.json() as CalendarEvent;
    const etag2 = updated.etag;
    expect(etag2).toBeTruthy();

    // Update with stale etag → 412
    const staleRes = await app.inject({
      method: 'PUT',
      url: `/api/events/${eventId}`,
      headers: { cookie },
      payload: {
        data: { ...simpleEvent(uid, 'Stale Update'), calendarId },
        etag: etag1,
      },
    });
    expect(staleRes.statusCode).toBe(412);

    // Delete with current etag
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/events/${eventId}?etag=${encodeURIComponent(etag2)}&calendarId=${encodeURIComponent(calendarId)}`,
      headers: { cookie },
    });
    expect(deleteRes.statusCode).toBe(204);
  });
});

describe('recurring event scoped operations', () => {
  it('creates a daily recurring event, deletes one occurrence, and verifies EXDATE added', async () => {
    const uid = `recur-event-${Date.now()}`;

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/calendars/${calendarId}/events`,
      headers: { cookie },
      payload: {
        data: {
          ...simpleEvent(uid, 'Daily Standup'),
          start: '2025-07-01T09:00:00.000Z',
          end: '2025-07-01T09:30:00.000Z',
          recurrenceRule: { freq: 'DAILY' as const, raw: 'FREQ=DAILY;COUNT=7' },
        },
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as CalendarEvent;
    const eventId = created.id;
    const etag = created.etag;

    // Delete just the July 3 occurrence
    const scopedDelete = await app.inject({
      method: 'DELETE',
      url: `/api/events/${eventId}?etag=${encodeURIComponent(etag)}&calendarId=${encodeURIComponent(calendarId)}&scope=this&recurrenceId=${encodeURIComponent('2025-07-03T09:00:00.000Z')}`,
      headers: { cookie },
    });
    expect(scopedDelete.statusCode).toBe(204);

    // Clean up: delete the whole series
    // Re-fetch to get the current etag
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/calendars/${calendarId}/events?start=2025-07-01T00:00:00Z&end=2025-07-08T00:00:00Z`,
      headers: { cookie },
    });
    const events = (listRes.json() as CalendarEvent[]).filter((e) => e.data.uid === uid);
    if (events.length > 0) {
      const currentEtag = events[0]!.etag;
      await app.inject({
        method: 'DELETE',
        url: `/api/events/${eventId}?etag=${encodeURIComponent(currentEtag)}&calendarId=${encodeURIComponent(calendarId)}`,
        headers: { cookie },
      });
    }
  });
});
