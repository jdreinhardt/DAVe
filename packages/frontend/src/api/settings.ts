import { apiFetch } from './client.js';

export interface ServerSettings {
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

// Returns null for any error (401 not logged in, 404 no record, network failure).
// Callers treat null as "skip sync this mount".
export async function fetchServerSettings(): Promise<ServerSettings | null> {
  try {
    return await apiFetch<ServerSettings>('/api/settings');
  } catch {
    return null;
  }
}

export async function pushServerSettings(settings: ServerSettings): Promise<void> {
  await apiFetch<void>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}
