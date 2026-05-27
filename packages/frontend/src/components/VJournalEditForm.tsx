import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bold, Italic, Link, Code, List, Table, Eye, Edit2 } from 'lucide-react';
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
}: VJournalEditFormProps) {
  const [summary, setSummary] = useState(initial.summary);
  const [description, setDescription] = useState(initial.description);
  const [categoryStr, setCategoryStr] = useState(initial.categories.join(', '));
  const [collectionUrl, setCollectionUrl] = useState(initial.collectionUrl);
  const [dtstart, setDtstart] = useState<string>(
    initial.dtstart?.substring(0, 10) ?? new Date().toISOString().substring(0, 10),
  );
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Intentionally depend only on uid — changing uid means a new entry, not a mid-edit refresh.
  useEffect(() => {
    setSummary(initial.summary);
    setDescription(initial.description);
    setCategoryStr(initial.categories.join(', '));
    setCollectionUrl(initial.collectionUrl);
    setDtstart(initial.dtstart?.substring(0, 10) ?? new Date().toISOString().substring(0, 10));
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

  const markdownToolbar = (
    <div className="flex items-center gap-0.5 px-1 py-1 border-b border-border bg-muted/30">
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
  );

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full min-h-0">
      {/* Title row */}
      <div className="px-4 pt-4 pb-2 shrink-0">
        <input
          type="text"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Title"
          className="w-full text-lg font-semibold bg-transparent border-none outline-none placeholder:text-muted-foreground/50 text-foreground"
          autoFocus={isNew}
        />
      </div>

      {/* Journal date picker — only in journal mode */}
      {mode === 'journal' && (
        <div className="px-4 pb-2 shrink-0">
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

      {/* Mobile: Edit / Preview tabs */}
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

      {/* Editor area — split-pane on desktop, single pane on mobile */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Raw editor — full width on mobile (when tab=edit), left half on desktop */}
        <div
          className={cn(
            'flex flex-col border-r border-border min-h-0',
            'md:flex md:w-1/2',
            mobileTab === 'edit' ? 'flex w-full' : 'hidden',
          )}
        >
          {markdownToolbar}
          <textarea
            ref={textareaRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Write your note in markdown…"
            className="flex-1 resize-none bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-mono leading-relaxed"
          />
        </div>

        {/* Preview — full width on mobile (when tab=preview), right half on desktop */}
        <div
          className={cn(
            'min-h-0 overflow-y-auto px-4 py-3',
            'md:flex md:flex-col md:w-1/2',
            mobileTab === 'preview' ? 'flex flex-col w-full' : 'hidden',
          )}
        >
          {description ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{description}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground/50 italic">Preview will appear here…</p>
          )}
        </div>
      </div>

      {/* Metadata row — categories + collection */}
      <div className="px-4 py-3 border-t border-border shrink-0 space-y-2">
        <div className="flex flex-wrap items-center gap-3">
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
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-between px-4 pb-4 pt-1 shrink-0">
        <div className="flex items-center gap-2">
          {onDelete && !isNew && (
            <button
              type="button"
              onClick={onDelete}
              className="text-sm text-destructive hover:text-destructive/80 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
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
