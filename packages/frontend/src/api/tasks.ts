import type { Task, TaskJson, TasksResponse, TasksQueryParams, TaskWriteResponse, DeleteTaskResponse, CreateTaskRequest, UpdateTaskRequest, ArchivedTasksResponse, RestoreArchivedTaskRequest } from '@dave/shared';
import { apiFetch, buildQueryString } from './client.js';

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

export async function deleteTask(
  uid: string,
  etag: string,
  deleteChildren?: boolean,
): Promise<DeleteTaskResponse> {
  const qs = new URLSearchParams({ etag });
  if (deleteChildren) qs.set('deleteChildren', 'true');
  return apiFetch<DeleteTaskResponse>(`/api/tasks/${encodeURIComponent(uid)}?${qs.toString()}`, {
    method: 'DELETE',
  });
}

export async function searchArchive(q: string): Promise<ArchivedTasksResponse> {
  return apiFetch<ArchivedTasksResponse>(`/api/tasks/archive-search?${new URLSearchParams({ q }).toString()}`);
}

export async function restoreArchivedTask(req: RestoreArchivedTaskRequest): Promise<TaskWriteResponse> {
  return apiFetch<TaskWriteResponse>('/api/tasks/archive-restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export async function triggerTasksSync(): Promise<void> {
  await apiFetch<{ ok: true }>('/api/sync/tasks', { method: 'POST' });
}

/**
 * Apply an arbitrary status change, keeping STATUS/PERCENT-COMPLETE/COMPLETED coherent.
 * Used when dragging a card to a different kanban column.
 */
export function applyStatusChange(data: TaskJson, newStatus: string): TaskJson {
  const result = { ...data, status: newStatus };
  if (newStatus === 'COMPLETED') {
    result.percentComplete = 100;
    if (!result.completed) result.completed = new Date().toISOString();
  } else if (newStatus === 'CANCELLED') {
    result.completed = null;
  } else {
    // NEEDS-ACTION or IN-PROCESS — clear completion state
    if (result.percentComplete === 100) result.percentComplete = 0;
    result.completed = null;
  }
  return result;
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

