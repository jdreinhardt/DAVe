import { useState } from 'react';
import type { NoteJson } from '@dave/shared';
import TagInput from './TagInput';

// ── Types ─────────────────────────────────────────────────────────────────────

export type NoteBulkEditFieldId = 'categories_add' | 'categories_remove';

export type NoteBulkEditConfig =
  | { field: 'categories'; op: 'add'; values: string[] }
  | { field: 'categories'; op: 'remove'; values: string[] };

export function applyNoteBulkEdit(data: NoteJson, config: NoteBulkEditConfig): NoteJson {
  const d = { ...data };
  if (config.field === 'categories') {
    if (config.op === 'add') {
      d.categories = [...new Set([...d.categories, ...config.values])];
    } else {
      d.categories = d.categories.filter((c) => !config.values.includes(c));
    }
  }
  return d;
}

// ── Field metadata ────────────────────────────────────────────────────────────

const FIELD_DEFS: Array<{ id: NoteBulkEditFieldId; label: string }> = [
  { id: 'categories_add', label: 'Add categories' },
  { id: 'categories_remove', label: 'Remove categories' },
];

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  count: number;
  initialField?: NoteBulkEditFieldId;
  onApply: (config: NoteBulkEditConfig) => void;
  onCancel: () => void;
  applying: boolean;
}

export default function NoteBulkEditModal({
  count,
  initialField,
  onApply,
  onCancel,
  applying,
}: Props) {
  const [fieldId, setFieldId] = useState<NoteBulkEditFieldId>(initialField ?? 'categories_add');
  const [addCategories, setAddCategories] = useState<string[]>([]);
  const [removeCategories, setRemoveCategories] = useState<string[]>([]);

  const buildConfig = (): NoteBulkEditConfig | null => {
    if (fieldId === 'categories_add') {
      if (addCategories.length === 0) return null;
      return { field: 'categories', op: 'add', values: addCategories };
    }
    if (fieldId === 'categories_remove') {
      if (removeCategories.length === 0) return null;
      return { field: 'categories', op: 'remove', values: removeCategories };
    }
    return null;
  };

  const config = buildConfig();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border border-border rounded-lg shadow-xl p-6 w-full max-w-sm">
        <h2 className="text-sm font-semibold">
          Edit {count} note{count !== 1 ? 's' : ''}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5 mb-4">
          Changes apply to all selected notes.
        </p>

        <div className="space-y-3">
          {/* Field selector */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Action</label>
            <select
              value={fieldId}
              onChange={(e) => setFieldId(e.target.value as NoteBulkEditFieldId)}
              className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {FIELD_DEFS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          {/* Value input per field */}
          {fieldId === 'categories_add' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Categories to add</label>
              <div className="mt-1">
                <TagInput value={addCategories} onChange={setAddCategories} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Press Enter or comma to add each category.
              </p>
            </div>
          )}

          {fieldId === 'categories_remove' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Categories to remove
              </label>
              <div className="mt-1">
                <TagInput value={removeCategories} onChange={setRemoveCategories} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Only categories present on a note are removed; others are unaffected.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={applying}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (config) onApply(config);
            }}
            disabled={applying || config === null}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {applying ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
