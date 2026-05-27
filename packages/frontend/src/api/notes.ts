import type {
  Note,
  NoteJson,
  NotesResponse,
  NotesQueryParams,
  NoteWriteResponse,
  CreateNoteRequest,
  UpdateNoteRequest,
} from '@dave/shared';
import { apiFetch } from './client.js';

export async function fetchNotes(params?: NotesQueryParams): Promise<NotesResponse> {
  const qs = params ? buildQueryString(params) : '';
  return apiFetch<NotesResponse>(`/api/notes${qs ? `?${qs}` : ''}`);
}

export async function fetchNote(uid: string): Promise<Note> {
  return apiFetch<Note>(`/api/notes/${encodeURIComponent(uid)}`);
}

export async function createNote(data: NoteJson): Promise<NoteWriteResponse> {
  const body: CreateNoteRequest = { data };
  return apiFetch<NoteWriteResponse>('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function updateNote(uid: string, data: NoteJson, etag: string): Promise<NoteWriteResponse> {
  const body: UpdateNoteRequest = { data, etag };
  return apiFetch<NoteWriteResponse>(`/api/notes/${encodeURIComponent(uid)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function deleteNote(uid: string, etag: string): Promise<void> {
  const qs = new URLSearchParams({ etag });
  await apiFetch<void>(`/api/notes/${encodeURIComponent(uid)}?${qs.toString()}`, {
    method: 'DELETE',
  });
}

export async function triggerNotesSync(): Promise<void> {
  await apiFetch<{ ok: true }>('/api/sync/notes', { method: 'POST' });
}

function buildQueryString(params: NotesQueryParams): string {
  const q = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== '') q.set(key, String(val));
  }
  return q.toString();
}
