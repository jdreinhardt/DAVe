import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  List,
  LayoutGrid,
  Columns3,
  Search,
  X,
  ArrowUpDown,
} from 'lucide-react';
import type { Task, TasksQueryParams } from '@dave/shared';
import { fetchTasks, triggerTasksSync } from '../api/tasks';
import { getCalendars } from '../api/collections';
import { useCollectionVisibility } from '../contexts/CollectionVisibility';
import { useIsMobile } from '../hooks/useIsMobile';
import { cn } from '../lib/utils';

// ── localStorage helpers ──────────────────────────────────────────────────────

function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function savePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

// ── Priority helpers ──────────────────────────────────────────────────────────

function priorityLabel(p: number | null): string {
  if (p === null) return '';
  if (p <= 3) return 'High';
  if (p <= 6) return 'Medium';
  return 'Low';
}

function priorityColor(p: number | null): string {
  if (p === null) return '';
  if (p <= 3) return 'bg-destructive';
  if (p <= 6) return 'bg-amber-500';
  return 'bg-muted-foreground/40';
}

// ── Due date helpers ──────────────────────────────────────────────────────────

function dueDateDisplay(due: string | null): { label: string; className: string } | null {
  if (!due) return null;
  const d = new Date(due);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86_400_000);
  if (d < todayStart) return { label: d.toLocaleDateString(), className: 'text-destructive' };
  if (d < todayEnd) return { label: 'Today', className: 'text-amber-500 font-medium' };
  return { label: d.toLocaleDateString(), className: 'text-muted-foreground' };
}

// ── Task tree building ────────────────────────────────────────────────────────

