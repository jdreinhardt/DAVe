import type { Note, NoteJson, TaskRelation } from '@dave/shared';
import { parseDtstartFromVJournalIcs } from './ical.js';

export interface VJournalEntryRow {
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

export interface CategoryRow {
  entry_id: number;
  category: string;
}

export interface RelationRow {
  entry_id: number;
  related_uid: string;
  reltype: string;
}

export function collectionIdFromUrl(url: string): string {
  try {
    const seg = new URL(url).pathname.replace(/\/$/, '').split('/').filter(Boolean);
    return seg[seg.length - 1] ?? url;
  } catch {
    return url;
  }
}

export function msToIso(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  return new Date(ms).toISOString();
}

export function buildFtsQuery(q: string): string {
  const words = q.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '""';
  return words.map((w) => `"${w.replace(/"/g, '""')}"*`).join(' ');
}

export function rowToVJournalEntry(
  row: VJournalEntryRow,
  categories: string[],
  relations: TaskRelation[],
): Note {
  const dtstart = parseDtstartFromVJournalIcs(row.raw_ics ?? null) ?? msToIso(row.dtstart);
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
