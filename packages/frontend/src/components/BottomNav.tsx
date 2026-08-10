import { NavLink } from 'react-router-dom';
import { cn } from '../lib/utils';
import { useViewNavItems } from '../hooks/useViewNavItems';

/**
 * Mobile-only tab bar for switching views. Gated by CSS (`md:hidden`) rather than
 * `useIsMobile()` so it stays renderable in jsdom, which has no `matchMedia`.
 *
 * Sits in the normal flex flow below <main>, so the content area shrinks around it
 * instead of scrolling underneath.
 */
export default function BottomNav() {
  const items = useViewNavItems();

  return (
    <nav
      className="md:hidden shrink-0 flex items-stretch border-t border-border bg-card pb-[env(safe-area-inset-bottom)]"
      aria-label="Views"
    >
      {items.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              'flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground',
            )
          }
        >
          {({ isActive }) => (
            <>
              <span
                className={cn(
                  'flex items-center justify-center rounded-full px-3 py-1 transition-colors',
                  isActive && 'bg-primary/10',
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
              </span>
              <span className="max-w-full truncate px-1">{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
