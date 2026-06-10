import type { GlobalSearchResponse } from '@dave/shared';
import { apiFetch } from './client.js';

export async function searchGlobal(q: string): Promise<GlobalSearchResponse> {
  return apiFetch<GlobalSearchResponse>(`/api/search?q=${encodeURIComponent(q)}`);
}
