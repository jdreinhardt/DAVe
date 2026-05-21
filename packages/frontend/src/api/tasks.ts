import type { Task, TaskJson, TasksResponse, TasksQueryParams, TaskWriteResponse, CreateTaskRequest, UpdateTaskRequest } from '@dave/shared';
import { apiFetch } from './client.js';

export async function fetchTasks(params?: TasksQueryParams): Promise<TasksResponse> {
  const qs = params ? buildQueryString(params) : '';
  return apiFetch<TasksResponse>(`/api/tasks${qs ? `?${qs}` : ''}`);
}

export async function fetchTask(uid: string): Promise<Task> {
  return apiFetch<Task>(`/api/tasks/${encodeURIComponent(uid)}`);
}

export async function createTask(data: TaskJson): Promise<TaskWriteResponse> {
  const body: CreateTaskRequest = { data };
  return apiFetch<TaskWriteResponse>('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function updateTask(uid: string, data: TaskJson, etag: string): Promise<TaskWriteResponse> {
  const body: UpdateTaskRequest = { data, etag };
  return apiFetch<TaskWriteResponse>(`/api/tasks/${encodeURIComponent(uid)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function deleteTask(uid: string, etag: string): Promise<void> {
  await apiFetch<void>(`/api/tasks/${encodeURIComponent(uid)}?etag=${encodeURIComponent(etag)}`, {
    method: 'DELETE',
  });
}

export async function triggerTasksSync(): Promise<void> {
  await apiFetch<{ ok: true }>('/api/sync/tasks', { method: 'POST' });
}

/**
 * Enforce the three-property coherence rule for task completion.
 * Client-side copy of the backend's applyCompletion, used for optimistic UI updates.
 */
export function applyCompletion(data: TaskJson, completed: boolean): TaskJson {
  const result = { ...data };
  if (completed) {
    result.status = 'COMPLETED';
    result.percentComplete = 100;
    if (!result.completed) result.completed = new Date().toISOString();
  } else {
    if (result.status === 'COMPLETED') result.status = 'NEEDS-ACTION';
    if (result.percentComplete === 100) result.percentComplete = 0;
    result.completed = null;
  }
  return result;
}

function buildQueryString(params: TasksQueryParams): string {
  const q = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== '') q.set(key, String(val));
  }
  return q.toString();
}
