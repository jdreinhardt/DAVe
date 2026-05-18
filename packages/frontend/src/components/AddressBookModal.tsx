import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';
import { createAddressBook, updateAddressBook, deleteAddressBook } from '../api/collections';
import type { AddressBook } from '@dave/shared';

interface Props {
  mode: 'create' | 'edit';
  addressBook?: AddressBook;
  onClose: () => void;
}

type View = 'form' | 'confirm-delete';

export default function AddressBookModal({ mode, addressBook, onClose }: Props) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>('form');
  const [displayName, setDisplayName] = useState(addressBook?.displayName ?? '');
  const [description, setDescription] = useState(addressBook?.description ?? '');
  const [error, setError] = useState('');

  const saveMutation = useMutation({
    mutationFn: () =>
      mode === 'create'
        ? createAddressBook({ displayName, description: description || undefined })
        : updateAddressBook(addressBook!.id, { displayName, description: description || undefined }),
    onSuccess: (updatedBooks) => {
      queryClient.setQueryData(['addressbooks'], updatedBooks);
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAddressBook(addressBook!.id),
    onSuccess: () => {
      queryClient.setQueryData(
        ['addressbooks'],
        (old: AddressBook[] | undefined) => (old ?? []).filter((b) => b.id !== addressBook!.id),
      );
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const canSave = displayName.trim().length > 0 && !saveMutation.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget && view === 'form') onClose(); }}
    >
      <div className="w-full max-w-sm rounded-lg border border-border bg-card shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">
            {view === 'confirm-delete'
              ? 'Delete address book'
              : mode === 'create'
                ? 'New address book'
                : 'Edit address book'}
          </h2>
          {view === 'form' && (
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {view === 'form' ? (
          <>
            {/* Form body */}
            <div className="px-4 py-4 space-y-4">
              {error && (
                <p className="text-xs text-destructive">{error}</p>
              )}
              <div className="space-y-1.5">
                <label htmlFor="ab-name" className="text-sm font-medium">Name</label>
                <input
                  id="ab-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="My contacts"
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="ab-desc" className="text-sm font-medium">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
                <textarea
                  id="ab-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A brief description"
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>
            </div>

            {/* Footer */}
            <div className={cn('flex border-t border-border px-4 py-3', mode === 'edit' ? 'justify-between' : 'justify-end gap-2')}>
              {mode === 'edit' && (
                <button
                  onClick={() => { setError(''); setView('confirm-delete'); }}
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
                  Permanently delete <span className="font-semibold">{addressBook!.displayName}</span>?
                  This will delete all contacts in this address book and cannot be undone.
                </p>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <button
                onClick={() => { setError(''); setView('form'); }}
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