function buildTree(tasks: Task[]): { roots: Task[]; childrenOf: Map<string, Task[]> } {
  const taskByUid = new Map(tasks.map((t) => [t.uid, t]));
  const isChild = new Set<string>();
  const childrenOf = new Map<string, Task[]>();

  for (const task of tasks) {
    for (const rel of task.data.relations) {
      if (rel.reltype === 'PARENT' && taskByUid.has(rel.relatedUid)) {
        isChild.add(task.uid);
        const arr = childrenOf.get(rel.relatedUid) ?? [];
        arr.push(task);
        childrenOf.set(rel.relatedUid, arr);
      }
    }
  }

  const roots = tasks.filter((t) => !isChild.has(t.uid));
  return { roots, childrenOf };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_CHIP_LIMIT = 3;

const STATUS_LABELS: Record<string, string> = {
  'NEEDS-ACTION': 'To do',
  'IN-PROCESS': 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function CategoryChips({ categories }: { categories: string[] }) {
  if (categories.length === 0) return null;
  const shown = categories.slice(0, CATEGORY_CHIP_LIMIT);
  const extra = categories.length - CATEGORY_CHIP_LIMIT;
  return (
    <span className="flex items-center gap-1 flex-wrap">
      {shown.map((cat) => (
        <span key={cat} className="px-1.5 py-0.5 rounded text-xs bg-muted text-muted-foreground">
          {cat}
        </span>
      ))}
      {extra > 0 && <span className="text-xs text-muted-foreground">+{extra} more</span>}
    </span>
  );
}

function TaskRow({
  task,
  compact,
  depth,
  childrenOf,
  selectedUid,
  onSelect,
  calendarName,
  calendarColor,
}: {
  task: Task;
  compact: boolean;
  depth: number;
  childrenOf: Map<string, Task[]>;
  selectedUid: string | null;
  onSelect: (uid: string) => void;
  calendarName?: string;
  calendarColor?: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const children = childrenOf.get(task.uid) ?? [];
  const hasChildren = children.length > 0;
  const collapseDeep = depth >= 3 && hasChildren;
  const [deepExpanded, setDeepExpanded] = useState(false);
  const isSelected = selectedUid === task.uid;
  const due = dueDateDisplay(task.data.due);

  return (
    <>
      <div
        className={cn(
          'group flex items-start gap-2 px-3 rounded-md cursor-pointer transition-colors mx-1 my-0.5',
          compact ? 'py-1.5' : 'py-3',
          isSelected ? 'bg-primary/10' : 'hover:bg-muted',
        )}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
        onClick={() => onSelect(task.uid)}
      >
        {/* Expand/collapse toggle for subtasks */}
        {hasChildren && !collapseDeep ? (
          <button
            className="shrink-0 mt-0.5 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            aria-label={expanded ? 'Collapse subtasks' : 'Expand subtasks'}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="shrink-0 w-3.5" />
        )}

        {/* Disabled status checkbox */}
        <button
          disabled
          aria-label="Toggle complete (not available yet)"
          className={cn(
            'shrink-0 mt-0.5 w-4 h-4 rounded-full border-2 cursor-not-allowed opacity-50 transition-colors',
            task.data.status === 'COMPLETED'
              ? 'bg-primary border-primary'
              : task.data.status === 'CANCELLED'
                ? 'border-muted-foreground bg-muted'
                : 'border-muted-foreground',
          )}
          onClick={(e) => e.stopPropagation()}
        />

        {/* Priority indicator */}
        {task.data.priority !== null && (
          <span
            className={cn(
              'shrink-0 w-1 rounded-full mt-1',
              compact ? 'h-3' : 'h-5',
              priorityColor(task.data.priority),
            )}
            title={`${priorityLabel(task.data.priority)} priority`}
          />
        )}

        {/* Main content — left column grows, right column is fixed-width meta */}
        <div className="flex-1 min-w-0 flex gap-3">
          {/* Left: title → categories → description */}
          <div className="flex-1 min-w-0">
            <span
              className={cn(
                'text-sm',
                (task.data.status === 'COMPLETED' || task.data.status === 'CANCELLED') &&
                  'line-through text-muted-foreground',
              )}
            >
              {task.data.summary || '(no title)'}
            </span>

            {/* Calendar / categories — list only, below title */}
            {!compact && (calendarName || task.data.categories.length > 0) && (
              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                {calendarName && (
                  <span
                    className="px-1.5 py-0.5 rounded text-xs shrink-0 font-medium"
                    style={
                      calendarColor
                        ? { backgroundColor: calendarColor + '33', color: calendarColor }
                        : {
                            backgroundColor: 'hsl(var(--muted))',
                            color: 'hsl(var(--muted-foreground))',
                          }
                    }
                  >
                    {calendarName}
                  </span>
                )}
                {calendarName && task.data.categories.length > 0 && (
                  <span className="text-xs text-muted-foreground/50 shrink-0">|</span>
                )}
                <CategoryChips categories={task.data.categories} />
              </div>
            )}

            {/* Description preview — list only, below categories */}
            {!compact && task.data.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                {task.data.description}
              </p>
            )}
          </div>

          {/* Right: due date (top) + status (below) — both views show due date right-aligned */}
          <div className="shrink-0 flex flex-col items-end gap-0.5">
            {due && (
              <span className={cn('text-xs whitespace-nowrap', due.className)}>{due.label}</span>
            )}
            {!compact && task.data.status === 'IN-PROCESS' && (
              <span className="text-xs text-amber-600 dark:text-amber-400 whitespace-nowrap">
                In progress
              </span>
            )}
            {!compact && task.data.status === 'CANCELLED' && (
              <span className="text-xs text-muted-foreground whitespace-nowrap">Cancelled</span>
            )}
          </div>
        </div>
      </div>

      {/* Subtasks */}
      {hasChildren &&
        !collapseDeep &&
        expanded &&
        children.map((child) => (
          <TaskRow
            key={child.uid}
            task={child}
            compact={compact}
            depth={depth + 1}
            childrenOf={childrenOf}
            selectedUid={selectedUid}
            onSelect={onSelect}
            calendarName={calendarName}
            calendarColor={calendarColor}
          />
        ))}

      {/* Deep subtask expander (depth >= 3) */}
      {collapseDeep && (
        <div style={{ paddingLeft: `${12 + (depth + 1) * 20}px` }} className="py-0.5">
          <button
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setDeepExpanded((v) => !v);
            }}
          >
            {deepExpanded ? '…hide' : `…${children.length} more`}
          </button>
          {deepExpanded &&
            children.map((child) => (
              <TaskRow
                key={child.uid}
                task={child}
                compact={compact}
                depth={depth + 1}
                childrenOf={childrenOf}
                selectedUid={selectedUid}
                onSelect={onSelect}
                calendarName={calendarName}
                calendarColor={calendarColor}
              />
            ))}
        </div>
      )}
    </>
  );
}

