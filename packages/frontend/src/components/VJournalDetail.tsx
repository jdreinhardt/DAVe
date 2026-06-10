import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Edit2, Calendar, Tag, Trash2, X } from 'lucide-react';
import type { Note, NoteJson, Calendar as CalendarType } from '@dave/shared';
import VJournalEditForm from './VJournalEditForm.js';

interface VJournalDetailProps {
  note: Note;
  mode: 'note' | 'journal';
  calendars: CalendarType[];
  saving: boolean;
  onSave: (uid: string, data: NoteJson, etag: string) => void;
  onDelete: (uid: string, etag: string) => void;
  onClose?: () => void;
  /** Fired when the user confirms "Convert to Journal" — passes the chosen date. */
  onConvertToJournal?: (uid: string, data: NoteJson, etag: string, dtstart: string) => void;
  /** Fired when the user confirms "Convert to Note". */
  onConvertToNote?: (uid: string, data: NoteJson, etag: string) => void;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function VJournalDetail({
  note,
  mode,
  calendars,
  saving,
  onSave,
  onDelete,
  onClose,
  onConvertToJournal,
  onConvertToNote,
}: VJournalDetailProps) {
  const [editing, setEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { data } = note;

  return (
    <>
      {/* Delete confirm — renders in both edit and view modes */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-lg shadow-lg p-5 mx-4 max-w-sm w-full">
            <p className="text-sm font-medium text-foreground mb-1">Delete this {mode}?</p>
            <p className="text-xs text-muted-foreground mb-4">This action cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="text-sm px-3 py-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onDelete(note.uid, note.etag);
                  setShowDeleteConfirm(false);
                }}
                className="text-sm font-medium px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {editing ? (
        <VJournalEditForm
          initial={data}
          calendars={calendars}
          mode={mode}
          isNew={false}
          saving={saving}
          onSave={(updated) => {
            onSave(note.uid, updated, note.etag);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          onDelete={() => setShowDeleteConfirm(true)}
          onConvertToJournal={onConvertToJournal ? (dtstart) => { onConvertToJournal(note.uid, data, note.etag, dtstart); setEditing(false); } : undefined}
          onConvertToNote={onConvertToNote ? () => { onConvertToNote(note.uid, data, note.etag); setEditing(false); } : undefined}
        />
      ) : (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto">
      {/* Header */}
      <div className="px-4 pt-3 pb-3 shrink-0 border-b border-border">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold text-foreground leading-tight flex-1 min-w-0 truncate">
            {data.summary || <span className="text-muted-foreground italic">Untitled</span>}
          </h2>
          <button
            onClick={() => setEditing(true)}
            title="Edit"
            className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Edit2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            title="Delete"
            className="shrink-0 p-1.5 rounded-md text-destructive/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              title="Close"
              className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {/* Journal date */}
          {mode === 'journal' && data.dtstart && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDate(data.dtstart)}
            </span>
          )}

          {/* Last modified */}
          {data.lastModified && (
            <span>Modified {formatDate(data.lastModified)}</span>
          )}

          {/* Categories */}
          {data.categories.length > 0 && (
            <span className="flex items-center gap-1">
              <Tag className="h-3 w-3" />
              {data.categories.join(', ')}
            </span>
          )}
        </div>

      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {data.description ? (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.description}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/50 italic">No content.</p>
        )}
      </div>

    </div>
      )}
    </>
  );
}
