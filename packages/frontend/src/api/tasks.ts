import type { Task, TasksResponse, TasksQueryParams } from '@dave/shared';
import { apiFetch } from './client.js';

export async function fetchTasks(params?: TasksQueryParams): Promise<TasksResponse> {
  const qs = params ? buildQueryString(params) : '';
  return apiFetch<TasksResponse>(`/api/tasks${qs ? `?${qs}` : ''}`);
}

export async function fetchTask(uid: string): Promise<Task> {
  return apiFetch<Task>(`/api/tasks/${encodeURIComponent(uid)}`);
}

export async function triggerTasksSync(): Promise<void> {
  await apiFetch<{ ok: true }>('/api/sync/tasks', { method: 'POST' });
}

function buildQueryString(params: TasksQueryParams): string {
  const q = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== '') q.set(key, String(val));
  }
  return q.toString();
}
