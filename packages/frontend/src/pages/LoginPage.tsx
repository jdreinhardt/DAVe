import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '../lib/utils';
import { login, getMe } from '../api/auth';
import { ApiError } from '../api/client';

export default function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // If already authenticated, go straight to the app.
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    retry: false,
    staleTime: Infinity,
  });

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: async () => {
      // Invalidate the me cache so AppLayout re-fetches with fresh session.
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/contacts', { replace: true });
    },
  });

  if (meQuery.isSuccess) {
    return <Navigate to="/contacts" replace />;
  }

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
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">DAVe</h1>
          <p className="text-sm text-muted-foreground">CalDAV web client</p>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
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
              className={cn(
                'w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground',
                'hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:cursor-not-allowed disabled:opacity-50 transition-opacity',
              )}
            >
              {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
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
