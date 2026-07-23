import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowRightLeft, Bold, Code, Edit2, Eye, EyeOff, Italic, Link, List, Table } from 'lucide-react';
import type { Calendar, NoteJson, TaskRelation } from '@dave/shared';
import { cn } from '../lib/utils';

interface VJournalEditFormProps {
  initial: NoteJson;
  /** VJOURNAL-capable calendars to populate the collection selector. */
  calendars: Calendar[];
  mode: 'note' | 'journal';
  isNew: boolean;
  saving: boolean;
  onSave: (data: NoteJson) => void;
  onCancel: () => void;
  onDelete?: () => void;
  onConvertToJournal?: (dtstart: string) => void;
  onConvertToNote?: () => void;
}

export function emptyNoteJson(collectionUrl: string): NoteJson {
  return {
    uid: crypto.randomUUID(),
    summary: '',
    description: '',
    dtstart: null,
    lastModified: null,
    categories: [],
    relations: [] as TaskRelation[],
    collectionUrl,
  };
}

export function emptyJournalJson(collectionUrl: string, dtstart?: string): NoteJson {
  return {
    uid: crypto.randomUUID(),
    summary: '',
    description: '',
    dtstart: dtstart ?? new Date().toISOString().substring(0, 10),
    lastModified: null,
    categories: [],
    relations: [] as TaskRelation[],
    collectionUrl,
  };
}

function parseCategoryInput(raw: string): string[] {
  return raw
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}

