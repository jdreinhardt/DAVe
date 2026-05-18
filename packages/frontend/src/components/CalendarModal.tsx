import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, AlertTriangle, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { createCalendar, updateCalendar, deleteCalendar } from '../api/collections';
import type { Calendar } from '@dave/shared';

interface Props {
  mode: 'create' | 'edit';
  calendar?: Calendar;
  onClose: () => void;
}

type View = 'form' | 'confirm-delete';

const PRESET_COLORS = [
  '#0082C9',
  '#3498DB',
  '#1ABC9C',
  '#2ECC71',
  '#F1C40F',
  '#E67E22',
  '#E74C3C',
  '#E91E63',
  '#9B59B6',
  '#795548',
  '#607D8B',
  '#34495E',
];

const DEFAULT_COLOR = '#0082C9';

export default function CalendarModal({ mode, calendar, onClose }: Props) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>('form');
  const [displayName, setDisplayName] = useState(calendar?.displayName ?? '');
  const [description, setDescription] = useState(calendar?.description ?? '');
  const [color, setColor] = useState(
    // Normalize stored color: strip alpha suffix if present (#RRGGBBAA → #RRGGBB)
    (calendar?.color ?? DEFAULT_COLOR).slice(0, 7),
  );
  const [withTodo, setWithTodo] = useState(calendar?.components.includes('VTODO') ?? false);
  const [withJournal, setWithJournal] = useState(
    calendar?.components.includes('VJOURNAL') ?? false,
  );
  const [error, setError] = useState('');

  const saveMutation = useMutation({
    mutationFn: () => {
      if (mode === 'create') {
        const components = [
          'VEVENT',
          ...(withTodo ? ['VTODO'] : []),
          ...(withJournal ? ['VJOURNAL'] : []),
        ];
        return createCalendar({
          displayName,
          description: description || undefined,
          color,
          components,
        });
      }
      return updateCalendar(calendar!.id, {
        displayName,
        description: description || undefined,
        color,
      });
    },
    onSuccess: (updatedCalendars) => {
      queryClient.setQueryData(['calendars'], updatedCalendars);
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteCalendar(calendar!.id),
    onSuccess: () => {
      queryClient.setQueryData(['calendars'], (old: Calendar[] | undefined) =>
        (old ?? []).filter((c) => c.id !== calendar!.id),
      );
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const canSave = displayName.trim().length > 0 && !saveMutation.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget && view === 'form') onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-lg border border-border bg-card shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">
            {view === 'confirm-delete'
              ? 'Delete calendar'
              : mode === 'create'
                ? 'New calendar'
                : 'Edit calendar'}
          </h2>
          {view === 'form' && (
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {view === 'form' ? (
          <>
            {/* Form body */}
            <div className="px-4 py-4 space-y-4">
              {error && <p className="text-xs text-destructive">{error}</p>}

              <div className="space-y-1.5">
                <label htmlFor="cal-name" className="text-sm font-medium">
                  Name
                </label>
                <input
                  id="cal-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="My calendar"
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="cal-desc" className="text-sm font-medium">
                  Description <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <textarea
                  id="cal-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A brief description"
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>

              {/* Color picker */}
              <div className="space-y-2">
                <span className="text-sm font-medium">Color</span>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className="w-6 h-6 rounded-full flex items-center justify-center transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                      style={{ backgroundColor: c }}
                      title={c}
                    >
                      {color === c && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                    </button>
                  ))}
                  {/* Custom color input */}
                  <label
                    className="w-6 h-6 rounded-full border-2 border-dashed border-muted-foreground/50 flex items-center justify-center cursor-pointer hover:border-foreground transition-colors overflow-hidden"
                    title="Custom color"
                    style={
                      !PRESET_COLORS.includes(color)
                        ? { backgroundColor: color, borderStyle: 'solid', borderColor: color }
                        : {}
                    }
                  >
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="opacity-0 absolute w-0 h-0"
                    />
                    {!PRESET_COLORS.includes(color) && (
                      <Check className="w-3 h-3 text-white" strokeWidth={3} />
                    )}
                  </label>
                </div>
              </div>

              {/* Component toggles — editable only on create */}
              <div className="space-y-2">
                <span
                  className={cn('text-sm font-medium', mode === 'edit' && 'text-muted-foreground')}
                >
                  Enable
                  {mode === 'edit' && (
                    <span className="font-normal text-xs ml-1">(set at creation)</span>
                  )}
                </span>
                <div className="space-y-1.5">
                  <label
                    className={cn(
                      'flex items-center gap-2 text-sm',
                      mode === 'edit' && 'text-muted-foreground',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={
                        mode === 'edit'
                          ? (calendar?.components.includes('VTODO') ?? false)
                          : withTodo
                      }
                      onChange={(e) => mode === 'create' && setWithTodo(e.target.checked)}
                      disabled={mode === 'edit'}
                      className="rounded border-input"
                    />
                    Tasks
                  </label>
                  <label
                    className={cn(
                      'flex items-center gap-2 text-sm',
                      mode === 'edit' && 'text-muted-foreground',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={
                        mode === 'edit'
                          ? (calendar?.components.includes('VJOURNAL') ?? false)
                          : withJournal
                      }
                      onChange={(e) => mode === 'create' && setWithJournal(e.target.checked)}
                      disabled={mode === 'edit'}
                      className="rounded border-input"
                    />
                    Notes
                  </label>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div
              className={cn(
                'flex border-t border-border px-4 py-3',
                mode === 'edit' ? 'justify-between' : 'justify-end gap-2',
              )}
            >
              {mode === 'edit' && (
                <button
                  onClick={() => {
                    setError('');
                    setView('confirm-delete');
                  }}
                  className="rounded-md px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                >
                  Delete…
                </button>
              )}
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={() => saveMutation.mutate()}
                  disabled={!canSave}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm text-primary-foreground transition-colors',
                    canSave ? 'bg-primary hover:bg-primary/90' : 'bg-primary/40 cursor-not-allowed',
                  )}
                >
                  {saveMutation.isPending ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Confirm-delete body */}
            <div className="px-4 py-5 space-y-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm">
                  Permanently delete <span className="font-semibold">{calendar!.displayName}</span>?
                  This will delete all events in this calendar and cannot be undone.
                </p>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <button
                onClick={() => {
                  setError('');
                  setView('form');
                }}
                disabled={deleteMutation.isPending}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Yes, delete'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
