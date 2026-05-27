import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Edit2, Calendar, Tag, ArrowRightLeft } from 'lucide-react';
import type { Note, NoteJson, Calendar as CalendarType } from '@dave/shared';
import VJournalEditForm from './VJournalEditForm.js';

interface VJournalDetailProps {
  note: Note;
  mode: 'note' | 'journal';
  calendars: CalendarType[];
  saving: boolean;
  onSave: (uid: string, data: NoteJson, etag: string) => void;
  onDelete: (uid: string, etag: string) => void;
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
  onConvertToJournal,
  onConvertToNote,
}: VJournalDetailProps) {
  const [editing, setEditing] = useState(false);
  const [showConvertPicker, setShowConvertPicker] = useState(false);
  const [convertDate, setConvertDate] = useState(
    new Date().toISOString().substring(0, 10),
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { data } = note;

  if (editing) {
    return (
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
      />
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 shrink-0 border-b border-border">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h2 className="text-lg font-semibold text-foreground leading-tight flex-1 min-w-0">
            {data.summary || <span className="text-muted-foreground italic">Untitled</span>}
          </h2>
          <button
            onClick={() => setEditing(true)}
            title="Edit"
            className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Edit2 className="h-4 w-4" />
          </button>
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

        {/* Convert button */}
        <div className="mt-2">
          {mode === 'note' && onConvertToJournal && (
            <>
              {showConvertPicker ? (
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="date"
                    value={convertDate}
                    onChange={(e) => setConvertDate(e.target.value)}
                    className="text-xs rounded border border-input bg-background px-2 py-1 text-foreground outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    onClick={() => {
                      if (convertDate) {
                        onConvertToJournal(note.uid, data, note.etag, convertDate);
                        setShowConvertPicker(false);
                      }
                    }}
                    className="text-xs font-medium px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Convert
                  </button>
                  <button
                    onClick={() => setShowConvertPicker(false)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowConvertPicker(true)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowRightLeft className="h-3 w-3" />
                  Convert to Journal
                </button>
              )}
            </>
          )}

          {mode === 'journal' && onConvertToNote && (
            <button
              onClick={() => onConvertToNote(note.uid, data, note.etag)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowRightLeft className="h-3 w-3" />
              Convert to Note
            </button>
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

      {/* Delete confirm overlay */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm">
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
    </div>
  );
}
