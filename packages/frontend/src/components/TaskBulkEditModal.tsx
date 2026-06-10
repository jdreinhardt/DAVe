import { useState } from 'react';
import type { TaskJson } from '@dave/shared';
import { cn } from '../lib/utils';
import TagInput from './TagInput';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TaskBulkEditFieldId = 'status' | 'priority' | 'categories_add' | 'categories_remove';

export type TaskBulkEditConfig =
  | { field: 'status'; op: 'set'; value: string }
  | { field: 'priority'; op: 'set'; value: number }
  | { field: 'priority'; op: 'clear' }
  | { field: 'categories'; op: 'add'; values: string[] }
  | { field: 'categories'; op: 'remove'; values: string[] };

export function applyTaskBulkEdit(data: TaskJson, config: TaskBulkEditConfig): TaskJson {
  const d = { ...data };
  if (config.field === 'status') {
    if (config.value === 'COMPLETED') {
      d.status = 'COMPLETED';
      d.percentComplete = 100;
      if (!d.completed) d.completed = new Date().toISOString();
    } else if (config.value === 'CANCELLED') {
      d.status = 'CANCELLED';
      d.completed = null;
    } else {
      d.status = config.value;
      if (d.percentComplete === 100) d.percentComplete = 0;
      d.completed = null;
    }
  } else if (config.field === 'priority') {
    d.priority = config.op === 'clear' ? null : config.value;
  } else if (config.field === 'categories') {
    if (config.op === 'add') {
      d.categories = [...new Set([...d.categories, ...config.values])];
    } else {
      d.categories = d.categories.filter((c) => !config.values.includes(c));
    }
  }
  return d;
}

// ── Field metadata ────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'NEEDS-ACTION', label: 'Needs Action' },
  { value: 'IN-PROCESS',   label: 'In Progress' },
  { value: 'COMPLETED',    label: 'Completed' },
  { value: 'CANCELLED',    label: 'Cancelled' },
];

const PRIORITY_OPTIONS: Array<{ value: number | 'clear'; label: string }> = [
  { value: 1,       label: 'High' },
  { value: 4,       label: 'Medium' },
  { value: 7,       label: 'Low' },
  { value: 'clear', label: 'None' },
];

const FIELD_DEFS: Array<{ id: TaskBulkEditFieldId; label: string }> = [
  { id: 'status',            label: 'Set status' },
  { id: 'priority',          label: 'Set priority' },
  { id: 'categories_add',    label: 'Add categories' },
  { id: 'categories_remove', label: 'Remove categories' },
];

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  count: number;
  initialField?: TaskBulkEditFieldId;
  onApply: (config: TaskBulkEditConfig) => void;
  onCancel: () => void;
  applying: boolean;
}

export default function TaskBulkEditModal({ count, initialField, onApply, onCancel, applying }: Props) {
  const [fieldId, setFieldId]         = useState<TaskBulkEditFieldId>(initialField ?? 'status');
  const [statusValue, setStatusValue] = useState('NEEDS-ACTION');
  const [priorityValue, setPriorityValue] = useState<number | 'clear'>(1);
  const [addCategories, setAddCategories]       = useState<string[]>([]);
  const [removeCategories, setRemoveCategories] = useState<string[]>([]);

  const buildConfig = (): TaskBulkEditConfig | null => {
    if (fieldId === 'status') return { field: 'status', op: 'set', value: statusValue };
    if (fieldId === 'priority') {
      if (priorityValue === 'clear') return { field: 'priority', op: 'clear' };
      return { field: 'priority', op: 'set', value: priorityValue };
    }
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
          Edit {count} task{count !== 1 ? 's' : ''}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5 mb-4">
          Changes apply to all selected tasks.
        </p>

        <div className="space-y-3">
          {/* Field selector */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Action</label>
            <select
              value={fieldId}
              onChange={(e) => setFieldId(e.target.value as TaskBulkEditFieldId)}
              className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {FIELD_DEFS.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          </div>

          {/* Value input per field */}
          {fieldId === 'status' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <select
                value={statusValue}
                onChange={(e) => setStatusValue(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          )}

          {fieldId === 'priority' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Priority</label>
              <div className="mt-1 flex gap-1.5">
                {PRIORITY_OPTIONS.map((p) => (
                  <button
                    key={String(p.value)}
                    type="button"
                    onClick={() => setPriorityValue(p.value)}
                    className={cn(
                      'flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors',
                      priorityValue === p.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-input bg-background hover:bg-muted text-foreground',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {fieldId === 'categories_add' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Categories to add</label>
              <div className="mt-1">
                <TagInput value={addCategories} onChange={setAddCategories} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Press Enter or comma to add each category.</p>
            </div>
          )}

          {fieldId === 'categories_remove' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Categories to remove</label>
              <div className="mt-1">
                <TagInput value={removeCategories} onChange={setRemoveCategories} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Only categories present on a task are removed; others are unaffected.</p>
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
            onClick={() => { if (config) onApply(config); }}
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
