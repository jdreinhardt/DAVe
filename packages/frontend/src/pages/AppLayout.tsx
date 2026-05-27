import { useState, useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Menu } from 'lucide-react';
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
      if (err instanceof ApiError && err.statusCode === 401) return false;
      return count < 2;
    },
    staleTime: 5 * 60_000,
  });

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { pathname } = useLocation();

  // Close drawer on navigation
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const pageTitle = pathname.startsWith('/contacts')
    ? 'Contacts'
    : pathname.startsWith('/tasks')
      ? 'Tasks'
      : pathname.startsWith('/notes')
        ? 'Notes'
        : pathname.startsWith('/journals')
          ? 'Journals'
          : 'Calendar';

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
            <Sidebar
              me={meQuery.data!}
              isOpen={sidebarOpen}
              onClose={() => setSidebarOpen(false)}
            />
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
              {/* Mobile-only header */}
              <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-card shrink-0">
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5" />
                </button>
                <span className="font-semibold text-sm text-foreground">{pageTitle}</span>
              </header>
              <main className="flex-1 overflow-auto min-h-0">
                <Outlet />
              </main>
            </div>
          </div>
        </ContactDragProvider>
      </CollectionVisibilityProvider>
    </SettingsProvider>
  );
}
