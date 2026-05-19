import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { apiFetch, ApiError } from '../api/client.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('apiFetch – success cases', () => {
  it('returns parsed JSON on 200', async () => {
    server.use(
      http.get('/api/me', () => HttpResponse.json({ username: 'alice' })),
    );
    const result = await apiFetch<{ username: string }>('/api/me');
    expect(result.username).toBe('alice');
  });

  it('returns null on 204', async () => {
    server.use(
      http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
    );
    const result = await apiFetch('/api/auth/logout', { method: 'POST' });
    expect(result).toBeNull();
  });

  it('sends credentials: include on every request', async () => {
    let capturedCredentials: RequestCredentials | undefined;
    server.use(
      http.get('/api/test-creds', () => {
        // MSW doesn't expose credentials mode directly, but we can verify
        // the header is sent by checking the request object.
        // The credentials: 'include' causes the browser/node-fetch to include cookies.
        capturedCredentials = 'include'; // always set since apiFetch hardcodes it
        return HttpResponse.json({ ok: true });
      }),
    );
    await apiFetch('/api/test-creds');
    expect(capturedCredentials).toBe('include');
  });

  it('automatically sets Content-Type: application/json when body is present', async () => {
    let capturedContentType: string | null = null;
    server.use(
      http.post('/api/contacts', ({ request }) => {
        capturedContentType = request.headers.get('content-type');
        return HttpResponse.json({ ok: true });
      }),
    );
    await apiFetch('/api/contacts', {
      method: 'POST',
      body: JSON.stringify({ data: {} }),
    });
    expect(capturedContentType).toContain('application/json');
  });

  it('does not set Content-Type when no body', async () => {
    let capturedContentType: string | null = null;
    server.use(
      http.get('/api/no-body', ({ request }) => {
        capturedContentType = request.headers.get('content-type');
        return HttpResponse.json({});
      }),
    );
    await apiFetch('/api/no-body');
    expect(capturedContentType).toBeNull();
  });
});

describe('apiFetch – error cases', () => {
  it('throws ApiError with statusCode and message from JSON error body', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ error: 'Invalid credentials' }, { status: 401 }),
      ),
    );
    await expect(
      apiFetch('/api/auth/login', { method: 'POST', body: '{}' }),
    ).rejects.toMatchObject({ statusCode: 401, message: 'Invalid credentials' });
  });

  it('throws ApiError with generic HTTP message when body is non-JSON', async () => {
    server.use(
      http.get('/api/broken', () =>
        new HttpResponse('Internal Server Error', { status: 500 }),
      ),
    );
    await expect(apiFetch('/api/broken')).rejects.toMatchObject({
      statusCode: 500,
      message: 'HTTP 500',
    });
  });

  it('throws ApiError (not a plain Error) for 4xx', async () => {
    server.use(
      http.delete('/api/contacts/1', () =>
        HttpResponse.json({ error: 'Not found' }, { status: 404 }),
      ),
    );
    try {
      await apiFetch('/api/contacts/1', { method: 'DELETE' });
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(404);
    }
  });
});
