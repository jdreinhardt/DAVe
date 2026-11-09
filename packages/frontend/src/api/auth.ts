import type {
  AuthConfigResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  MeResponse,
} from '@dave/shared';
import { apiFetch, apiPost } from './client';

export const OIDC_LOGIN_URL = '/api/auth/oidc/login';

export const getMe = (): Promise<MeResponse> => apiFetch<MeResponse>('/api/me');

export const getAuthConfig = (): Promise<AuthConfigResponse> =>
  apiFetch<AuthConfigResponse>('/api/auth/config');

export const login = (creds: LoginRequest): Promise<LoginResponse> =>
  apiPost<LoginResponse>('/api/auth/login', creds);

// null (204) in password mode; a LogoutResponse in OIDC mode.
export const logout = (): Promise<LogoutResponse | null> =>
  apiFetch<LogoutResponse | null>('/api/auth/logout', { method: 'POST' });
