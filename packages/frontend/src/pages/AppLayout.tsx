import { Navigate, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getMe } from '../api/auth';
import { ApiError } from '../api/client';
import Sidebar from '../components/Sidebar';
import { CollectionVisibilityProvider } from '../contexts/CollectionVisibility';
import { ContactDragProvider } from '../contexts/ContactDrag';
import { SettingsProvider } from '../contexts/Settings';
import { useSyncCollections } from '../hooks/useSyncCollections';

function SyncPoller() {
  useSyncCollections();
  return null;
}

export default function AppLayout() {
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    retry: (count, err) => {
      // Don't retry on 401 — user needs to log in.
      if (err instanceof ApiError && err.statusCode === 401) return false;
      return count < 2;
    },
    staleTime: 5 * 60_000,
  });

  if (meQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (meQuery.isError) {
    return <Navigate to="/login" replace />;
  }

  return (
    <SettingsProvider>
      <CollectionVisibilityProvider>
        <ContactDragProvider>
          <SyncPoller />
          <div className="flex h-screen overflow-hidden bg-background">
            <Sidebar me={meQuery.data!} />
            <main className="flex-1 overflow-auto">
              <Outlet />
            </main>
          </div>
        </ContactDragProvider>
      </CollectionVisibilityProvider>
    </SettingsProvider>
  );
}
