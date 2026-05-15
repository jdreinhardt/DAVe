import { useState } from 'react';
import { X } from 'lucide-react';
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
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
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

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Sort by</legend>
              <div className="flex flex-col gap-1.5">
                <RadioOption
                  name="sortBy"
                  value="last"
                  checked={sortBy === 'last'}
                  onChange={() => setSortBy('last')}
                  label="Last name"
                />
                <RadioOption
                  name="sortBy"
                  value="first"
                  checked={sortBy === 'first'}
                  onChange={() => setSortBy('first')}
                  label="First name"
                />
              </div>
            </fieldset>

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Sort direction</legend>
              <div className="flex flex-col gap-1.5">
                <RadioOption
                  name="sortDir"
                  value="asc"
                  checked={sortDir === 'asc'}
                  onChange={() => setSortDir('asc')}
                  label="Ascending (A → Z)"
                />
                <RadioOption
                  name="sortDir"
                  value="desc"
                  checked={sortDir === 'desc'}
                  onChange={() => setSortDir('desc')}
                  label="Descending (Z → A)"
                />
              </div>
            </fieldset>
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
              isDirty
                ? 'bg-primary hover:bg-primary/90'
                : 'bg-primary/40 cursor-not-allowed',
            )}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function RadioOption({
  name,
  value,
  checked,
  onChange,
  label,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="accent-primary h-3.5 w-3.5"
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}
