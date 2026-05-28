import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CornerUpLeft,
  Edit2,
  ExternalLink,
  GitBranch,
  List,
  LayoutGrid,
  Columns3,
  MoreVertical,
  PencilLine,
  Plus,
  Repeat,
  Search,
  Trash2,
  X,
  ArrowUpDown,
} from 'lucide-react';
import type { Calendar, Task, TaskJson, TasksQueryParams } from '@dave/shared';
import {
  fetchTasks,
  fetchTask,
  createTask,
  updateTask,
  deleteTask,
  applyCompletion,
  applyStatusChange,
  triggerTasksSync,
} from '../api/tasks';
import { getCalendars } from '../api/collections';
import { useCollectionVisibility } from '../contexts/CollectionVisibility';
import { useSettings } from '../contexts/Settings';
import { useIsMobile } from '../hooks/useIsMobile';
import { cn } from '../lib/utils';
import TaskEditForm, { emptyTaskJson } from '../components/TaskEditForm';
import BulkDeleteDialog from '../components/BulkDeleteDialog';
import TaskBulkEditModal, { applyTaskBulkEdit } from '../components/TaskBulkEditModal';
import type { TaskBulkEditConfig, TaskBulkEditFieldId } from '../components/TaskBulkEditModal';

// Baikal stores colors as #RRGGBBAA. Strip alpha so we can append our own opacity suffix.
function hex6(color: string): string {
  if (color.startsWith('#') && color.length === 9) return color.slice(0, 7);
  return color;
}

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
  return 'bg-green-500';
}

// ── Due date helpers ──────────────────────────────────────────────────────────

function dueDateDisplay(due: string | null): { label: string; className: string } | null {
  if (!due) return null;
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(due);
  // Parse date-only as local midnight (appending T00:00:00 avoids UTC-offset
  // issues where new Date("2024-01-01") would be Dec 31 in UTC-N zones).
  const d = isDateOnly ? new Date(due + 'T00:00:00') : new Date(due);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86_400_000);

  const overdue = isDateOnly ? d < todayStart : d < now;
  const isToday = !overdue && d < todayEnd;

  let label: string;
  if (isDateOnly) {
    label = isToday ? 'Today' : d.toLocaleDateString();
  } else {
    const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (isToday) {
      label = timeStr;
    } else {
      const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      label = `${dateStr} ${timeStr}`;
    }
  }

  const className = overdue
    ? 'text-destructive'
    : isToday
      ? 'text-amber-500 font-medium'
      : 'text-muted-foreground';

  return { label, className };
}

// ── Recurrence helpers ────────────────────────────────────────────────────────

