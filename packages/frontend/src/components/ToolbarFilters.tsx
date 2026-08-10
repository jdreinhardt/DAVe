import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * Mobile-only disclosure for the secondary toolbar controls (sort, filters, view
 * toggle). The toolbars wrap onto several rows on a phone, which reads as clutter;
 * collapsing everything but "new" and "search" keeps the default view calm.
 *
 * `activeCount` should count only controls that hide entries from the list — sort
 * and view toggles don't, so they aren't counted. Without it a user can filter,
 * collapse, and then have no way to see why the list is short.
 */
export function ToolbarFilterToggle({
  open,
  onToggle,
  activeCount,
}: {
  open: boolean;
  onToggle: () => void;
  activeCount: number;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? 'Hide filters' : 'Show filters'}
      className={cn(
        // h-[34px] matches the search input it sits beside; the icons alone would
        // otherwise make this button noticeably shorter than its neighbours.
        'md:hidden flex h-[34px] items-center gap-1 shrink-0 rounded-md border px-2 transition-colors',
        activeCount > 0 ? 'border-primary text-primary' : 'border-input text-muted-foreground',
      )}
    >
      <SlidersHorizontal className="h-3.5 w-3.5" />
      {activeCount > 0 && (
        <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium leading-none text-primary-foreground">
          {activeCount}
        </span>
      )}
      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
    </button>
  );
}

/**
 * Wrapper for the controls the toggle hides.
 *
 * On desktop this is `display: contents`, so its children participate in the parent
 * toolbar's flex-wrap row exactly as they did before the wrapper existed — the
 * desktop layout is unchanged. On mobile it collapses to nothing, or expands to a
 * full-width wrapped row beneath the primary controls.
 */
export function ToolbarFilterGroup({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn('md:contents', open ? 'flex w-full flex-wrap items-end gap-2' : 'hidden')}
    >
      {children}
    </div>
  );
}

/**
 * Right-aligned cluster for the end of the primary toolbar row (search + the toggle),
 * leaving the "new" button alone on the left. Desktop is unaffected: `display: contents`
 * hands the children straight back to the toolbar's own flex row.
 */
export function ToolbarPrimaryEnd({ children }: { children: React.ReactNode }) {
  return <div className="ml-auto flex items-center gap-2 md:contents">{children}</div>;
}
