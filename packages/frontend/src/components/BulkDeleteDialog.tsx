import { Trash2 } from 'lucide-react';

interface Props {
  count: number;
  noun?: string;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}

export default function BulkDeleteDialog({ count, noun = 'contact', onConfirm, onCancel, deleting }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border border-border rounded-lg shadow-xl p-6 w-full max-w-sm">
        <div className="flex items-start gap-3 mb-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10">
            <Trash2 className="h-4 w-4 text-destructive" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">
              Delete {count} {noun}{count !== 1 ? 's' : ''}?
            </h2>
            <p className="text-xs text-muted-foreground mt-1">This cannot be undone.</p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : `Delete ${count}`}
          </button>
        </div>
      </div>
    </div>
  );
}
