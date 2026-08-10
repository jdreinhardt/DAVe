import { useState, useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Menu, Search } from 'lucide-react';
import { getMe } from '../api/auth';
import { ApiError } from '../api/client';
import Sidebar from '../components/Sidebar';
import BottomNav from '../components/BottomNav';
import GlobalSearchModal from '../components/GlobalSearchModal';
import { VIEW_NAV_ITEMS } from '../hooks/useViewNavItems';
import { CollectionVisibilityProvider } from '../contexts/CollectionVisibility';
import { ContactDragProvider } from '../contexts/ContactDrag';
import { NoteDragProvider } from '../contexts/NoteDrag';
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
  const [searchOpen, setSearchOpen] = useState(false);
  const { pathname } = useLocation();

  // Cmd+K / Ctrl+K opens global search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Close drawer on navigation
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const pageTitle =
    VIEW_NAV_ITEMS.find((item) => pathname.startsWith(item.to))?.label ?? 'Calendar';

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
          <NoteDragProvider>
          <SyncPoller />
          <div className="flex h-screen overflow-hidden bg-background">
            <Sidebar
              me={meQuery.data!}
              isOpen={sidebarOpen}
              onClose={() => setSidebarOpen(false)}
              onOpenSearch={() => setSearchOpen(true)}
            />
            <GlobalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
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
                <span className="font-semibold text-sm text-foreground flex-1">{pageTitle}</span>
                <button
                  onClick={() => setSearchOpen(true)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Search"
                >
                  <Search className="h-5 w-5" />
                </button>
              </header>
              {/* `relative` contains the pages' full-bleed mobile detail panes, so the
                  header and bottom nav stay visible behind them. */}
              <main className="flex-1 overflow-auto min-h-0 relative">
                <Outlet />
              </main>
              <BottomNav />
            </div>
          </div>
          </NoteDragProvider>
        </ContactDragProvider>
      </CollectionVisibilityProvider>
    </SettingsProvider>
  );
}
