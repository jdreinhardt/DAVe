import { useEffect, useState } from 'react';
import { useNavigate, Navigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranch } from 'lucide-react';
import type { OidcLoginError } from '@dave/shared';
import { cn, SOURCE_REPO_URL } from '../lib/utils';
import { login, getMe, getAuthConfig, OIDC_LOGIN_URL } from '../api/auth';
import { ApiError } from '../api/client';

const OIDC_ERROR_MESSAGES: Record<OidcLoginError, string> = {
  oidc_failed: 'Single sign-on failed. Please try again.',
  oidc_identity: 'Your account has no username DAVe can use. Ask your administrator.',
  dav_denied: 'The DAV server refused your account.',
  dav_unavailable: 'Could not reach the DAV server. Please try again later.',
};

export default function LoginPage() {
  // If already authenticated, go straight to the app.
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    retry: false,
    staleTime: Infinity,
  });

  const authConfigQuery = useQuery({
    queryKey: ['auth-config'],
    queryFn: getAuthConfig,
    staleTime: Infinity,
  });

  if (meQuery.isSuccess) {
    return <Navigate to="/" replace />;
  }

  let body: React.ReactNode;
  if (meQuery.isLoading || authConfigQuery.isLoading) {
    body = <Spinner />;
  } else if (authConfigQuery.data?.mode === 'oidc') {
    body = <OidcLogin />;
  } else {
    // Also the fallback if the config request failed: the form then reports
    // whatever the backend says on submit.
    body = <PasswordLogin />;
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">DAVe</h1>
          <p className="text-sm text-muted-foreground">CalDAV web client</p>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">{body}</div>

        <p className="text-center">
          <a
            href={SOURCE_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
            Source · AGPL-3.0
          </a>
        </p>
      </div>
    </div>
  );
}

/**
 * With OIDC there is nothing to type, so the page normally just hands off to the
 * provider. It only stays put after a failed attempt or an explicit sign-out —
 * redirecting then would loop, or silently sign the user back in.
 */
function OidcLogin() {
  const [params] = useSearchParams();
  const error = params.get('error') as OidcLoginError | null;
  const signedOut = params.has('signedOut');
  const autoRedirect = !error && !signedOut;

  useEffect(() => {
    if (autoRedirect) window.location.replace(OIDC_LOGIN_URL);
  }, [autoRedirect]);

  if (autoRedirect) {
    return (
      <div className="space-y-3 text-center">
        <Spinner />
        <p className="text-sm text-muted-foreground">Redirecting to sign-in…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {OIDC_ERROR_MESSAGES[error] ?? OIDC_ERROR_MESSAGES.oidc_failed}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">You have been signed out.</p>
      )}
      <a href={OIDC_LOGIN_URL} className={cn(buttonCls, 'block text-center')}>
        Sign in
      </a>
    </div>
  );
}

function PasswordLogin() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: async () => {
      // Invalidate the me cache so AppLayout re-fetches with fresh session.
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      // "/" resolves the configured home view — LoginPage sits outside SettingsProvider.
      navigate('/', { replace: true });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ username, password });
  };

  const errorMsg = loginMutation.error
    ? loginMutation.error instanceof ApiError && loginMutation.error.statusCode === 401
      ? 'Incorrect username or password.'
      : loginMutation.error.message
    : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <Field label="Username" htmlFor="username">
        <input
          id="username"
          type="text"
          autoComplete="username"
          autoFocus
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={inputCls}
          placeholder="your-username"
          disabled={loginMutation.isPending}
        />
      </Field>

      <Field label="Password" htmlFor="password">
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
          disabled={loginMutation.isPending}
        />
      </Field>

      {errorMsg && (
        <p role="alert" className="text-sm text-destructive">
          {errorMsg}
        </p>
      )}

      <button
        type="submit"
        disabled={loginMutation.isPending || !username || !password}
        className={buttonCls}
      >
        {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center">
      <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputCls = cn(
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground',
  'placeholder:text-muted-foreground',
  'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent',
  'disabled:opacity-50',
);

const buttonCls = cn(
  'w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground',
  'hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  'disabled:cursor-not-allowed disabled:opacity-50 transition-opacity',
);
