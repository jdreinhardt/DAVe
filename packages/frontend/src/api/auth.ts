import type { LoginRequest, LoginResponse, MeResponse } from '@dave/shared';
import { apiFetch, apiPost } from './client';

export const getMe = (): Promise<MeResponse> => apiFetch<MeResponse>('/api/me');

export const login = (creds: LoginRequest): Promise<LoginResponse> =>
  apiPost<LoginResponse>('/api/auth/login', creds);

export const logout = (): Promise<null> =>
  apiFetch<null>('/api/auth/logout', { method: 'POST' });
