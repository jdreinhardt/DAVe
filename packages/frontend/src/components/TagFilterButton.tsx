import { useState } from 'react';
import { Tag } from 'lucide-react';
import { cn } from '../lib/utils';

/** Sentinel value representing "entries with no tags at all". */
export const NONE_TAG = '__none__';

interface TagFilterButtonProps {
  allTags: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

export default function TagFilterButton({ allTags, selected, onChange }: TagFilterButtonProps) {
  const [open, setOpen] = useState(false);
  const allOptions = [NONE_TAG, ...allTags];

  function toggle(tag: string) {
    if (selected.includes(tag)) {
      onChange(selected.filter((t) => t !== tag));
    } else {
      onChange([...selected, tag]);
    }
  }

  if (allTags.length === 0 && selected.length === 0) return null;

  return (
    <div className="relative shrink-0">
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
      <button
        onClick={() => setOpen((o) => !o)}
        title="Filter by tag"
        className={cn(
          'flex items-center gap-1.5 text-sm rounded-md border px-2 py-1.5 transition-colors',
          selected.length > 0
            ? 'border-primary/50 bg-primary/10 text-primary hover:bg-primary/15'
            : 'border-input bg-background text-muted-foreground hover:bg-muted',
        )}
      >
        <Tag className="h-3.5 w-3.5" />
        {selected.length > 0 && (
          <span className="text-xs font-medium tabular-nums">{selected.length}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-background border border-border rounded-lg shadow-lg min-w-[190px] max-h-72 overflow-y-auto">
          {/* All / None quick-select */}
          <div className="flex items-center border-b border-border">
            <button
              onClick={() => onChange(allOptions)}
              className="flex-1 text-xs py-1.5 text-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              All
            </button>
            <div className="w-px h-4 bg-border shrink-0" />
            <button
              onClick={() => onChange([])}
              className="flex-1 text-xs py-1.5 text-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              None
            </button>
          </div>

          {/* (No tags) special option */}
          <label className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-muted cursor-pointer border-b border-border">
            <input
              type="checkbox"
              checked={selected.includes(NONE_TAG)}
              onChange={() => toggle(NONE_TAG)}
              className="h-3.5 w-3.5 rounded border-input accent-primary shrink-0"
            />
            <span className="text-sm text-muted-foreground italic">(No tags)</span>
          </label>

          {/* Regular tags */}
          {allTags.map((tag) => (
            <label
              key={tag}
              className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-muted cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.includes(tag)}
                onChange={() => toggle(tag)}
                className="h-3.5 w-3.5 rounded border-input accent-primary shrink-0"
              />
              <span className="text-sm text-foreground truncate">{tag}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
