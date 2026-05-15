import crypto from 'crypto';
import type { DbInstance as DatabaseSync } from '../db/index.js';
import { encrypt, decrypt } from '../lib/crypto.js';

// All credential and discovery data stored per session.
export interface SessionData {
  username: string;
  password: string; // plaintext in memory; encrypted at rest
  displayName: string;
  principalUrl: string;
  calendarHomeUrl: string;
  addressBookHomeUrl: string;
}

interface SessionRow {
  id: string;
  data: string;
  created_at: number;
  last_activity_at: number;
}

export function createSession(
  data: SessionData,
  secret: string,
  db: DatabaseSync,
): string {
  const id = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare(
    'INSERT INTO sessions (id, data, created_at, last_activity_at) VALUES (?, ?, ?, ?)',
  ).run(id, encrypt(JSON.stringify(data), secret), now, now);
  return id;
}

export function getSession(
  id: string,
  secret: string,
  ttlHours: number,
  db: DatabaseSync,
): SessionData | null {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
    | SessionRow
    | undefined;
  if (!row) return null;

  // Sliding-window TTL check.
  if (Date.now() - row.last_activity_at > ttlHours * 3_600_000) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return null;
  }

  try {
    return JSON.parse(decrypt(row.data, secret)) as SessionData;
  } catch {
    // Corrupted or tampered — drop it.
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return null;
  }
}

export function touchSession(id: string, db: DatabaseSync): void {
  db.prepare('UPDATE sessions SET last_activity_at = ? WHERE id = ?').run(
    Date.now(),
    id,
  );
}

export function deleteSession(id: string, db: DatabaseSync): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function sweepExpiredSessions(ttlHours: number, db: DatabaseSync): number {
  const cutoff = Date.now() - ttlHours * 3_600_000;
  const result = db
    .prepare('DELETE FROM sessions WHERE last_activity_at < ?')
    .run(cutoff) as { changes: number };
  return result.changes;
}
