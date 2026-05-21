import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Edit2,
  ExternalLink,
  List,
  LayoutGrid,
  Columns3,
  Plus,
  Search,
  Trash2,
  X,
  ArrowUpDown,
} from 'lucide-react';
import type { Task, TaskJson, TasksQueryParams } from '@dave/shared';
import { fetchTasks, fetchTask, createTask, updateTask, deleteTask, applyCompletion, triggerTasksSync } from '../api/tasks';
import { getCalendars } from '../api/collections';
import { useCollectionVisibility } from '../contexts/CollectionVisibility';
import { useIsMobile } from '../hooks/useIsMobile';
import { cn } from '../lib/utils';
import TaskEditForm, { emptyTaskJson } from '../components/TaskEditForm';

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
  onToggleComplete,
  calendarName,
  calendarColor,
}: {
  task: Task;
  compact: boolean;
  depth: number;
  childrenOf: Map<string, Task[]>;
  selectedUid: string | null;
  onSelect: (uid: string) => void;
  onToggleComplete: (task: Task) => void;
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

        {/* Completion checkbox */}
        <button
          aria-label={task.data.status === 'COMPLETED' ? 'Mark incomplete' : 'Mark complete'}
          className={cn(
            'shrink-0 mt-0.5 w-4 h-4 rounded-full border-2 transition-colors hover:opacity-80',
            task.data.status === 'COMPLETED'
              ? 'bg-primary border-primary'
              : task.data.status === 'CANCELLED'
                ? 'border-muted-foreground bg-muted cursor-not-allowed opacity-50'
                : 'border-muted-foreground hover:border-primary',
          )}
          onClick={(e) => {
            e.stopPropagation();
            if (task.data.status !== 'CANCELLED') onToggleComplete(task);
          }}
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
            onToggleComplete={onToggleComplete}
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
                onToggleComplete={onToggleComplete}
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
  collectionColorMap,
  className,
}: {
  title: string;
  tasks: Task[];
  selectedUid: string | null;
  onSelect: (uid: string) => void;
  color: string;
  collectionColorMap: Map<string, string>;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col rounded-lg border border-border bg-muted/30', className)}>
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
          const calColor = collectionColorMap.get(task.collectionUrl);
          return (
            <div
              key={task.uid}
              onClick={() => onSelect(task.uid)}
              className={cn(
                'rounded-md border border-border bg-card cursor-pointer hover:border-primary/50 transition-colors text-sm overflow-hidden',
                selectedUid === task.uid && 'border-primary bg-primary/5',
              )}
            >
              <div className="flex">
                <div className="w-1 shrink-0" style={{ backgroundColor: calColor }} />
                <div className="p-2.5 flex-1 min-w-0">
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
              </div>
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
  onEdit,
  onDelete,
  onToggleComplete,
  fullscreen = false,
}: {
  task: Task;
  onClose: () => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToggleComplete: (task: Task) => void;
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
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        {fullscreen && (
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Back to tasks"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <h2 className="font-semibold text-sm flex-1 truncate min-w-0">
          {task.data.summary || '(no title)'}
        </h2>
        <button
          onClick={() => onToggleComplete(task)}
          disabled={task.data.status === 'CANCELLED'}
          title={task.data.status === 'COMPLETED' ? 'Mark incomplete' : 'Mark complete'}
          className={cn(
            'shrink-0 text-xs px-2 py-1 rounded border transition-colors',
            task.data.status === 'COMPLETED'
              ? 'border-primary text-primary hover:bg-primary/10'
              : 'border-muted-foreground/50 text-muted-foreground hover:border-primary hover:text-primary',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          {task.data.status === 'COMPLETED' ? 'Completed' : 'Mark done'}
        </button>
        <button
          onClick={() => onEdit(task)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Edit task"
        >
          <Edit2 className="h-4 w-4" />
        </button>
        <button
          onClick={() => onDelete(task)}
          className="shrink-0 text-destructive/60 hover:text-destructive"
          aria-label="Delete task"
        >
          <Trash2 className="h-4 w-4" />
        </button>
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
    title: 'Pending',
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
  const queryClient = useQueryClient();

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

  // ── Edit / create / delete state ──────────────────────────────────────────
  const [editingTaskData, setEditingTaskData] = useState<{ task: Task; fullData: TaskJson } | null>(null);
  const [createMode, setCreateMode] = useState(false);
  const [defaultCreateCollectionUrl, setDefaultCreateCollectionUrl] = useState<string>('');
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<Task | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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

  // ── Mutations ─────────────────────────────────────────────────────────────

  const invalidateTasks = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  }, [queryClient]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  const createMutation = useMutation({
    mutationFn: (data: TaskJson) => createTask(data),
    onSuccess: (result) => {
      savePref('dave:tasks:lastCollectionUrl', result.collectionUrl);
      setCreateMode(false);
      setSelectedUid(result.uid);
      invalidateTasks();
    },
    onError: () => showToast('Failed to create task. Please try again.'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ data, etag }: { data: TaskJson; etag: string }) =>
      updateTask(data.uid, data, etag),
    onSuccess: () => {
      setEditingTaskData(null);
      invalidateTasks();
    },
    onError: (err: unknown) => {
      const e = err as { status?: number; message?: string };
      if (e.status === 412) {
        setConflictMessage('This task was modified elsewhere. Reload to see the latest version.');
      } else {
        showToast('Failed to save task. Please try again.');
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ uid, etag }: { uid: string; etag: string }) => deleteTask(uid, etag),
    onSuccess: () => {
      setDeleteConfirmTask(null);
      setSelectedUid(null);
      invalidateTasks();
    },
    onError: (err: unknown) => {
      const e = err as { status?: number };
      if (e.status === 412) {
        setConflictMessage('This task was modified elsewhere. Reload before deleting.');
      } else {
        showToast('Failed to delete task. Please try again.');
      }
      setDeleteConfirmTask(null);
    },
  });

  const handleToggleComplete = useCallback((task: Task) => {
    const completed = task.data.status !== 'COMPLETED';
    const updated = applyCompletion(task.data, completed);
    updateMutation.mutate({ data: updated, etag: task.etag });
  }, [updateMutation]);

  const handleEdit = useCallback(async (task: Task) => {
    // Fetch full task data (including alarms) before opening the edit form.
    try {
      const full = await fetchTask(task.uid);
      setEditingTaskData({ task, fullData: full.data });
    } catch {
      showToast('Failed to load task details.');
    }
  }, [showToast]);

  const handleCreate = useCallback(() => {
    const url = loadPref<string>('dave:tasks:lastCollectionUrl', '') ||
      (taskCollections[0]?.url ?? '');
    setDefaultCreateCollectionUrl(url);
    setCreateMode(true);
  }, [taskCollections]);

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

  // ── Kanban board width (for responsive column layout) ────────────────────
  const boardRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(0);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setBoardWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // fill: columns stretch equally; scroll: fixed-width + horizontal scroll; swipe: one column at a time
  const FILL_THRESHOLD = KANBAN_COLUMNS.length * 280;
  const kanbanMode =
    boardWidth === 0
      ? 'scroll'
      : boardWidth < 480
        ? 'swipe'
        : boardWidth < FILL_THRESHOLD
          ? 'scroll'
          : 'fill';

  // ── Kanban swipe navigation ───────────────────────────────────────────────
  const swipeScrollRef = useRef<HTMLDivElement>(null);
  const [activeColumn, setActiveColumn] = useState(0);

  const scrollToColumn = useCallback((index: number) => {
    const el = swipeScrollRef.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' });
    setActiveColumn(index);
  }, []);

  const handleSwipeScroll = useCallback(() => {
    const el = swipeScrollRef.current;
    if (!el) return;
    setActiveColumn(Math.round(el.scrollLeft / el.clientWidth));
  }, []);

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
          {/* New task button */}
          <button
            onClick={handleCreate}
            disabled={!hasTaskCollections || visibleCollectionUrls.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            New task
          </button>

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
        <div ref={boardRef} className="flex-1 overflow-auto">
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
                  onToggleComplete={handleToggleComplete}
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
                        onToggleComplete={handleToggleComplete}
                        calendarName={collectionNameMap.get(task.collectionUrl)}
                        calendarColor={collectionColorMap.get(task.collectionUrl)}
                      />
                    ))}
                </div>
              )}
            </div>
          )}

          {!tasksQuery.isError && layout === 'kanban' && (
            <div className="flex flex-col h-full overflow-hidden">
              {kanbanMode !== 'swipe' && (
                <div
                  className={cn(
                    'flex gap-3 p-4 h-full',
                    kanbanMode === 'fill' ? 'overflow-hidden' : 'overflow-x-auto',
                  )}
                >
                  {KANBAN_COLUMNS.map(({ status, title, headerColor }) => (
                    <KanbanColumn
                      key={status}
                      title={title}
                      tasks={kanbanColumns.get(status) ?? []}
                      selectedUid={selectedUid}
                      onSelect={handleSelect}
                      color={headerColor}
                      collectionColorMap={collectionColorMap}
                      className={
                        kanbanMode === 'fill' ? 'flex-1 min-w-0' : 'min-w-56 w-64 shrink-0'
                      }
                    />
                  ))}
                </div>
              )}

              {kanbanMode === 'swipe' && (
                <div className="flex flex-col h-full">
                  {/* Column nav bar */}
                  <div className="flex items-center justify-between px-4 py-2 shrink-0 border-b border-border">
                    <button
                      onClick={() => scrollToColumn(Math.max(0, activeColumn - 1))}
                      disabled={activeColumn === 0}
                      className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                      aria-label="Previous column"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <div className="text-sm font-medium">
                      {KANBAN_COLUMNS[activeColumn]?.title}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {kanbanColumns.get(KANBAN_COLUMNS[activeColumn]?.status ?? '')?.length ?? 0}{' '}
                        tasks
                      </span>
                    </div>
                    <button
                      onClick={() =>
                        scrollToColumn(Math.min(KANBAN_COLUMNS.length - 1, activeColumn + 1))
                      }
                      disabled={activeColumn === KANBAN_COLUMNS.length - 1}
                      className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                      aria-label="Next column"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Snap-scroll columns */}
                  <div
                    ref={swipeScrollRef}
                    onScroll={handleSwipeScroll}
                    className="flex flex-1 overflow-x-auto snap-x snap-mandatory [&::-webkit-scrollbar]:hidden"
                    style={{ scrollbarWidth: 'none' }}
                  >
                    {KANBAN_COLUMNS.map(({ status, title, headerColor }) => (
                      <div key={status} className="w-full shrink-0 snap-start flex flex-col p-3">
                        <KanbanColumn
                          title={title}
                          tasks={kanbanColumns.get(status) ?? []}
                          selectedUid={selectedUid}
                          onSelect={handleSelect}
                          color={headerColor}
                          collectionColorMap={collectionColorMap}
                          className="flex-1"
                        />
                      </div>
                    ))}
                  </div>

                  {/* Column indicator dots */}
                  <div className="flex justify-center gap-2 py-2 shrink-0">
                    {KANBAN_COLUMNS.map((col, i) => (
                      <button
                        key={col.status}
                        onClick={() => scrollToColumn(i)}
                        className={cn(
                          'w-2 h-2 rounded-full transition-colors',
                          i === activeColumn ? 'bg-primary' : 'bg-muted-foreground/30',
                        )}
                        aria-label={`Go to ${col.title}`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selectedTask && !editingTaskData && !isMobile && (
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
            onEdit={handleEdit}
            onDelete={setDeleteConfirmTask}
            onToggleComplete={handleToggleComplete}
            fullscreen={false}
          />
        </div>
      )}
      {selectedTask && !editingTaskData && isMobile && (
        <TaskDetailPanel
          task={selectedTask}
          onClose={() => setSelectedUid(null)}
          onEdit={handleEdit}
          onDelete={setDeleteConfirmTask}
          onToggleComplete={handleToggleComplete}
          fullscreen={true}
        />
      )}

      {/* Edit form panel */}
      {editingTaskData && (
        <div
          className={cn(
            'flex flex-col bg-card border-l border-border overflow-y-auto',
            isMobile ? 'fixed inset-0 z-50' : 'shrink-0',
          )}
          style={!isMobile ? { width: panelWidth } : undefined}
        >
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
            <h2 className="text-sm font-semibold flex-1">Edit task</h2>
            <button
              onClick={() => setEditingTaskData(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <TaskEditForm
            initial={editingTaskData.fullData}
            calendars={taskCollections}
            isNew={false}
            saving={updateMutation.isPending}
            onSave={(data) => updateMutation.mutate({ data, etag: editingTaskData.task.etag })}
            onDelete={() => setDeleteConfirmTask(editingTaskData.task)}
            onCancel={() => setEditingTaskData(null)}
          />
        </div>
      )}

      {/* Create task modal */}
      {createMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold flex-1">New task</h2>
              <button
                onClick={() => setCreateMode(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <TaskEditForm
              initial={emptyTaskJson(
                defaultCreateCollectionUrl || taskCollections[0]?.url || '',
              )}
              calendars={taskCollections}
              isNew={true}
              saving={createMutation.isPending}
              onSave={(data) => createMutation.mutate(data)}
              onCancel={() => setCreateMode(false)}
            />
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirmTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card rounded-lg shadow-xl w-full max-w-sm p-6">
            <h2 className="font-semibold mb-2">Delete task?</h2>
            <p className="text-sm text-muted-foreground mb-4">
              &ldquo;{deleteConfirmTask.data.summary || '(no title)'}&rdquo; will be permanently deleted.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirmTask(null)}
                className="px-3 py-1.5 text-sm rounded-md border border-input hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  deleteMutation.mutate({ uid: deleteConfirmTask.uid, etag: deleteConfirmTask.etag })
                }
                disabled={deleteMutation.isPending}
                className="px-3 py-1.5 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ETag conflict dialog */}
      {conflictMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card rounded-lg shadow-xl w-full max-w-sm p-6">
            <h2 className="font-semibold mb-2">Conflict</h2>
            <p className="text-sm text-muted-foreground mb-4">{conflictMessage}</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setConflictMessage(null); setEditingTaskData(null); invalidateTasks(); }}
                className="px-3 py-1.5 text-sm rounded-md border border-input hover:bg-muted"
              >
                Discard my changes
              </button>
              <button
                onClick={() => setConflictMessage(null)}
                className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Keep editing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMessage && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-foreground text-background text-sm shadow-lg">
          {toastMessage}
        </div>
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
