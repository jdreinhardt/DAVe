import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSession,
  getSession,
  touchSession,
  deleteSession,
  sweepExpiredSessions,
  type SessionData,
} from '../services/session.js';
import { makeDb, TEST_SECRET } from './helpers.js';
import type { DbInstance } from '../db/index.js';

const TTL_HOURS = 168;

const SAMPLE_DATA: SessionData = {
  username: 'alice',
  password: 'hunter2',
  displayName: 'Alice',
  principalUrl: 'https://baikal.test/principals/alice',
  calendarHomeUrl: 'https://baikal.test/cal/alice/',
  addressBookHomeUrl: 'https://baikal.test/ab/alice/',
};

let db: DbInstance;

beforeEach(() => {
  db = makeDb();
});

describe('createSession', () => {
  it('returns a non-empty ID', () => {
    const id = createSession(SAMPLE_DATA, TEST_SECRET, db);
    expect(id).toBeTruthy();
    expect(id.length).toBeGreaterThan(20);
  });

  it('creates distinct IDs for each call', () => {
    const a = createSession(SAMPLE_DATA, TEST_SECRET, db);
    const b = createSession(SAMPLE_DATA, TEST_SECRET, db);
    expect(a).not.toBe(b);
  });
});

describe('getSession', () => {
  it('returns the original SessionData after create', () => {
    const id = createSession(SAMPLE_DATA, TEST_SECRET, db);
    const result = getSession(id, TEST_SECRET, TTL_HOURS, db);
    expect(result).toEqual(SAMPLE_DATA);
  });

  it('returns null for an unknown ID', () => {
    expect(getSession('does-not-exist', TEST_SECRET, TTL_HOURS, db)).toBeNull();
  });

  it('returns null and deletes the row after TTL expiry', () => {
    const id = createSession(SAMPLE_DATA, TEST_SECRET, db);
    // Backdate last_activity_at beyond TTL
    const cutoff = Date.now() - (TTL_HOURS + 1) * 3_600_000;
    db.prepare('UPDATE sessions SET last_activity_at = ? WHERE id = ?').run(cutoff, id);

    expect(getSession(id, TEST_SECRET, TTL_HOURS, db)).toBeNull();
    // Row should be gone
    const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id);
    expect(row).toBeUndefined();
  });

  it('returns null and drops the row for tampered (unreadable) data', () => {
    const id = createSession(SAMPLE_DATA, TEST_SECRET, db);
    db.prepare("UPDATE sessions SET data = 'not-valid-ciphertext' WHERE id = ?").run(id);

    expect(getSession(id, TEST_SECRET, TTL_HOURS, db)).toBeNull();
    const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id);
    expect(row).toBeUndefined();
  });
});

describe('touchSession', () => {
  it('updates last_activity_at', () => {
    const id = createSession(SAMPLE_DATA, TEST_SECRET, db);
    const before = (db.prepare('SELECT last_activity_at FROM sessions WHERE id = ?').get(id) as { last_activity_at: number }).last_activity_at;

    // Force a small gap so the timestamp changes
    const later = before + 5_000;
    db.prepare('UPDATE sessions SET last_activity_at = ? WHERE id = ?').run(before - 1_000, id);
    touchSession(id, db);
    const after = (db.prepare('SELECT last_activity_at FROM sessions WHERE id = ?').get(id) as { last_activity_at: number }).last_activity_at;

    expect(after).toBeGreaterThan(before - 1_000);
    expect(after).toBeGreaterThanOrEqual(later - 5_000);
  });
});

describe('deleteSession', () => {
  it('removes the session from the DB', () => {
    const id = createSession(SAMPLE_DATA, TEST_SECRET, db);
    deleteSession(id, db);
    expect(getSession(id, TEST_SECRET, TTL_HOURS, db)).toBeNull();
    const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id);
    expect(row).toBeUndefined();
  });

  it('is a no-op for an unknown ID', () => {
    expect(() => deleteSession('ghost', db)).not.toThrow();
  });
});

describe('sweepExpiredSessions', () => {
  it('deletes only sessions past TTL and returns the count', () => {
    const activeId = createSession(SAMPLE_DATA, TEST_SECRET, db);
    const expiredId1 = createSession(SAMPLE_DATA, TEST_SECRET, db);
    const expiredId2 = createSession(SAMPLE_DATA, TEST_SECRET, db);

    const oldTime = Date.now() - (TTL_HOURS + 1) * 3_600_000;
    db.prepare('UPDATE sessions SET last_activity_at = ? WHERE id = ?').run(oldTime, expiredId1);
    db.prepare('UPDATE sessions SET last_activity_at = ? WHERE id = ?').run(oldTime, expiredId2);

    const deleted = sweepExpiredSessions(TTL_HOURS, db);
    expect(deleted).toBe(2);

    // Active session should still exist
    expect(getSession(activeId, TEST_SECRET, TTL_HOURS, db)).toEqual(SAMPLE_DATA);
    // Expired sessions should be gone
    expect(db.prepare('SELECT id FROM sessions WHERE id = ?').get(expiredId1)).toBeUndefined();
    expect(db.prepare('SELECT id FROM sessions WHERE id = ?').get(expiredId2)).toBeUndefined();
  });

  it('returns 0 when nothing is expired', () => {
    createSession(SAMPLE_DATA, TEST_SECRET, db);
    expect(sweepExpiredSessions(TTL_HOURS, db)).toBe(0);
  });
});
