import { useCallback, useRef, useState } from 'react';
import { CalendarSearch } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * Jump-to-date, built on the browser's own date picker.
 *
 * The input is visually hidden and driven by `showPicker()` — rendering a bare
 * `<input type="date">` would put a full date field in the toolbar, which is far
 * wider than the affordance deserves. `showPicker()` throws when it isn't allowed
 * (older browsers, or a call outside a user gesture), so we fall back to focusing
 * the input, which opens the picker on most platforms anyway.
 *
 * Split into a hook and a button because FullCalendar's `headerToolbar` renders its
 * own buttons: the calendar's desktop toolbar needs the input and the open callback
 * without our markup, while everywhere else wants the whole control.
 */
export function useDateJumper(onPick: (date: string) => void) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(() => new Date().toISOString().substring(0, 10));

  /**
   * The browser anchors the picker to the input, not to whatever was clicked, and
   * `sr-only` is `position: absolute` — so an input rendered away from its trigger
   * drops the popup wherever that happens to land. Callers whose button lives
   * elsewhere in the DOM (FullCalendar owns its toolbar buttons) pass that element
   * as `anchor` and the input is parked over it first.
   */
  const open = useCallback((anchor?: HTMLElement | null) => {
    const el = inputRef.current;
    if (!el) return;

    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      // Fixed, so the rect's viewport coordinates can be used directly rather than
      // being resolved against whichever ancestor happens to be positioned.
      el.style.position = 'fixed';
      el.style.left = `${rect.left}px`;
      el.style.top = `${rect.top}px`;
      el.style.width = `${rect.width}px`;
      el.style.height = `${rect.height}px`;
    }

    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  }, []);

  const input = (
    <input
      ref={inputRef}
      type="date"
      value={value}
      onChange={(e) => {
        const date = e.target.value;
        if (!date) return;
        setValue(date);
        onPick(date);
      }}
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
    />
  );

  return { open, input };
}

/** The icon button and its hidden date input, ready to drop into a toolbar. */
export default function DateJumpButton({
  onPick,
  className,
}: {
  onPick: (date: string) => void;
  className?: string;
}) {
  const { open, input } = useDateJumper(onPick);

  return (
    <div className="relative shrink-0">
      {input}
      <button
        type="button"
        // No anchor: the input is this button's sibling, so the picker lands correctly.
        onClick={() => open()}
        title="Jump to date"
        aria-label="Jump to date"
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
          className,
        )}
      >
        <CalendarSearch className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
