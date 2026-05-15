import { useState } from 'react';
import { X, ArrowUpAZ, ArrowDownAZ } from 'lucide-react';
import { cn } from '../lib/utils';
import { useSettings } from '../contexts/Settings';
import type { SortBy, SortDir } from '../contexts/Settings';

interface SettingsModalProps {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const { contactSort, updateContactSort } = useSettings();
  const [sortBy, setSortBy] = useState<SortBy>(contactSort.sortBy);
  const [sortDir, setSortDir] = useState<SortDir>(contactSort.sortDir);

  const handleSave = () => {
    updateContactSort({ sortBy, sortDir });
    onClose();
  };

  const isDirty = sortBy !== contactSort.sortBy || sortDir !== contactSort.sortDir;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-lg border border-border bg-card shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4 space-y-5">
          {/* Contact sort */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Contacts
            </h3>

            <div className="flex items-center gap-2">
              <label htmlFor="contact-sort-by" className="text-sm font-medium shrink-0">
                Sort order
              </label>
              <select
                id="contact-sort-by"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="last">Last name</option>
                <option value="first">First name</option>
              </select>
              <button
                onClick={() => setSortDir('asc')}
                title="Ascending (A → Z)"
                aria-label="Sort ascending"
                className={cn(
                  'rounded-md border p-1.5 transition-colors',
                  sortDir === 'asc'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <ArrowDownAZ className="h-4 w-4" />
              </button>
              <button
                onClick={() => setSortDir('desc')}
                title="Descending (Z → A)"
                aria-label="Sort descending"
                className={cn(
                  'rounded-md border p-1.5 transition-colors',
                  sortDir === 'desc'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <ArrowUpAZ className="h-4 w-4" />
              </button>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!isDirty}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm text-primary-foreground transition-colors',
              isDirty ? 'bg-primary hover:bg-primary/90' : 'bg-primary/40 cursor-not-allowed',
            )}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
