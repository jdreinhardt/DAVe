export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    credentials: 'include', // always send the session cookie
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore parse failure — keep generic message
    }
    throw new ApiError(res.status, message);
  }

  // 204 No Content — return null cast to T
  if (res.status === 204) return null as T;
  return res.json() as Promise<T>;
}

export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  return apiFetch<T>(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