export default function VJournalEditForm({
  initial,
  calendars,
  mode,
  isNew,
  saving,
  onSave,
  onCancel,
  onDelete,
  onConvertToJournal,
  onConvertToNote,
}: VJournalEditFormProps) {
  const [summary, setSummary] = useState(initial.summary);
  const [description, setDescription] = useState(initial.description);
  const [categoryStr, setCategoryStr] = useState(initial.categories.join(', '));
  const [collectionUrl, setCollectionUrl] = useState(initial.collectionUrl);
  const [dtstart, setDtstart] = useState<string>(
    initial.dtstart?.substring(0, 10) ?? new Date().toISOString().substring(0, 10),
  );
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit');
  const [showPreview, setShowPreview] = useState(false);
  const [showConvertPicker, setShowConvertPicker] = useState(false);
  const [convertDate, setConvertDate] = useState(new Date().toISOString().substring(0, 10));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Intentionally depend only on uid — changing uid means a new entry, not a mid-edit refresh.
  useEffect(() => {
    setSummary(initial.summary);
    setDescription(initial.description);
    setCategoryStr(initial.categories.join(', '));
    setCollectionUrl(initial.collectionUrl);
    setDtstart(initial.dtstart?.substring(0, 10) ?? new Date().toISOString().substring(0, 10));
    setShowPreview(false);
  }, [initial.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  function insertMarkdown(prefix: string, suffix = prefix, placeholder = 'text') {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = description.substring(start, end) || placeholder;
    const before = description.substring(0, start);
    const after = description.substring(end);
    const newText = `${before}${prefix}${selected}${suffix}${after}`;
    setDescription(newText);
    requestAnimationFrame(() => {
      ta.focus();
      const cursor = start + prefix.length + selected.length + suffix.length;
      ta.setSelectionRange(cursor, cursor);
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const data: NoteJson = {
      ...initial,
      uid: initial.uid || crypto.randomUUID(),
      summary: summary.trim(),
      description,
      dtstart: mode === 'journal' ? dtstart : null,
      categories: parseCategoryInput(categoryStr),
      relations: initial.relations,
      collectionUrl,
    };
    onSave(data);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full min-h-0">

      {/* ── Top header area ── */}
      <div className="px-4 pt-4 pb-3 border-b border-border shrink-0 space-y-2">
        {/* Title + action buttons */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Title"
            className="flex-1 min-w-0 text-lg font-semibold bg-transparent border-none outline-none placeholder:text-muted-foreground/50 text-foreground"
            autoFocus={isNew}
          />
          <div className="flex items-center gap-2 shrink-0">
            {onDelete && !isNew && (
              <button
                type="button"
                onClick={onDelete}
                className="text-sm text-destructive hover:text-destructive/80 transition-colors px-2 py-1 rounded-md hover:bg-destructive/10"
              >
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={onCancel}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-md hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !summary.trim()}
              className="text-sm font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
            </button>
          </div>
        </div>

        {/* Tags + collection + journal date */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-40">
            <label className="block text-xs font-medium text-muted-foreground mb-1">Tags</label>
            <input
              type="text"
              value={categoryStr}
              onChange={(e) => setCategoryStr(e.target.value)}
              placeholder="work, personal, …"
              className="w-full text-sm rounded-md border border-input bg-background px-2 py-1 text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {calendars.length > 1 && (
            <div className="flex-1 min-w-40">
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Collection
              </label>
              <select
                value={collectionUrl}
                onChange={(e) => setCollectionUrl(e.target.value)}
                className="w-full text-sm rounded-md border border-input bg-background px-2 py-1 text-foreground outline-none focus:ring-2 focus:ring-ring"
              >
                {calendars.map((cal) => (
                  <option key={cal.id} value={cal.url}>
                    {cal.displayName}
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode === 'journal' && (
            <div className="shrink-0">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Date</label>
              <input
                type="date"
                value={dtstart}
                onChange={(e) => setDtstart(e.target.value)}
                className="text-sm rounded-md border border-input bg-background px-2 py-1 text-foreground outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>
          )}
        </div>

        {/* Convert */}
        {mode === 'note' && onConvertToJournal && (
          <div className="mt-2">
            {showConvertPicker ? (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={convertDate}
                  onChange={(e) => setConvertDate(e.target.value)}
                  className="text-xs rounded border border-input bg-background px-2 py-1 text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => { if (convertDate) { onConvertToJournal(convertDate); setShowConvertPicker(false); } }}
                  className="text-xs font-medium px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Convert
                </button>
                <button
                  type="button"
                  onClick={() => setShowConvertPicker(false)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowConvertPicker(true)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowRightLeft className="h-3 w-3" />
                Convert to Journal
              </button>
            )}
          </div>
        )}

        {mode === 'journal' && onConvertToNote && (
          <div className="mt-2">
            <button
              type="button"
              onClick={onConvertToNote}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowRightLeft className="h-3 w-3" />
              Convert to Note
            </button>
          </div>
        )}
      </div>

      {/* ── Mobile: Edit / Preview tabs ── */}
      <div className="md:hidden flex border-b border-border shrink-0">
        <button
          type="button"
          onClick={() => setMobileTab('edit')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors',
            mobileTab === 'edit' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground',
          )}
        >
          <Edit2 className="h-3.5 w-3.5" /> Edit
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('preview')}
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors',
            mobileTab === 'preview' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground',
          )}
        >
          <Eye className="h-3.5 w-3.5" /> Preview
        </button>
      </div>

      {/* ── Editor area ── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Raw editor */}
        <div
          className={cn(
            'flex flex-col min-h-0',
            // Desktop: full width when preview hidden, half when shown
            showPreview ? 'md:w-1/2 md:border-r md:border-border' : 'md:flex-1',
            // Mobile: show/hide based on tab
            mobileTab === 'edit' ? 'flex flex-1' : 'hidden md:flex',
          )}
        >
          {/* Markdown toolbar with preview toggle on the right */}
          <div className="flex items-center border-b border-border bg-muted/30 shrink-0">
            <div className="flex items-center gap-0.5 px-1 py-1 flex-1">
              <ToolbarButton title="Bold" onClick={() => insertMarkdown('**', '**', 'bold text')}>
                <Bold className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton title="Italic" onClick={() => insertMarkdown('_', '_', 'italic text')}>
                <Italic className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton title="Inline code" onClick={() => insertMarkdown('`', '`', 'code')}>
                <Code className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton title="Link" onClick={() => insertMarkdown('[', '](url)', 'link text')}>
                <Link className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton title="List" onClick={() => insertMarkdown('\n- ', '', 'item')}>
                <List className="h-3.5 w-3.5" />
              </ToolbarButton>
              <ToolbarButton
                title="Table"
                onClick={() =>
                  insertMarkdown(
                    '\n| Column 1 | Column 2 |\n|---|---|\n| ',
                    ' | value |\n',
                    'value',
                  )
                }
              >
                <Table className="h-3.5 w-3.5" />
              </ToolbarButton>
            </div>

            {/* Preview toggle — desktop only */}
            <button
              type="button"
              title={showPreview ? 'Hide preview' : 'Show preview'}
              onClick={() => setShowPreview((p) => !p)}
              className={cn(
                'hidden md:flex items-center gap-1.5 px-2 py-1 mr-1 rounded text-xs transition-colors',
                showPreview
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted',
              )}
            >
              {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              Preview
            </button>
          </div>

          <textarea
            ref={textareaRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Write your note in markdown…"
            className="flex-1 resize-none bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-mono leading-relaxed"
          />
        </div>

        {/* Preview pane — desktop only when showPreview, mobile when tab=preview */}
        <div
          className={cn(
            'min-h-0 overflow-y-auto px-4 py-3',
            // Desktop: only visible when showPreview
            showPreview ? 'hidden md:flex md:flex-col md:flex-1' : 'hidden',
            // Mobile: full screen when tab=preview (overrides desktop hidden)
            mobileTab === 'preview' ? '!flex flex-col flex-1' : '',
          )}
        >
          {description ? (
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{description}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground/50 italic">Preview will appear here…</p>
          )}
        </div>
      </div>
    </form>
  );
}

function ToolbarButton({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      {children}
    </button>
  );
}
