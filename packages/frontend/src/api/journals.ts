import type {
  Note,
  NoteJson,
  JournalsResponse,
  JournalsQueryParams,
  NoteWriteResponse,
  CreateNoteRequest,
  UpdateNoteRequest,
} from '@dave/shared';
import { apiFetch } from './client.js';

export async function fetchJournals(params?: JournalsQueryParams): Promise<JournalsResponse> {
  const qs = params ? buildQueryString(params) : '';
  return apiFetch<JournalsResponse>(`/api/journals${qs ? `?${qs}` : ''}`);
}

export async function fetchJournal(uid: string): Promise<Note> {
  return apiFetch<Note>(`/api/journals/${encodeURIComponent(uid)}`);
}

export async function createJournal(data: NoteJson): Promise<NoteWriteResponse> {
  const body: CreateNoteRequest = { data };
  return apiFetch<NoteWriteResponse>('/api/journals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function updateJournal(uid: string, data: NoteJson, etag: string): Promise<NoteWriteResponse> {
  const body: UpdateNoteRequest = { data, etag };
  return apiFetch<NoteWriteResponse>(`/api/journals/${encodeURIComponent(uid)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function deleteJournal(uid: string, etag: string): Promise<void> {
  const qs = new URLSearchParams({ etag });
  await apiFetch<void>(`/api/journals/${encodeURIComponent(uid)}?${qs.toString()}`, {
    method: 'DELETE',
  });
}

// Journals share VJOURNAL collections with Notes — the same sync endpoint covers both.
export async function triggerJournalsSync(): Promise<void> {
  await apiFetch<{ ok: true }>('/api/sync/notes', { method: 'POST' });
}

function buildQueryString(params: JournalsQueryParams): string {
  const q = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== '') q.set(key, String(val));
  }
  return q.toString();
}
