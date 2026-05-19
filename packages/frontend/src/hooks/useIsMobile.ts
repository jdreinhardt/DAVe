import { useState, useEffect } from 'react';

const MOBILE_QUERY = '(max-width: 767px)';

export function useIsMobile(): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(MOBILE_QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return matches;
}
