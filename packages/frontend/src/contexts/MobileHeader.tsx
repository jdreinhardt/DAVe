import { createContext, useContext, useEffect } from 'react';

/**
 * Lets a page override the title in the mobile app header (AppLayout), which
 * otherwise shows the static view name from VIEW_NAV_ITEMS. The Calendar page
 * uses this to surface the current date range there, so its own toolbar doesn't
 * have to spend a second row on it.
 *
 * The header is `md:hidden`, so pages can set this unconditionally — there's no
 * need to check `useIsMobile()` and no desktop/mobile flash.
 */
const MobileHeaderContext = createContext<(title: string | null) => void>(() => {});

export const MobileHeaderProvider = MobileHeaderContext.Provider;

/** Push `title` into the mobile header; restores the default on unmount. */
export function useMobileHeaderTitle(title: string | null) {
  const setTitle = useContext(MobileHeaderContext);
  useEffect(() => {
    setTitle(title);
    return () => setTitle(null);
  }, [setTitle, title]);
}