function rruleToText(rrule: string | null): string | null {
  if (!rrule) return null;
  const freq = rrule.match(/FREQ=(\w+)/)?.[1];
  if (!freq) return null;
  const interval = parseInt(rrule.match(/INTERVAL=(\d+)/)?.[1] ?? '1', 10);
  const count = rrule.match(/COUNT=(\d+)/)?.[1];
  const until = rrule.match(/UNTIL=(\d{8})/)?.[1];

  let base: string;
  if (freq === 'DAILY') base = interval === 1 ? 'Daily' : `Every ${interval} days`;
  else if (freq === 'WEEKLY') base = interval === 1 ? 'Weekly' : `Every ${interval} weeks`;
  else if (freq === 'MONTHLY') base = interval === 1 ? 'Monthly' : `Every ${interval} months`;
  else if (freq === 'YEARLY') base = interval === 1 ? 'Yearly' : `Every ${interval} years`;
  else base = freq.charAt(0) + freq.slice(1).toLowerCase();

  if (count) return `${base}, ${count} time${parseInt(count) !== 1 ? 's' : ''} remaining`;
  if (until) {
    const y = until.slice(0, 4),
      m = until.slice(4, 6),
      d = until.slice(6, 8);
    const label = new Date(`${y}-${m}-${d}T00:00:00`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `${base}, until ${label}`;
  }
  return base;
}

// ── Task tree building ────────────────────────────────────────────────────────

function buildTree(tasks: Task[]): {
  roots: Task[];
  childrenOf: Map<string, Task[]>;
  orphanedParentUid: Map<string, string>; // task.uid → missing parent uid
  parentOf: Map<string, Task>; // task.uid → parent Task
} {
  const taskByUid = new Map(tasks.map((t) => [t.uid, t]));
  const isChild = new Set<string>();
  const childrenOf = new Map<string, Task[]>();
  const orphanedParentUid = new Map<string, string>();
  const parentOf = new Map<string, Task>();

  for (const task of tasks) {
    for (const rel of task.data.relations) {
      if (rel.reltype === 'PARENT') {
        if (taskByUid.has(rel.relatedUid)) {
          isChild.add(task.uid);
          const arr = childrenOf.get(rel.relatedUid) ?? [];
          arr.push(task);
          childrenOf.set(rel.relatedUid, arr);
          parentOf.set(task.uid, taskByUid.get(rel.relatedUid)!);
        } else {
          orphanedParentUid.set(task.uid, rel.relatedUid);
        }
      }
    }
  }

  const roots = tasks.filter((t) => !isChild.has(t.uid));
  return { roots, childrenOf, orphanedParentUid, parentOf };
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
  orphanedParentUid,
  selectedUid,
  onSelect,
  onToggleComplete,
  calendarName,
  calendarColor,
  isMultiSelect,
  isSelectedFn,
  onToggleSelect,
  onEnterMultiSelect,
  onEdit,
  onDelete,
}: {
  task: Task;
  compact: boolean;
  depth: number;
  childrenOf: Map<string, Task[]>;
  orphanedParentUid: Map<string, string>;
  selectedUid: string | null;
  onSelect: (uid: string) => void;
  onToggleComplete: (task: Task) => void;
  calendarName?: string;
  calendarColor?: string;
  isMultiSelect: boolean;
  isSelectedFn: (uid: string) => boolean;
  onToggleSelect: (uid: string) => void;
  onEnterMultiSelect: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const children = childrenOf.get(task.uid) ?? [];
  const hasChildren = children.length > 0;
  const collapseDeep = depth >= 3 && hasChildren;
  const [deepExpanded, setDeepExpanded] = useState(false);
  const isSelected = selectedUid === task.uid;
  const isChecked = isSelectedFn(task.uid);
  const due = dueDateDisplay(task.data.due);

  return (
    <>
      <div
        className={cn(
          'group flex items-start gap-2 px-3 pr-1 rounded-md cursor-pointer transition-colors mx-1 my-0.5',
          compact ? 'py-1.5' : 'py-3',
          isChecked ? 'bg-primary/10' : isSelected ? 'bg-primary/5' : 'hover:bg-muted',
        )}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
        onClick={() => {
          if (isMultiSelect) onToggleSelect(task.uid);
          else onSelect(task.uid);
        }}
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

        {/* Left control: square select checkbox (multi-select) or round complete circle (normal) */}
        {isMultiSelect ? (
          <button
            aria-label={isChecked ? 'Deselect task' : 'Select task'}
            className={cn(
              'shrink-0 mt-0.5 w-4 h-4 rounded-sm border-2 transition-colors',
              isChecked
                ? 'bg-primary border-primary'
                : 'border-muted-foreground hover:border-primary',
            )}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(task.uid);
            }}
          />
        ) : (
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
        )}

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
              {task.data.rrule && (
                <Repeat className="inline h-3 w-3 text-muted-foreground ml-1.5 shrink-0 align-middle" />
              )}
            </span>
            {orphanedParentUid.has(task.uid) && (
              <span className="ml-1.5 text-xs text-muted-foreground/60 italic">
                (parent deleted)
              </span>
            )}
            {task.data.recurringInstance && !compact && (
              <span className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                <Repeat className="h-3 w-3 shrink-0" />
                <span>Recurring instance</span>
              </span>
            )}

            {/* Calendar / categories — list only, below title */}
            {!compact && (calendarName || task.data.categories.length > 0) && (
              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                {calendarName && (
                  <span
                    className="px-1.5 py-0.5 rounded text-xs shrink-0 font-medium"
                    style={
                      calendarColor
                        ? {
                            backgroundColor: hex6(calendarColor) + '33',
                            color: hex6(calendarColor),
                          }
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

        {/* Kebab quick-action menu */}
        <div className="shrink-0 w-6 flex items-start justify-center pt-0.5 relative">
          <button
            className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            aria-label="Task actions"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-0.5 z-20 w-36 rounded-md border border-border bg-background shadow-lg py-1 text-sm">
                {isMultiSelect ? (
                  <button
                    className="w-full text-left px-3 py-1.5 hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onToggleSelect(task.uid);
                    }}
                  >
                    {isChecked ? 'Deselect' : 'Select'}
                  </button>
                ) : (
                  <button
                    className="w-full text-left px-3 py-1.5 hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onEnterMultiSelect(task);
                    }}
                  >
                    Select
                  </button>
                )}
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    onEdit(task);
                  }}
                >
                  Edit
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 hover:bg-muted text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    onDelete(task);
                  }}
                >
                  Delete
                </button>
              </div>
            </>
          )}
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
            orphanedParentUid={orphanedParentUid}
            selectedUid={selectedUid}
            onSelect={onSelect}
            onToggleComplete={onToggleComplete}
            calendarName={calendarName}
            calendarColor={calendarColor}
            isMultiSelect={isMultiSelect}
            isSelectedFn={isSelectedFn}
            onToggleSelect={onToggleSelect}
            onEnterMultiSelect={onEnterMultiSelect}
            onEdit={onEdit}
            onDelete={onDelete}
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
                orphanedParentUid={orphanedParentUid}
                selectedUid={selectedUid}
                onSelect={onSelect}
                onToggleComplete={onToggleComplete}
                calendarName={calendarName}
                calendarColor={calendarColor}
                isMultiSelect={isMultiSelect}
                isSelectedFn={isSelectedFn}
                onToggleSelect={onToggleSelect}
                onEnterMultiSelect={onEnterMultiSelect}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
        </div>
      )}
    </>
  );
}