function KanbanColumn({
  title,
  tasks,
  selectedUid,
  onSelect,
  color,
}: {
  title: string;
  tasks: Task[];
  selectedUid: string | null;
  onSelect: (uid: string) => void;
  color: string;
}) {
  return (
    <div className="flex flex-col min-w-56 w-64 shrink-0 rounded-lg border border-border bg-muted/30">
      <div
        className={cn('px-3 py-2 rounded-t-lg font-medium text-sm flex items-center gap-2', color)}
      >
        {title}
        <span className="ml-auto text-xs font-normal opacity-70">{tasks.length}</span>
      </div>
      <div className="flex flex-col gap-1 p-2 overflow-y-auto flex-1">
        {tasks.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No tasks</p>
        )}
        {tasks.map((task) => {
          const due = dueDateDisplay(task.data.due);
          return (
            <div
              key={task.uid}
              onClick={() => onSelect(task.uid)}
              className={cn(
                'rounded-md border bg-card p-2.5 cursor-pointer hover:border-primary/50 transition-colors text-sm',
                selectedUid === task.uid && 'border-primary bg-primary/5',
              )}
            >
              <p className="font-medium leading-snug mb-1 line-clamp-2">
                {task.data.summary || '(no title)'}
              </p>
              {task.data.priority !== null && (
                <span
                  className={cn(
                    'inline-block w-2 h-2 rounded-full mr-1.5',
                    priorityColor(task.data.priority),
                  )}
                />
              )}
              {due && <span className={cn('text-xs', due.className)}>{due.label}</span>}
              {task.data.categories.length > 0 && (
                <CategoryChips categories={task.data.categories} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskDetailPanel({
  task,
  onClose,
  fullscreen = false,
}: {
  task: Task;
  onClose: () => void;
  fullscreen?: boolean;
}) {
  const due = dueDateDisplay(task.data.due);
  const rows: { label: string; value: React.ReactNode }[] = [];

  if (task.data.status)
    rows.push({ label: 'Status', value: STATUS_LABELS[task.data.status] ?? task.data.status });
  if (task.data.priority !== null)
    rows.push({
      label: 'Priority',
      value: `${priorityLabel(task.data.priority)} (${task.data.priority})`,
    });
  if (due) rows.push({ label: 'Due', value: <span className={due.className}>{due.label}</span> });
  if (task.data.dtstart)
    rows.push({ label: 'Start', value: new Date(task.data.dtstart).toLocaleDateString() });
  if (task.data.completed)
    rows.push({ label: 'Completed', value: new Date(task.data.completed).toLocaleDateString() });
  if (task.data.percentComplete !== null)
    rows.push({ label: 'Progress', value: `${task.data.percentComplete}%` });
  if (task.data.categories.length > 0)
    rows.push({ label: 'Categories', value: <CategoryChips categories={task.data.categories} /> });
  if (task.data.lastModified)
    rows.push({ label: 'Modified', value: new Date(task.data.lastModified).toLocaleString() });

  const panel = (
    <div
      className={cn(
        'bg-card flex flex-col overflow-hidden',
        fullscreen ? 'flex-1' : 'flex-1 border-l border-border',
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        {fullscreen && (
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Back to tasks"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <h2 className="font-semibold text-sm flex-1 truncate">
          {task.data.summary || '(no title)'}
        </h2>
        {!fullscreen && (
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Close detail"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <dl className="space-y-2">
          {rows.map(({ label, value }) => (
            <div key={label} className="flex gap-2 text-sm">
              <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
              <dd className="flex-1 min-w-0">{value}</dd>
            </div>
          ))}
        </dl>

        {task.data.description && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Notes
            </p>
            <p className="text-sm whitespace-pre-wrap text-foreground/80">
              {task.data.description}
            </p>
          </div>
        )}
      </div>
    </div>
  );

  if (fullscreen) {
    return <div className="fixed inset-0 z-50 flex flex-col bg-background">{panel}</div>;
  }

  return panel;
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Layout = 'list' | 'compact' | 'kanban';
type SortField = TasksQueryParams['sort'];
type FilterStatus = TasksQueryParams['status'];
type FilterDue = TasksQueryParams['due'];
type FilterPriority = TasksQueryParams['priority'];

const KANBAN_COLUMNS: { status: string; title: string; headerColor: string }[] = [
  {
    status: 'NEEDS-ACTION',
    title: 'To Do',
    headerColor: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  },
  {
    status: 'IN-PROCESS',
    title: 'In Progress',
    headerColor: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  {
    status: 'COMPLETED',
    title: 'Completed',
    headerColor: 'bg-green-500/10 text-green-700 dark:text-green-300',
  },
  { status: 'CANCELLED', title: 'Cancelled', headerColor: 'bg-muted text-muted-foreground' },
];

export default function TasksPage() {
  // ── Persisted UI state ────────────────────────────────────────────────────
  const [layout, setLayout] = useState<Layout>(() => loadPref('dave:tasks:layout', 'list'));
  const [sort, setSort] = useState<SortField>(() => loadPref('dave:tasks:sort', undefined));
  const [order, setOrder] = useState<'asc' | 'desc'>(() => loadPref('dave:tasks:order', 'asc'));
  const [filterStatus, setFilterStatus] = useState<FilterStatus>(() =>
    loadPref('dave:tasks:filter:status', undefined),
  );
  const [filterDue, setFilterDue] = useState<FilterDue>(() =>
    loadPref('dave:tasks:filter:due', undefined),
  );
  const [filterPriority, setFilterPriority] = useState<FilterPriority>(() =>
    loadPref('dave:tasks:filter:priority', undefined),
  );

  // ── Ephemeral UI state ────────────────────────────────────────────────────
  const [rawSearch, setRawSearch] = useState('');
  const [search, setSearch] = useState('');
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);

  // ── Persist on change ─────────────────────────────────────────────────────
  useEffect(() => {
    savePref('dave:tasks:layout', layout);
  }, [layout]);
  useEffect(() => {
    savePref('dave:tasks:sort', sort);
  }, [sort]);
  useEffect(() => {
    savePref('dave:tasks:order', order);
  }, [order]);
  useEffect(() => {
    savePref('dave:tasks:filter:status', filterStatus);
  }, [filterStatus]);
  useEffect(() => {
    savePref('dave:tasks:filter:due', filterDue);
  }, [filterDue]);
  useEffect(() => {
    savePref('dave:tasks:filter:priority', filterPriority);
  }, [filterPriority]);

  // ── Debounce search 150ms ─────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setSearch(rawSearch), 150);
    return () => clearTimeout(t);
  }, [rawSearch]);

  // ── Collection data ───────────────────────────────────────────────────────
  const calQuery = useQuery({
    queryKey: ['calendars'],
    queryFn: getCalendars,
    staleTime: 5 * 60_000,
  });
  const { hiddenTaskCollections } = useCollectionVisibility();

  const taskCollections = useMemo(
    () => (calQuery.data ?? []).filter((c) => c.components.includes('VTODO')),
    [calQuery.data],
  );
  const hasTaskCollections = taskCollections.length > 0;

  const visibleCollectionUrls = useMemo(
    () => taskCollections.filter((c) => !hiddenTaskCollections.has(c.id)).map((c) => c.url),
    [taskCollections, hiddenTaskCollections],
  );

  // ── Trigger initial sync once on mount ───────────────────────────────────
  useEffect(() => {
    void triggerTasksSync();
  }, []);

  // ── Fetch tasks ───────────────────────────────────────────────────────────
  const params: TasksQueryParams = useMemo(
    () => ({
      status: filterStatus ?? undefined,
      due: filterDue ?? undefined,
      priority: filterPriority ?? undefined,
      q: search || undefined,
      sort: sort ?? undefined,
      order,
      collections: visibleCollectionUrls.length > 0 ? visibleCollectionUrls.join(',') : undefined,
    }),
    [filterStatus, filterDue, filterPriority, search, sort, order, visibleCollectionUrls],
  );

  const tasksQuery = useQuery({
    queryKey: ['tasks', params],
    queryFn: () => fetchTasks(params),
    enabled: hasTaskCollections && visibleCollectionUrls.length > 0,
    staleTime: 30_000,
  });

  const allTasks = useMemo(() => tasksQuery.data?.tasks ?? [], [tasksQuery.data]);

  // ── Build tree ────────────────────────────────────────────────────────────
  const { roots, childrenOf } = useMemo(() => buildTree(allTasks), [allTasks]);

  const incompleteTasks = useMemo(
    () => roots.filter((t) => t.data.status !== 'COMPLETED' && t.data.status !== 'CANCELLED'),
    [roots],
  );
  const completedTasks = useMemo(
    () => roots.filter((t) => t.data.status === 'COMPLETED' || t.data.status === 'CANCELLED'),
    [roots],
  );

  // ── Selected task detail ──────────────────────────────────────────────────
  const selectedTask = useMemo(
    () => allTasks.find((t) => t.uid === selectedUid) ?? null,
    [allTasks, selectedUid],
  );

  const isMobile = useIsMobile();

  // ── Panel resize ──────────────────────────────────────────────────────────
  const PANEL_MIN = 240;
  const PANEL_MAX = 700;
  const [panelWidth, setPanelWidth] = useState<number>(() =>
    loadPref('dave:tasks:panelWidth', 320),
  );

  useEffect(() => {
    savePref('dave:tasks:panelWidth', panelWidth);
  }, [panelWidth]);

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = panelWidth;

      const onMove = (ev: MouseEvent) => {
        const delta = startX - ev.clientX;
        setPanelWidth(Math.min(PANEL_MAX, Math.max(PANEL_MIN, startWidth + delta)));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [panelWidth],
  );

  // ── Calendar name / color lookup ──────────────────────────────────────────
  const collectionNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const cal of taskCollections) map.set(cal.url, cal.displayName);
    return map;
  }, [taskCollections]);

  const collectionColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const cal of taskCollections) map.set(cal.url, cal.color);
    return map;
  }, [taskCollections]);

  const handleSelect = useCallback((uid: string) => {
    setSelectedUid((prev) => (prev === uid ? null : uid));
  }, []);

  // ── Kanban data ───────────────────────────────────────────────────────────
  const kanbanColumns = useMemo(() => {
    const byStatus = new Map<string, Task[]>();
    for (const col of KANBAN_COLUMNS) byStatus.set(col.status, []);
    for (const task of allTasks) {
      const key = task.data.status ?? 'NEEDS-ACTION';
      const bucket = byStatus.get(key) ?? byStatus.get('NEEDS-ACTION')!;
      bucket.push(task);
    }
    return byStatus;
  }, [allTasks]);

  // ── Full page empty state (§3.1 — no VTODO collections) ──────────────────
  if (calQuery.data !== undefined && !hasTaskCollections) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <ClipboardList className="h-12 w-12 text-muted-foreground/40" />
        <div>
          <h2 className="text-lg font-semibold">No task lists found</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Your Baikal collections don&apos;t currently advertise support for VTODO components.
            Enable VTODO on an existing collection or create a new one in Baikal.
          </p>
        </div>
        <a
          href="#"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          Set up in Baikal
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    );
  }

  const activeFilters = [filterStatus, filterDue, filterPriority].filter(Boolean).length;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-40 max-w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              placeholder="Search tasks…"
              value={rawSearch}
              onChange={(e) => setRawSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            {rawSearch && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setRawSearch('')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Sort */}
          <select
            value={sort ?? ''}
            onChange={(e) => setSort((e.target.value as SortField) || undefined)}
            className="text-sm rounded-md border border-input bg-background px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="">Default sort</option>
            <option value="summary">A–Z</option>
            <option value="due">Due date</option>
            <option value="priority">Priority</option>
            <option value="modified">Modified</option>
            <option value="category">Category</option>
          </select>

          {sort && (
            <button
              onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
              title={`Sort ${order === 'asc' ? 'ascending' : 'descending'} — click to toggle`}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowUpDown className="h-4 w-4" />
            </button>
          )}

          {/* Filters */}
          <div className="flex items-center gap-1">
            <select
              value={filterStatus ?? ''}
              onChange={(e) => setFilterStatus((e.target.value as FilterStatus) || undefined)}
              className={cn(
                'text-sm rounded-md border px-2 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-primary/50',
                filterStatus ? 'border-primary text-primary' : 'border-input',
              )}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>

            <select
              value={filterDue ?? ''}
              onChange={(e) => setFilterDue((e.target.value as FilterDue) || undefined)}
              className={cn(
                'text-sm rounded-md border px-2 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-primary/50',
                filterDue ? 'border-primary text-primary' : 'border-input',
              )}
            >
              <option value="">Any due date</option>
              <option value="overdue">Overdue</option>
              <option value="today">Today</option>
              <option value="this_week">This week</option>
              <option value="no_due_date">No due date</option>
            </select>

            <select
              value={filterPriority ?? ''}
              onChange={(e) => setFilterPriority((e.target.value as FilterPriority) || undefined)}
              className={cn(
                'text-sm rounded-md border px-2 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-primary/50',
                filterPriority ? 'border-primary text-primary' : 'border-input',
              )}
            >
              <option value="">Any priority</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="none">No priority</option>
            </select>

            {activeFilters > 0 && (
              <button
                onClick={() => {
                  setFilterStatus(undefined);
                  setFilterDue(undefined);
                  setFilterPriority(undefined);
                }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                title="Clear all filters"
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </button>
            )}
          </div>

          {/* Layout toggle */}
          <div className="flex items-center gap-0.5 rounded-md border border-input p-0.5 ml-auto shrink-0">
            <LayoutToggleButton
              icon={<List className="h-4 w-4" />}
              active={layout === 'list'}
              title="List"
              onClick={() => setLayout('list')}
            />
            <LayoutToggleButton
              icon={<LayoutGrid className="h-4 w-4" />}
              active={layout === 'compact'}
              title="Compact"
              onClick={() => setLayout('compact')}
            />
            <LayoutToggleButton
              icon={<Columns3 className="h-4 w-4" />}
              active={layout === 'kanban'}
              title="Kanban"
              onClick={() => setLayout('kanban')}
            />
          </div>
        </div>

        {/* Task content */}
        <div className="flex-1 overflow-auto">
          {tasksQuery.isError && (
            <div className="flex items-center gap-2 p-4 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Failed to load tasks.
            </div>
          )}

          {!tasksQuery.isError && layout !== 'kanban' && (
            <div className="py-2">
              {/* Incomplete tasks */}
              {incompleteTasks.map((task) => (
                <TaskRow
                  key={task.uid}
                  task={task}
                  compact={layout === 'compact'}
                  depth={0}
                  childrenOf={childrenOf}
                  selectedUid={selectedUid}
                  onSelect={handleSelect}
                  calendarName={collectionNameMap.get(task.collectionUrl)}
                  calendarColor={collectionColorMap.get(task.collectionUrl)}
                />
              ))}

              {/* Empty state for matching set */}
              {incompleteTasks.length === 0 &&
                completedTasks.length === 0 &&
                !tasksQuery.isLoading && (
                  <p className="px-4 py-6 text-sm text-muted-foreground text-center">
                    {search || activeFilters > 0
                      ? 'No tasks match the current filters.'
                      : 'No tasks yet.'}
                  </p>
                )}

              {/* Completed disclosure */}
              {completedTasks.length > 0 && (
                <div className="mt-1">
                  <button
                    onClick={() => setShowCompleted((v) => !v)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground w-full"
                  >
                    {showCompleted ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    Show {completedTasks.length} completed
                  </button>
                  {showCompleted &&
                    completedTasks.map((task) => (
                      <TaskRow
                        key={task.uid}
                        task={task}
                        compact={layout === 'compact'}
                        depth={0}
                        childrenOf={childrenOf}
                        selectedUid={selectedUid}
                        onSelect={handleSelect}
                        calendarName={collectionNameMap.get(task.collectionUrl)}
                        calendarColor={collectionColorMap.get(task.collectionUrl)}
                      />
                    ))}
                </div>
              )}
            </div>
          )}

          {!tasksQuery.isError && layout === 'kanban' && (
            <div className="flex gap-3 p-4 h-full overflow-x-auto">
              {KANBAN_COLUMNS.map(({ status, title, headerColor }) => (
                <KanbanColumn
                  key={status}
                  title={title}
                  tasks={kanbanColumns.get(status) ?? []}
                  selectedUid={selectedUid}
                  onSelect={handleSelect}
                  color={headerColor}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selectedTask && !isMobile && (
        <div className="flex shrink-0" style={{ width: panelWidth }}>
          {/* Drag handle */}
          <div
            className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
            onMouseDown={startResize}
            title="Drag to resize"
          />
          <TaskDetailPanel
            task={selectedTask}
            onClose={() => setSelectedUid(null)}
            fullscreen={false}
          />
        </div>
      )}
      {selectedTask && isMobile && (
        <TaskDetailPanel
          task={selectedTask}
          onClose={() => setSelectedUid(null)}
          fullscreen={true}
        />
      )}
    </div>
  );
}

function LayoutToggleButton({
  icon,
  active,
  title,
  onClick,
}: {
  icon: React.ReactNode;
  active: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'p-1 rounded transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
    </button>
  );
}
