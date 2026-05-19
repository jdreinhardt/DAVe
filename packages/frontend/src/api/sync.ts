import type { CollectionSyncRequest, CollectionSyncResponse } from '@dave/shared';
import { apiFetch } from './client';

export const syncCollections = (body: CollectionSyncRequest): Promise<CollectionSyncResponse> =>
  apiFetch<CollectionSyncResponse>('/api/sync', {
    method: 'POST',
    body: JSON.stringify(body),
  });