function KanbanColumn({
  title,
  status,
  tasks,
  selectedUid,
  onSelect,
  onDropTask,
  color,
  collectionColorMap,
  childrenOf,
  parentOf,
  className,
}: {
  title: string;
  status: string;
  tasks: Task[];
  selectedUid: string | null;
  onSelect: (uid: string) => void;
  onDropTask: (task: Task, targetStatus: string) => void;
  color: string;
  collectionColorMap: Map<string, string>;
  childrenOf: Map<string, Task[]>;
  parentOf: Map<string, Task>;
  className?: string;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  // Counter-based approach avoids false negatives from child enter/leave events.
  const dragCounterRef = useRef(0);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const raw = e.dataTransfer.getData('application/dave-task');
    if (!raw) return;
    try {
      const task = JSON.parse(raw) as Task;
      if (task.data.status !== status) onDropTask(task, status);
    } catch {
      /* ignore malformed */
    }
  };

  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border transition-colors bg-muted/30',
        isDragOver ? 'border-primary bg-primary/5' : 'border-border',
        className,
      )}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className={cn('px-3 py-2 rounded-t-lg font-medium text-sm flex items-center gap-2', color)}
      >
        {title}
        <span className="ml-auto text-xs font-normal opacity-70">{tasks.length}</span>
      </div>
      <div className="flex flex-col gap-1 p-2 overflow-y-auto flex-1">
        {tasks.length === 0 && (
          <p
            className={cn(
              'text-xs text-center py-4',
              isDragOver ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            {isDragOver ? 'Drop here' : 'No tasks'}
          </p>
        )}
        {tasks.map((task) => {
          const due = dueDateDisplay(task.data.due);
          const calColor = collectionColorMap.get(task.collectionUrl);
          const hasAlarms = task.data.alarms.length > 0;
          const pct = task.data.percentComplete ?? 0;
          return (
            <div
              key={task.uid}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/dave-task', JSON.stringify(task));
                e.dataTransfer.effectAllowed = 'move';
              }}
              onClick={() => onSelect(task.uid)}
              className={cn(
                'rounded-md border border-border bg-card cursor-grab active:cursor-grabbing hover:border-primary/50 transition-colors text-sm overflow-hidden select-none',
                selectedUid === task.uid && 'border-primary bg-primary/5',
              )}
            >
              <div className="flex">
                <div className="w-1 shrink-0" style={{ backgroundColor: calColor }} />
                <div className="px-2.5 pt-2.5 pb-2 flex-1 min-w-0">
                  {/* Title row: priority dot · title · due date */}
                  <div className="flex items-start gap-1.5">
                    {task.data.priority !== null && (
                      <span
                        className={cn(
                          'shrink-0 w-2 h-2 rounded-full mt-1.5',
                          priorityColor(task.data.priority),
                        )}
                        title={`${priorityLabel(task.data.priority)} priority`}
                      />
                    )}
                    <p className="font-medium leading-snug flex-1 min-w-0 line-clamp-2">
                      {task.data.summary || '(no title)'}
                      {task.data.rrule && (
                        <Repeat className="inline h-3 w-3 text-muted-foreground ml-1.5 shrink-0 align-middle" />
                      )}
                    </p>
                    {due && (
                      <span
                        className={cn('text-xs whitespace-nowrap shrink-0 mt-0.5', due.className)}
                      >
                        {due.label}
                      </span>
                    )}
                  </div>

                  {/* Meta row: categories · bell */}
                  {(task.data.categories.length > 0 || hasAlarms) && (
                    <div className="flex items-center gap-1 mt-1.5">
                      <div className="flex-1 min-w-0">
                        <CategoryChips categories={task.data.categories} />
                      </div>
                      {hasAlarms && (
                        <Bell
                          className="shrink-0 h-3 w-3 text-muted-foreground"
                          aria-label="Has reminders"
                        />
                      )}
                    </div>
                  )}

                  {/* Recurring-instance badge */}
                  {task.data.recurringInstance && (
                    <div className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground">
                      <Repeat className="h-3 w-3 shrink-0" />
                      <span>Recurring instance</span>
                    </div>
                  )}

                  {/* Relationship indicators: parent name · subtask count */}
                  {(() => {
                    const taskChildren = childrenOf.get(task.uid) ?? [];
                    const parent = parentOf.get(task.uid);
                    if (!parent && taskChildren.length === 0) return null;
                    return (
                      <div className="flex items-center gap-2 mt-1.5">
                        {parent && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                            <CornerUpLeft className="h-3 w-3 shrink-0" />
                            <span className="truncate max-w-27.5">
                              {parent.data.summary || '(no title)'}
                            </span>
                          </span>
                        )}
                        {taskChildren.length > 0 && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 ml-auto">
                            <GitBranch className="h-3 w-3" />
                            {taskChildren.length}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Progress bar */}
              {pct > 0 && (
                <div className="h-1 bg-muted">
                  <div
                    className="h-full bg-primary/60 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SubtaskItem({
  task,
  depth,
  childrenOf,
  onSelectTask,
  onToggleComplete,
}: {
  task: Task;
  depth: number;
  childrenOf: Map<string, Task[]>;
  onSelectTask: (uid: string) => void;
  onToggleComplete: (task: Task) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const children = childrenOf.get(task.uid) ?? [];
  const hasChildren = children.length > 0;

  return (
    <li>
      <div
        className="flex items-center gap-1.5 py-1.5 rounded hover:bg-muted"
        style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: '8px' }}
      >
        {hasChildren ? (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={expanded ? 'Collapse subtasks' : 'Expand subtasks'}
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="shrink-0 w-3" />
        )}
        <button
          aria-label={task.data.status === 'COMPLETED' ? 'Mark incomplete' : 'Mark complete'}
          onClick={() => onToggleComplete(task)}
          disabled={task.data.status === 'CANCELLED'}
          className={cn(
            'shrink-0 w-3.5 h-3.5 rounded-full border-2 transition-colors hover:opacity-80',
            task.data.status === 'COMPLETED'
              ? 'bg-primary border-primary'
              : task.data.status === 'CANCELLED'
                ? 'border-muted-foreground opacity-40 cursor-not-allowed'
                : 'border-muted-foreground hover:border-primary',
          )}
        />
        <button
          onClick={() => onSelectTask(task.uid)}
          className="flex-1 text-left text-sm truncate"
        >
          <span
            className={cn(
              (task.data.status === 'COMPLETED' || task.data.status === 'CANCELLED') &&
                'line-through text-muted-foreground',
            )}
          >
            {task.data.summary || '(no title)'}
          </span>
        </button>
        {hasChildren && (
          <span className="shrink-0 text-xs text-muted-foreground">{children.length}</span>
        )}
      </div>
      {hasChildren && expanded && (
        <ul>
          {children.map((child) => (
            <SubtaskItem
              key={child.uid}
              task={child}
              depth={depth + 1}
              childrenOf={childrenOf}
              onSelectTask={onSelectTask}
              onToggleComplete={onToggleComplete}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function TaskDetailPanel({
  task,
  onClose,
  onEdit,
  onDelete,
  onToggleComplete,
  onAddSubtask,
  onSelectTask,
  childrenOf,
  parentOf,
  fullscreen = false,
}: {
  task: Task;
  onClose: () => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToggleComplete: (task: Task) => void;
  onAddSubtask: (parent: Task) => void;
  onSelectTask: (uid: string) => void;
  childrenOf: Map<string, Task[]>;
  parentOf: Map<string, Task>;
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
  const repeatText = rruleToText(task.data.rrule);
  if (repeatText) rows.push({ label: 'Repeat', value: repeatText });
  if (task.data.recurringInstance)
    rows.push({
      label: 'Type',
      value: (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Repeat className="h-3 w-3 shrink-0" />
          Recurring instance
        </span>
      ),
    });
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

        {/* Parent task indicator — shown when this is a subtask */}
        {(() => {
          const parentTask = parentOf.get(task.uid);
          const hasParentRelation = task.data.relations.some((r) => r.reltype === 'PARENT');
          if (!hasParentRelation) return null;
          return (
            <div className="flex items-center gap-1.5 text-xs">
              <CornerUpLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground shrink-0">Subtask of</span>
              {parentTask ? (
                <button
                  onClick={() => onSelectTask(parentTask.uid)}
                  className="text-primary hover:underline truncate font-medium text-left"
                >
                  {parentTask.data.summary || '(no title)'}
                </button>
              ) : (
                <span className="italic text-muted-foreground/60">(parent deleted)</span>
              )}
            </div>
          );
        })()}

        {/* Subtasks section */}
        {(() => {
          const subtasks = childrenOf.get(task.uid) ?? [];
          return (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Subtasks{subtasks.length > 0 ? ` (${subtasks.length})` : ''}
                </p>
                <button
                  onClick={() => onAddSubtask(task)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-3 w-3" />
                  Add subtask
                </button>
              </div>
              {subtasks.length > 0 && (
                <ul>
                  {subtasks.map((child) => (
                    <SubtaskItem
                      key={child.uid}
                      task={child}
                      depth={0}
                      childrenOf={childrenOf}
                      onSelectTask={onSelectTask}
                      onToggleComplete={onToggleComplete}
                    />
                  ))}
                </ul>
              )}
              {subtasks.length === 0 && (
                <p className="text-xs text-muted-foreground">No subtasks yet.</p>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );

  if (fullscreen) {
    return <div className="fixed inset-0 z-50 flex flex-col bg-background">{panel}</div>;
  }

  return panel;
}

// ── Shared-values helper ──────────────────────────────────────────────────────

function computeSharedValues(tasks: Task[]) {
  if (tasks.length === 0) {
    return {
      sharedStatus: null as string | null,
      sharedPriority: undefined as number | null | undefined,
      sharedCategories: [] as string[],
    };
  }
  const first = tasks[0]!;
  const sharedStatus = tasks.every((t) => t.data.status === first.data.status)
    ? first.data.status
    : null;
  // undefined = mixed, null = all have no priority, number = all share same priority
  const sharedPriority = tasks.every((t) => t.data.priority === first.data.priority)
    ? first.data.priority
    : undefined;
  const sharedCategories = first.data.categories.filter((cat) =>
    tasks.every((t) => t.data.categories.includes(cat)),
  );
  return { sharedStatus, sharedPriority, sharedCategories };
}

// ── Multi-task selection panel ────────────────────────────────────────────────

function MultiTaskPanel({
  tasks,
  taskCollections,
  deleting,
  editing,
  moving,
  onOpenBulkEdit,
  onBulkEditImmediate,
  onBulkMove,
  onDelete,
  onClickTask,
  onBack,
}: {
  tasks: Task[];
  taskCollections: Calendar[];
  deleting: boolean;
  editing: boolean;
  moving: boolean;
  onOpenBulkEdit: (field?: TaskBulkEditFieldId) => void;
  onBulkEditImmediate: (config: TaskBulkEditConfig) => void;
  onBulkMove: (collectionUrl: string) => void;
  onDelete: () => void;
  onClickTask: (uid: string) => void;
  onBack: () => void;
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  const busy = deleting || editing || moving;
  const { sharedStatus, sharedPriority, sharedCategories } = computeSharedValues(tasks);
  const hasMixedPriority = sharedPriority === undefined;
  const anyHavePriority = tasks.some((t) => t.data.priority !== null);

  return (
    <div className="bg-card flex flex-col overflow-hidden flex-1 border-l border-border">
      {/* Action header */}
      <div className="flex items-center px-4 py-2 border-b border-border shrink-0 gap-2">
        <button
          onClick={onBack}
          className="md:hidden shrink-0 rounded p-1 text-muted-foreground hover:bg-muted"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="text-xs text-muted-foreground flex-1">{tasks.length} tasks selected</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onOpenBulkEdit()}
            disabled={busy}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <PencilLine className="h-3.5 w-3.5" /> Edit
          </button>

          {taskCollections.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setMoveOpen((o) => !o)}
                disabled={busy}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                Move <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {moveOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMoveOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 w-48 rounded-md border border-border bg-background shadow-lg py-1 text-sm">
                    {taskCollections.map((col) => (
                      <button
                        key={col.id}
                        onClick={() => {
                          setMoveOpen(false);
                          onBulkMove(col.url);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted truncate"
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: col.color || '#6C757D' }}
                        />
                        {col.displayName}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <button
            onClick={onDelete}
            disabled={busy}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      </div>

      {/* Shared values */}
      <div className="px-4 py-3 border-b border-border shrink-0 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Shared
        </p>

        {/* Status */}
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-xs text-muted-foreground">Status</span>
          <span className="flex-1 text-xs">
            {sharedStatus !== null ? (
              (STATUS_LABELS[sharedStatus] ?? sharedStatus)
            ) : (
              <span className="italic text-muted-foreground/60">Mixed</span>
            )}
          </span>
          <button
            onClick={() => onOpenBulkEdit('status')}
            className="text-xs text-primary hover:underline shrink-0"
          >
            Set
          </button>
        </div>

        {/* Priority */}
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-xs text-muted-foreground">Priority</span>
          <span className="flex-1 text-xs">
            {hasMixedPriority ? (
              <span className="italic text-muted-foreground/60">Mixed</span>
            ) : sharedPriority === null ? (
              <span className="text-muted-foreground/60">None</span>
            ) : (
              priorityLabel(sharedPriority)
            )}
          </span>
          <button
            onClick={() => onOpenBulkEdit('priority')}
            className="text-xs text-primary hover:underline shrink-0"
          >
            Set
          </button>
          {anyHavePriority && (
            <button
              onClick={() => onBulkEditImmediate({ field: 'priority', op: 'clear' })}
              className="text-xs text-muted-foreground hover:text-foreground shrink-0"
              title="Clear priority for all selected tasks"
            >
              Clear
            </button>
          )}
        </div>

        {/* Categories */}
        <div className="flex items-start gap-2">
          <span className="w-20 shrink-0 text-xs text-muted-foreground mt-0.5">Categories</span>
          <div className="flex-1 min-w-0">
            {sharedCategories.length > 0 ? (
              <CategoryChips categories={sharedCategories} />
            ) : (
              <span className="text-xs text-muted-foreground/60 italic">None shared</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => onOpenBulkEdit('categories_add')}
              className="text-xs text-primary hover:underline"
            >
              Add
            </button>
            {sharedCategories.length > 0 && (
              <button
                onClick={() =>
                  onBulkEditImmediate({
                    field: 'categories',
                    op: 'remove',
                    values: sharedCategories,
                  })
                }
                className="text-xs text-muted-foreground hover:text-foreground"
                title="Remove shared categories from all selected tasks"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Selected task cards */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
          {tasks.map((task) => {
            const due = dueDateDisplay(task.data.due);
            return (
              <button
                key={task.uid}
                onClick={() => onClickTask(task.uid)}
                className="flex flex-col items-start gap-1.5 p-3 rounded-lg border border-border text-left hover:bg-muted hover:border-primary/30 transition-colors"
              >
                <p className="text-sm font-medium truncate w-full leading-snug">
                  {task.data.summary || '(no title)'}
                </p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {task.data.priority !== null && (
                    <span
                      className={cn(
                        'w-1.5 h-1.5 rounded-full shrink-0',
                        priorityColor(task.data.priority),
                      )}
                    />
                  )}
                  <span className="text-xs text-muted-foreground">
                    {STATUS_LABELS[task.data.status ?? ''] ?? task.data.status}
                  </span>
                  {due && <span className={cn('text-xs', due.className)}>{due.label}</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
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
  const { taskDefaultLayout } = useSettings();

  // ── Persisted UI state ────────────────────────────────────────────────────
  const [layout, setLayout] = useState<Layout>(() =>
    loadPref('dave:tasks:layout', taskDefaultLayout),
  );
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
  const [editingTaskData, setEditingTaskData] = useState<{ task: Task; fullData: TaskJson } | null>(
    null,
  );
  const [createMode, setCreateMode] = useState(false);
  const [defaultCreateCollectionUrl, setDefaultCreateCollectionUrl] = useState<string>('');
  const [subtaskParent, setSubtaskParent] = useState<Task | null>(null);
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<Task | null>(null);
  const [pendingMoveWithChildren, setPendingMoveWithChildren] = useState<{
    data: TaskJson;
    etag: string;
    childCount: number;
  } | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // ── Multi-select state ────────────────────────────────────────────────────
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkEditInitialField, setBulkEditInitialField] = useState<TaskBulkEditFieldId>('status');

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
      setSubtaskParent(null);
      setSelectedUid(result.uid);
      invalidateTasks();
    },
    onError: () => showToast('Failed to create task. Please try again.'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ data, etag }: { data: TaskJson; etag: string; _isCompletion?: boolean }) =>
      updateTask(data.uid, data, etag),
    onSuccess: (result, variables) => {
      if (result.childMoveErrors && result.childMoveErrors.length > 0) {
        showToast(
          `Task moved, but ${result.childMoveErrors.length} subtask(s) could not be moved.`,
        );
      }
      if (variables._isCompletion && variables.data.rrule) {
        const d = result.data;
        if (d.status !== 'COMPLETED') {
          const nextDate = d.due ?? d.dtstart;
          const label = nextDate
            ? new Date(nextDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            : 'next occurrence';
          showToast(`Task advanced to ${label}`);
        } else {
          showToast('All recurring instances complete');
        }
      }
      setEditingTaskData(null);
      setPendingMoveWithChildren(null);
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
    mutationFn: ({
      uid,
      etag,
      deleteChildren,
    }: {
      uid: string;
      etag: string;
      deleteChildren?: boolean;
    }) => deleteTask(uid, etag, deleteChildren),
    onSuccess: (result) => {
      if (result?.childErrors && result.childErrors.length > 0) {
        showToast(
          `Task deleted, but ${result.childErrors.length} subtask(s) could not be deleted.`,
        );
      }
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

  const bulkDeleteMutation = useMutation({
    mutationFn: (tasks: Task[]) => Promise.allSettled(tasks.map((t) => deleteTask(t.uid, t.etag))),
    onSuccess: (results) => {
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const fail = results.filter((r) => r.status === 'rejected').length;
      setShowBulkDelete(false);
      setSelectedUids(new Set());
      setSelectedUid(null);
      showToast(`Deleted ${ok} task${ok !== 1 ? 's' : ''}${fail ? ` (${fail} failed)` : ''}`);
      invalidateTasks();
    },
    onError: () => {
      setShowBulkDelete(false);
      showToast('Bulk delete failed.');
    },
  });

  const bulkEditMutation = useMutation({
    mutationFn: ({ tasks, config }: { tasks: Task[]; config: TaskBulkEditConfig }) =>
      Promise.allSettled(
        tasks.map((task) => {
          const newData = applyTaskBulkEdit(task.data, config);
          return updateTask(task.uid, newData, task.etag);
        }),
      ),
    onSuccess: (results) => {
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const fail = results.filter((r) => r.status === 'rejected').length;
      setShowBulkEdit(false);
      showToast(`Updated ${ok} task${ok !== 1 ? 's' : ''}${fail ? ` (${fail} failed)` : ''}`);
      invalidateTasks();
    },
    onError: () => {
      setShowBulkEdit(false);
      showToast('Bulk edit failed.');
    },
  });

  const bulkMoveMutation = useMutation({
    mutationFn: ({ tasks, collectionUrl }: { tasks: Task[]; collectionUrl: string }) =>
      Promise.allSettled(
        tasks.map((task) => {
          const newData = { ...task.data, collectionUrl };
          return updateTask(task.uid, newData, task.etag);
        }),
      ),
    onSuccess: (results) => {
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const fail = results.filter((r) => r.status === 'rejected').length;
      setSelectedUids(new Set());
      showToast(`Moved ${ok} task${ok !== 1 ? 's' : ''}${fail ? ` (${fail} failed)` : ''}`);
      invalidateTasks();
    },
    onError: () => showToast('Bulk move failed.'),
  });

  const handleToggleComplete = useCallback(
    (task: Task) => {
      const completed = task.data.status !== 'COMPLETED';
      const updated = applyCompletion(task.data, completed);
      updateMutation.mutate({ data: updated, etag: task.etag, _isCompletion: completed });
    },
    [updateMutation],
  );

  const handleKanbanDrop = useCallback(
    (task: Task, targetStatus: string) => {
      const updated = applyStatusChange(task.data, targetStatus);
      updateMutation.mutate({
        data: updated,
        etag: task.etag,
        _isCompletion: targetStatus === 'COMPLETED',
      });
    },
    [updateMutation],
  );

  const handleEdit = useCallback(
    async (task: Task) => {
      // Fetch full task data (including alarms) before opening the edit form.
      try {
        const full = await fetchTask(task.uid);
        setEditingTaskData({ task, fullData: full.data });
      } catch {
        showToast('Failed to load task details.');
      }
    },
    [showToast],
  );

  const handleCreate = useCallback(() => {
    const url =
      loadPref<string>('dave:tasks:lastCollectionUrl', '') || (taskCollections[0]?.url ?? '');
    setDefaultCreateCollectionUrl(url);
    setSubtaskParent(null);
    setCreateMode(true);
  }, [taskCollections]);

  const handleAddSubtask = useCallback((parentTask: Task) => {
    setSubtaskParent(parentTask);
    setCreateMode(true);
  }, []);

  // ── Multi-select callbacks ────────────────────────────────────────────────

  const toggleSelectUid = useCallback((uid: string) => {
    setSelectedUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedUids(new Set()), []);

  const handleEnterMultiSelect = useCallback((task: Task) => {
    setSelectedUids((prev) => new Set([...prev, task.uid]));
  }, []);

  const handleOpenBulkEdit = useCallback((field: TaskBulkEditFieldId = 'status') => {
    setBulkEditInitialField(field);
    setShowBulkEdit(true);
  }, []);

  // ── Trigger initial sync once on mount ───────────────────────────────────
  // The route now awaits the initial Baikal fetch, so invalidating after it
  // resolves ensures the UI reflects tasks that were already on Baikal before
  // the cache was seeded (e.g., after a cache clear or first login).
  useEffect(() => {
    triggerTasksSync()
      .then(() => invalidateTasks())
      .catch(() => {
        /* errors logged server-side */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const { roots, childrenOf, orphanedParentUid, parentOf } = useMemo(
    () => buildTree(allTasks),
    [allTasks],
  );

  // ── Multi-select derived ──────────────────────────────────────────────────
  const isMultiSelect = selectedUids.size > 0;
  const selectedTasks = useMemo(
    () => allTasks.filter((t) => selectedUids.has(t.uid)),
    [allTasks, selectedUids],
  );
  const isTaskSelected = useCallback((uid: string) => selectedUids.has(uid), [selectedUids]);

  const handleBulkEdit = useCallback(
    (config: TaskBulkEditConfig) => {
      bulkEditMutation.mutate({ tasks: selectedTasks, config });
    },
    [bulkEditMutation, selectedTasks],
  );

  const handleBulkMove = useCallback(
    (collectionUrl: string) => {
      bulkMoveMutation.mutate({ tasks: selectedTasks, collectionUrl });
    },
    [bulkMoveMutation, selectedTasks],
  );

  const handleBulkDelete = useCallback(() => {
    bulkDeleteMutation.mutate(selectedTasks);
  }, [bulkDeleteMutation, selectedTasks]);

  // Drop filtered-out items from multi-select when allTasks changes
  useEffect(() => {
    if (selectedUids.size === 0) return;
    const visibleUids = new Set(allTasks.map((t) => t.uid));
    const dropped = [...selectedUids].filter((uid) => !visibleUids.has(uid));
    if (dropped.length > 0) {
      setSelectedUids((prev) => {
        const next = new Set(prev);
        for (const uid of dropped) next.delete(uid);
        return next;
      });
      showToast(
        `${dropped.length} item${dropped.length !== 1 ? 's' : ''} removed from selection because they no longer match the filter`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTasks]);

  const handleEditSave = useCallback(
    (data: TaskJson) => {
      if (!editingTaskData) return;
      const children = childrenOf.get(editingTaskData.task.uid) ?? [];
      const isMove = data.collectionUrl !== editingTaskData.task.collectionUrl;
      if (isMove && children.length > 0) {
        setPendingMoveWithChildren({
          data,
          etag: editingTaskData.task.etag,
          childCount: children.length,
        });
        return;
      }
      updateMutation.mutate({ data, etag: editingTaskData.task.etag });
    },
    [editingTaskData, childrenOf, updateMutation],
  );

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

          {/* Layout toggle — pushed to right; multi-select bar appears below the toolbar */}
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

        {/* Multi-select bar */}
        {isMultiSelect && (
          <div className="px-4 py-1.5 border-b border-border bg-primary/5 flex items-center gap-2 shrink-0">
            <span className="text-xs font-medium text-primary flex-1">
              {selectedUids.size} selected
            </span>
            <button
              onClick={() => setSelectedUids(new Set(allTasks.map((t) => t.uid)))}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              All
            </button>
            <button
              onClick={clearSelection}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              None
            </button>
            <button
              onClick={clearSelection}
              title="Clear selection"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

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
                  orphanedParentUid={orphanedParentUid}
                  selectedUid={selectedUid}
                  onSelect={handleSelect}
                  onToggleComplete={handleToggleComplete}
                  calendarName={collectionNameMap.get(task.collectionUrl)}
                  calendarColor={collectionColorMap.get(task.collectionUrl)}
                  isMultiSelect={isMultiSelect}
                  isSelectedFn={isTaskSelected}
                  onToggleSelect={toggleSelectUid}
                  onEnterMultiSelect={handleEnterMultiSelect}
                  onEdit={handleEdit}
                  onDelete={setDeleteConfirmTask}
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
                        orphanedParentUid={orphanedParentUid}
                        selectedUid={selectedUid}
                        onSelect={handleSelect}
                        onToggleComplete={handleToggleComplete}
                        calendarName={collectionNameMap.get(task.collectionUrl)}
                        calendarColor={collectionColorMap.get(task.collectionUrl)}
                        isMultiSelect={isMultiSelect}
                        isSelectedFn={isTaskSelected}
                        onToggleSelect={toggleSelectUid}
                        onEnterMultiSelect={handleEnterMultiSelect}
                        onEdit={handleEdit}
                        onDelete={setDeleteConfirmTask}
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
                      status={status}
                      title={title}
                      tasks={kanbanColumns.get(status) ?? []}
                      selectedUid={selectedUid}
                      onSelect={handleSelect}
                      onDropTask={handleKanbanDrop}
                      color={headerColor}
                      collectionColorMap={collectionColorMap}
                      childrenOf={childrenOf}
                      parentOf={parentOf}
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
                          status={status}
                          title={title}
                          tasks={kanbanColumns.get(status) ?? []}
                          selectedUid={selectedUid}
                          onSelect={handleSelect}
                          onDropTask={handleKanbanDrop}
                          color={headerColor}
                          collectionColorMap={collectionColorMap}
                          childrenOf={childrenOf}
                          parentOf={parentOf}
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

      {/* Multi-task panel — shown when 2+ tasks are selected */}
      {selectedUids.size >= 2 && !isMobile && (
        <div className="flex shrink-0" style={{ width: panelWidth }}>
          <div
            className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
            onMouseDown={startResize}
            title="Drag to resize"
          />
          <MultiTaskPanel
            tasks={selectedTasks}
            taskCollections={taskCollections}
            deleting={bulkDeleteMutation.isPending}
            editing={bulkEditMutation.isPending}
            moving={bulkMoveMutation.isPending}
            onOpenBulkEdit={handleOpenBulkEdit}
            onBulkEditImmediate={handleBulkEdit}
            onBulkMove={handleBulkMove}
            onDelete={() => setShowBulkDelete(true)}
            onClickTask={(uid) => {
              clearSelection();
              handleSelect(uid);
            }}
            onBack={clearSelection}
          />
        </div>
      )}
      {selectedUids.size >= 2 && isMobile && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <MultiTaskPanel
            tasks={selectedTasks}
            taskCollections={taskCollections}
            deleting={bulkDeleteMutation.isPending}
            editing={bulkEditMutation.isPending}
            moving={bulkMoveMutation.isPending}
            onOpenBulkEdit={handleOpenBulkEdit}
            onBulkEditImmediate={handleBulkEdit}
            onBulkMove={handleBulkMove}
            onDelete={() => setShowBulkDelete(true)}
            onClickTask={(uid) => {
              clearSelection();
              handleSelect(uid);
            }}
            onBack={clearSelection}
          />
        </div>
      )}

      {/* Detail panel */}
      {selectedTask && !editingTaskData && !isMobile && selectedUids.size < 2 && (
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
            onAddSubtask={handleAddSubtask}
            onSelectTask={handleSelect}
            childrenOf={childrenOf}
            parentOf={parentOf}
            fullscreen={false}
          />
        </div>
      )}
      {selectedTask && !editingTaskData && isMobile && selectedUids.size < 2 && (
        <TaskDetailPanel
          task={selectedTask}
          onClose={() => setSelectedUid(null)}
          onEdit={handleEdit}
          onDelete={setDeleteConfirmTask}
          onToggleComplete={handleToggleComplete}
          onAddSubtask={handleAddSubtask}
          onSelectTask={handleSelect}
          childrenOf={childrenOf}
          parentOf={parentOf}
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
            onSave={handleEditSave}
            onDelete={() => setDeleteConfirmTask(editingTaskData.task)}
            onCancel={() => setEditingTaskData(null)}
            allTasks={allTasks}
          />
        </div>
      )}

      {/* Create task modal */}
      {createMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold flex-1">
                {subtaskParent
                  ? `New subtask of "${subtaskParent.data.summary || '(no title)'}"`
                  : 'New task'}
              </h2>
              <button
                onClick={() => {
                  setCreateMode(false);
                  setSubtaskParent(null);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <TaskEditForm
              initial={
                subtaskParent
                  ? {
                      ...emptyTaskJson(subtaskParent.collectionUrl),
                      relations: [{ relatedUid: subtaskParent.uid, reltype: 'PARENT' }],
                    }
                  : emptyTaskJson(defaultCreateCollectionUrl || taskCollections[0]?.url || '')
              }
              calendars={taskCollections}
              isNew={true}
              saving={createMutation.isPending}
              onSave={(data) => createMutation.mutate(data)}
              onCancel={() => {
                setCreateMode(false);
                setSubtaskParent(null);
              }}
              allTasks={allTasks}
            />
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirmTask &&
        (() => {
          const visibleChildren = childrenOf.get(deleteConfirmTask.uid) ?? [];
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-card rounded-lg shadow-xl w-full max-w-sm p-6">
                <h2 className="font-semibold mb-2">Delete task?</h2>
                <p className="text-sm text-muted-foreground mb-2">
                  &ldquo;{deleteConfirmTask.data.summary || '(no title)'}&rdquo; will be permanently
                  deleted.
                </p>
                {visibleChildren.length > 0 && (
                  <p className="text-sm text-muted-foreground mb-4">
                    This task has {visibleChildren.length} subtask
                    {visibleChildren.length !== 1 ? 's' : ''}. You can delete them all or keep them
                    as standalone tasks.
                  </p>
                )}
                <div className="flex gap-2 justify-end flex-wrap">
                  <button
                    onClick={() => setDeleteConfirmTask(null)}
                    className="px-3 py-1.5 text-sm rounded-md border border-input hover:bg-muted"
                  >
                    Cancel
                  </button>
                  {visibleChildren.length > 0 && (
                    <button
                      onClick={() =>
                        deleteMutation.mutate({
                          uid: deleteConfirmTask.uid,
                          etag: deleteConfirmTask.etag,
                          deleteChildren: false,
                        })
                      }
                      disabled={deleteMutation.isPending}
                      className="px-3 py-1.5 text-sm rounded-md border border-destructive text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    >
                      {deleteMutation.isPending ? 'Deleting…' : 'Delete task only'}
                    </button>
                  )}
                  <button
                    onClick={() =>
                      deleteMutation.mutate({
                        uid: deleteConfirmTask.uid,
                        etag: deleteConfirmTask.etag,
                        deleteChildren: visibleChildren.length > 0,
                      })
                    }
                    disabled={deleteMutation.isPending}
                    className="px-3 py-1.5 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                  >
                    {deleteMutation.isPending
                      ? 'Deleting…'
                      : visibleChildren.length > 0
                        ? 'Delete all'
                        : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* Move-with-children confirmation dialog */}
      {pendingMoveWithChildren && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card rounded-lg shadow-xl w-full max-w-sm p-6">
            <h2 className="font-semibold mb-2">Move subtasks too?</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Moving this task will also move its {pendingMoveWithChildren.childCount} subtask
              {pendingMoveWithChildren.childCount !== 1 ? 's' : ''} to the new list. Continue?
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingMoveWithChildren(null)}
                className="px-3 py-1.5 text-sm rounded-md border border-input hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() => updateMutation.mutate(pendingMoveWithChildren)}
                disabled={updateMutation.isPending}
                className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {updateMutation.isPending ? 'Moving…' : 'Move all'}
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
                onClick={() => {
                  setConflictMessage(null);
                  setEditingTaskData(null);
                  invalidateTasks();
                }}
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

      {/* Bulk delete dialog */}
      {showBulkDelete && (
        <BulkDeleteDialog
          count={selectedUids.size}
          noun="task"
          onConfirm={handleBulkDelete}
          onCancel={() => setShowBulkDelete(false)}
          deleting={bulkDeleteMutation.isPending}
        />
      )}

      {/* Bulk edit modal */}
      {showBulkEdit && (
        <TaskBulkEditModal
          count={selectedUids.size}
          initialField={bulkEditInitialField}
          onApply={handleBulkEdit}
          onCancel={() => setShowBulkEdit(false)}
          applying={bulkEditMutation.isPending}
        />
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
