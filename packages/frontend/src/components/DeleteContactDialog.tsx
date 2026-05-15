import { AlertTriangle } from 'lucide-react';
import type { Contact } from '@dave/shared';

interface DeleteContactDialogProps {
  contact: Contact;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}

export default function DeleteContactDialog({
  contact,
  onConfirm,
  onCancel,
  deleting,
}: DeleteContactDialogProps) {
  const name =
    contact.data.fullName ||
    [contact.data.name.given, contact.data.name.family].filter(Boolean).join(' ') ||
    '(No name)';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-destructive/10 p-2 shrink-0">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Delete contact</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Are you sure you want to delete <strong>{name}</strong>? This cannot be undone.
            </p>
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="rounded-md border border-input bg-background px-4 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-md bg-destructive px-4 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
