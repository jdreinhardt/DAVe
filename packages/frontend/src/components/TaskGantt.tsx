import { useState, useRef, useMemo, useEffect, useLayoutEffect, useCallback } from 'react';
import {
  CalendarOff,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Repeat,
} from 'lucide-react';
import type { Task, TaskJson } from '@dave/shared';
import { cn } from '../lib/utils';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  GANTT_ZOOMS,
  ROW_H,
  HEADER_H,
  INDENT_PX,
  MAX_INDENT_DEPTH,
  MILESTONE_PX,
  SIDEBAR_W,
  computeWindow,
  localTodayStr,
  dateToX,
  xToDateStr,
  xToDayIndex,
  pxToDayDelta,
  todayX,
  taskGanttShape,
  layoutBar,
  buildHeaderBands,
  flattenGanttRows,
  computeBarDrag,
  computeScheduleDrop,
  computeRangeSchedule,
} from '../lib/gantt';
import type { GanttZoom, GanttWindow, GanttRow, BarLayout, GanttShape, DragMode } from '../lib/gantt';
import { addDaysToDateStr } from '../lib/calendarLayers';

/** Same wire format the kanban board uses, so a task can be dragged from either. */
const TASK_DND_TYPE = 'application/dave-task';

/** Pointer travel before a press becomes a drag rather than a click. */
const DRAG_DEAD_ZONE_PX = 3;

// Spelled out rather than CSS-capitalized: text-transform doesn't reach the
// accessible name, so a `capitalize` class would leave these as "day"/"week".
const ZOOM_LABELS: Record<GanttZoom, string> = { day: 'Day', week: 'Week', month: 'Month' };

interface ActiveDrag {
  uid: string;
  mode: DragMode;
  startX: number;
  deltaDays: number;
  moved: boolean;
}

/** Sweeping out a start→due range on an unscheduled task's empty track. */
interface RangeDrag {
  uid: string;
  startX: number;
  anchorDay: number;
  currentDay: number;
  moved: boolean;
}

// CalDAV servers store colors as #RRGGBBAA. Strip alpha so we can append our own opacity suffix.
function hex6(color: string): string {
  if (color.startsWith('#') && color.length === 9) return color.slice(0, 7);
  return color;
}

const DEFAULT_COLOR = '#3b82f6';

interface TaskGanttProps {
  roots: Task[];
  childrenOf: Map<string, Task[]>;
  orphanedParentUid: Map<string, string>;
  selectedUid: string | null;
  onSelect: (uid: string) => void;
  collectionColorMap: Map<string, string>;
  zoom: GanttZoom;
  onZoomChange: (zoom: GanttZoom) => void;
  onCommitDates: (task: Task, data: TaskJson) => void;
  /** Clear a task's dates. Owned by the page so the button and the Backspace
      hotkey take the same path, toast included. */
  onUnschedule: (task: Task) => void;
  dragEnabled: boolean;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ZoomButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded px-2 py-1 text-xs transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function GanttHeaderBands({
  win,
  todayStr,
  sidebarW,
}: {
  win: GanttWindow;
  todayStr: string;
  sidebarW: number;
}) {
  const { top, bottom } = useMemo(() => buildHeaderBands(win, todayStr), [win, todayStr]);
  const bandH = HEADER_H / 2;

  return (
    <div className="relative shrink-0" style={{ width: win.totalWidth, height: HEADER_H }}>
      {top.map((cell) => (
        <div
          key={cell.key}
          className="absolute top-0 flex items-center border-r border-border text-xs font-medium"
          style={{ left: cell.x, width: cell.width, height: bandH }}
        >
          {/* Sticky so a month/year label stays readable while its run is partly
              scrolled past — offset to clear the frozen task column. The clipping
              lives on the label, not the cell: an overflow ancestor would become
              the sticky scroll container and pin the label to the cell instead. */}
          <span
            className="sticky truncate px-1.5"
            style={{ left: sidebarW, maxWidth: cell.width }}
          >
            {cell.label}
          </span>
        </div>
      ))}
      {bottom.map((cell) => (
        <div
          key={cell.key}
          className={cn(
            'absolute flex items-center justify-center overflow-hidden border-r border-t border-border text-[10px] whitespace-nowrap',
            cell.isToday ? 'font-semibold text-primary' : 'text-muted-foreground',
            cell.isWeekend && 'bg-muted/40',
          )}
          style={{ left: cell.x, width: cell.width, top: bandH, height: bandH }}
        >
          {cell.label}
        </div>
      ))}
    </div>
  );
}

function GanttSidebarRow({
  row,
  isOrphan,
  isSelected,
  isUnscheduled,
  draggable,
  onSelect,
  onToggleCollapse,
  onDragStart,
  onUnschedule,
}: {
  row: GanttRow;
  isOrphan: boolean;
  isSelected: boolean;
  isUnscheduled: boolean;
  draggable: boolean;
  onUnschedule: () => void;
  onSelect: () => void;
  onToggleCollapse: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const { task, depth, childCount, isCollapsed } = row;
  const done = task.data.status === 'COMPLETED';
  const cancelled = task.data.status === 'CANCELLED';

  return (
    <div
      data-uid={task.uid}
      data-gantt-unscheduled={isUnscheduled ? 'true' : undefined}
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onSelect}
      title={task.data.summary || '(No title)'}
      className={cn(
        'group flex h-full cursor-pointer items-center gap-1 overflow-hidden border-b border-r border-border pr-2 text-sm',
        isSelected ? 'bg-primary/10' : 'hover:bg-muted/50',
        (done || cancelled) && 'opacity-45',
        draggable && 'cursor-grab',
      )}
      style={{ paddingLeft: 6 + Math.min(depth, MAX_INDENT_DEPTH) * INDENT_PX }}
    >
      {childCount > 0 ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? 'Expand subtasks' : 'Collapse subtasks'}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      ) : (
        <span className="w-[18px] shrink-0" />
      )}
      <span className={cn('truncate', cancelled && 'line-through')}>
        {task.data.summary || '(No title)'}
      </span>
      {isCollapsed && childCount > 0 && (
        <span className="shrink-0 text-xs text-muted-foreground">{childCount}</span>
      )}
      {isOrphan && <span className="shrink-0 text-xs text-muted-foreground">↑</span>}
      {/* The two states share this slot and are mutually exclusive: an undated row
          says so, a dated one offers to become undated. A slashed *calendar* rather
          than an ✕ so it reads as "clear the dates", not "delete the task". */}
      {isUnscheduled ? (
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">Unscheduled</span>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onUnschedule();
          }}
          title="Unschedule"
          aria-label={`Unschedule ${task.data.summary || 'task'}`}
          data-testid="gantt-unschedule"
          className={cn(
            // Revealed on hover, but also whenever the row is selected — hover
            // doesn't exist on touch, and selection is reachable there.
            'ml-auto shrink-0 rounded p-0.5 text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100',
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <CalendarOff className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Below this bar width the summary won't fit inside, so it's drawn alongside instead. */
const INLINE_LABEL_MIN_PX = 56;

/**
 * Where the bar should appear mid-drag. Purely visual — the authoritative dates
 * are computed once on release by computeBarDrag, so this only has to agree with
 * it on direction and magnitude.
 */
function previewBar(bar: BarLayout, drag: ActiveDrag, pxPerDay: number): BarLayout {
  const shift = drag.deltaDays * pxPerDay;
  if (drag.mode === 'resize-start') {
    // Clamped to a one-day floor, matching computeBarDrag's own clamp.
    const dx = Math.min(shift, bar.width - pxPerDay);
    return { ...bar, x: bar.x + dx, width: bar.width - dx };
  }
  if (drag.mode === 'resize-end') {
    return { ...bar, width: Math.max(pxPerDay, bar.width + shift) };
  }
  return { ...bar, x: bar.x + shift };
}

function GanttBar({
  task,
  shape,
  bar,
  color,
  isSelected,
  isDragging,
  dragEnabled,
  sidebarW,
  onSelect,
  onDragHandleDown,
  onDragHandleMove,
  onDragHandleUp,
}: {
  task: Task;
  shape: GanttShape;
  bar: BarLayout;
  color: string;
  isSelected: boolean;
  isDragging: boolean;
  dragEnabled: boolean;
  sidebarW: number;
  onSelect: () => void;
  onDragHandleDown: (e: React.PointerEvent, mode: DragMode) => void;
  onDragHandleMove: (e: React.PointerEvent) => void;
  onDragHandleUp: (e: React.PointerEvent) => void;
}) {
  const done = task.data.status === 'COMPLETED';
  const cancelled = task.data.status === 'CANCELLED';
  const recurring = Boolean(task.data.rrule);
  const label = task.data.summary || '(No title)';
  const when =
    shape.kind === 'span' ? `${shape.startStr} → ${shape.endStr}` : shape.kind === 'milestone' ? shape.dateStr : '';

  if (bar.offWindow) {
    const Icon = bar.offWindow === 'before' ? ChevronLeft : ChevronRight;
    // The button is the sticky element, not its wrapper: an absolute offset would
    // place it wherever that date is — i.e. scrolled out of view, which is exactly
    // the case this indicator exists to flag. Laying it out at the near or far end
    // of the row and sticking it to the matching viewport edge keeps it on screen.
    // The 'before' edge clears the frozen task column.
    return (
      <div
        className={cn(
          'pointer-events-none absolute inset-0 flex items-center',
          bar.offWindow === 'after' && 'justify-end',
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          title={`${label} (${when})`}
          aria-label={`${label}, outside the visible range`}
          data-testid="gantt-offwindow"
          className="pointer-events-auto sticky px-1 text-muted-foreground hover:text-foreground"
          style={bar.offWindow === 'before' ? { left: sidebarW } : { right: 0 }}
        >
          <Icon className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // Move and pointerup live on the mark itself because pointer capture routes all
  // subsequent events for that pointer back to the element that captured it.
  const common = {
    'data-uid': task.uid,
    onClick: onSelect,
    title: `${label} (${when})`,
    onPointerMove: onDragHandleMove,
    onPointerUp: onDragHandleUp,
    onPointerCancel: onDragHandleUp,
  };
  const dimmed = done || cancelled;
  // Labels that don't fit inside sit to the right of the mark, in body text colour.
  const externalLabel = shape.kind === 'milestone' || bar.width < INLINE_LABEL_MIN_PX;

  return (
    <>
      {shape.kind === 'milestone' ? (
        <div
          {...common}
          data-gantt-shape="milestone"
          data-gantt-date={shape.dateStr}
          onPointerDown={(e) => onDragHandleDown(e, 'milestone')}
          className={cn(
            'absolute top-1/2 rotate-45 border border-black/20',
            isSelected && 'ring-2 ring-primary',
            dimmed && !isDragging && 'opacity-45',
            isDragging && 'z-20 shadow-lg',
            dragEnabled ? 'cursor-grab' : 'cursor-pointer',
          )}
          style={{
            left: bar.x,
            width: MILESTONE_PX,
            height: MILESTONE_PX,
            marginTop: -MILESTONE_PX / 2,
            backgroundColor: color,
            // Leave both scroll axes to the browser: pointer events fire for
            // touch, and a touch pan over a mark must scroll, not drag.
            touchAction: 'pan-x pan-y',
          }}
        />
      ) : (
        <div
          {...common}
          data-gantt-shape="span"
          data-gantt-start={shape.kind === 'span' ? shape.startStr : undefined}
          data-gantt-end={shape.kind === 'span' ? shape.endStr : undefined}
          onPointerDown={(e) => onDragHandleDown(e, 'move')}
          className={cn(
            'group absolute top-1/2 flex h-5 -translate-y-1/2 items-center gap-1 overflow-hidden px-1.5 text-[11px] text-white',
            bar.clippedLeft ? 'rounded-l-none' : 'rounded-l',
            bar.clippedRight ? 'rounded-r-none' : 'rounded-r',
            isSelected && 'ring-2 ring-primary',
            dimmed && !isDragging && 'opacity-45',
            isDragging && 'z-20 shadow-lg',
            dragEnabled ? 'cursor-grab' : 'cursor-pointer',
          )}
          style={{ left: bar.x, width: bar.width, backgroundColor: color, touchAction: 'pan-x pan-y' }}
        >
          {bar.clippedLeft && <span className="absolute inset-y-0 left-0 w-[3px] bg-primary" />}
          {bar.clippedRight && <span className="absolute inset-y-0 right-0 w-[3px] bg-primary" />}
          {recurring && !externalLabel && <Repeat className="h-3 w-3 shrink-0" aria-label="Recurring" />}
          {!externalLabel && <span className={cn('truncate', cancelled && 'line-through')}>{label}</span>}
          {dragEnabled && (
            <>
              <span
                data-testid="gantt-resize-start"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onDragHandleDown(e, 'resize-start');
                }}
                className="absolute inset-y-0 left-0 w-1.5 cursor-col-resize bg-black/25 opacity-0 group-hover:opacity-100"
              />
              <span
                data-testid="gantt-resize-end"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onDragHandleDown(e, 'resize-end');
                }}
                className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize bg-black/25 opacity-0 group-hover:opacity-100"
              />
            </>
          )}
        </div>
      )}

      {externalLabel && (
        <span
          onClick={onSelect}
          title={`${label} (${when})`}
          className={cn(
            'pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center gap-1 whitespace-nowrap text-[11px] text-foreground',
            dimmed && 'opacity-45',
            cancelled && 'line-through',
          )}
          style={{ left: bar.x + bar.width + 4 }}
        >
          {recurring && <Repeat className="h-3 w-3 shrink-0" aria-label="Recurring" />}
          {label}
        </span>
      )}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * The Tasks page's Gantt layout: a frozen task-tree column beside a scrollable
 * timeline. Rendered as one scroll container with sticky children rather than two
 * synced containers — the latter jitters on fast horizontal scroll.
 */
export default function TaskGantt({
  roots,
  childrenOf,
  orphanedParentUid,
  selectedUid,
  onSelect,
  collectionColorMap,
  zoom,
  onZoomChange,
  onCommitDates,
  onUnschedule,
  dragEnabled,
}: TaskGanttProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const isMobile = useIsMobile();
  // A 240px task column would leave almost no timeline on a phone, so it starts
  // closed there; bars carry their own labels either way.
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [rangeDrag, setRangeDrag] = useState<RangeDrag | null>(null);
  const [dropHoverDay, setDropHoverDay] = useState<number | null>(null);

  // The chart anchors on the date the user sees; recomputing per render would
  // re-anchor the window if the tab is left open across midnight, which is fine.
  const todayStr = useMemo(() => localTodayStr(), []);
  const win = useMemo(() => computeWindow(todayStr, zoom, page), [todayStr, zoom, page]);
  const rows = useMemo(() => flattenGanttRows(roots, childrenOf, collapsed), [roots, childrenOf, collapsed]);

  const sidebarW = sidebarOpen ? SIDEBAR_W : 0;
  const todayOffset = todayX(win, todayStr);

  const toggleCollapse = useCallback((uid: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }, []);

  /** Scroll so a date sits about a third in from the left edge. */
  const scrollToDate = useCallback(
    (dateStr: string, behavior: ScrollBehavior = 'auto') => {
      const el = scrollRef.current;
      if (!el) return;
      const target = dateToX(win, dateStr) - (el.clientWidth - sidebarW) / 3;
      el.scrollTo({ left: Math.max(0, target), behavior });
    },
    [win, sidebarW],
  );

  // Open on today. Runs once per mount; paging and zoom handle their own scrolling.
  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (didInitialScroll.current) return;
    didInitialScroll.current = true;
    scrollToDate(todayStr);
  }, [scrollToDate, todayStr]);

  // Keep the left-most visible date put across a zoom change, so zooming reads as
  // zooming rather than jumping somewhere else in the timeline.
  const anchorDate = useRef<string | null>(null);
  const prevZoom = useRef(zoom);
  if (prevZoom.current !== zoom) {
    const el = scrollRef.current;
    anchorDate.current = el ? xToDateStr(computeWindow(todayStr, prevZoom.current, page), el.scrollLeft) : null;
    prevZoom.current = zoom;
  }
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !anchorDate.current) return;
    el.scrollLeft = Math.max(0, dateToX(win, anchorDate.current));
    anchorDate.current = null;
  }, [win]);

  const goToday = useCallback(() => {
    setPage(0);
    // The window only changes when page was non-zero; scroll after it settles.
    requestAnimationFrame(() => scrollToDate(todayStr, 'smooth'));
  }, [scrollToDate, todayStr]);

  // ── Bar drag (move / resize) ──────────────────────────────────────────────
  // Pointer events with capture, mirroring the detail panel's resize handle. No
  // mutation fires while the pointer is down — the bar is drawn from the local
  // deltaDays and only commits on release, which is what keeps the drag smooth.

  const dragRef = useRef<ActiveDrag | null>(null);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setActiveDrag(null);
  }, []);

  const handleDragStart = useCallback(
    (e: React.PointerEvent, task: Task, mode: DragMode) => {
      // Pointer events fire for touch too, so useIsMobile alone wouldn't keep a
      // touch pan from dragging bars on a touchscreen laptop.
      if (!dragEnabled || e.pointerType === 'touch' || e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const drag: ActiveDrag = { uid: task.uid, mode, startX: e.clientX, deltaDays: 0, moved: false };
      dragRef.current = drag;
      setActiveDrag(drag);
    },
    [dragEnabled],
  );

  const handleDragMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      // Small dead zone so a click still reads as a selection, not a zero-day drag.
      if (!drag.moved && Math.abs(dx) < DRAG_DEAD_ZONE_PX) return;
      const next = { ...drag, moved: true, deltaDays: pxToDayDelta(dx, win.pxPerDay) };
      dragRef.current = next;
      setActiveDrag(next);
    },
    [win.pxPerDay],
  );

  // A completed drag is still followed by a click event; selection stays on click
  // (so taps work where pointerdown bails out) and that one click is swallowed.
  const suppressClick = useRef(false);

  const handleDragEnd = useCallback(
    (_e: React.PointerEvent, task: Task) => {
      const drag = dragRef.current;
      endDrag();
      // Capture is released implicitly on pointerup/pointercancel, so there is
      // nothing to undo here beyond clearing our own state.
      if (!drag || !drag.moved || drag.deltaDays === 0) return;
      suppressClick.current = true;
      const next = computeBarDrag(task.data, drag.mode, drag.deltaDays);
      if (next) onCommitDates(task, next);
    },
    [endDrag, onCommitDates],
  );

  const handleBarClick = useCallback(
    (uid: string) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      onSelect(uid);
    },
    [onSelect],
  );

  // Escape abandons an in-flight drag without writing anything.
  useEffect(() => {
    if (!activeDrag) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') endDrag();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeDrag, endDrag]);

  // ── Drop to schedule ──────────────────────────────────────────────────────
  // HTML5 DnD rather than pointer events: this is a cross-container drag, and the
  // wire format matches the kanban board's so the two are interchangeable sources.

  const dragCounter = useRef(0);

  /** Which day column a viewport x lands on. Shared by the drop and sweep paths. */
  const dayFromClientX = useCallback(
    (clientX: number): number | null => {
      const el = bodyRef.current;
      if (!el) return null;
      // The ref sits on the timeline-width element, so this is already content-relative.
      return xToDayIndex(win, clientX - el.getBoundingClientRect().left);
    },
    [win],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(TASK_DND_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropHoverDay(dayFromClientX(e.clientX));
    },
    [dayFromClientX],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      dragCounter.current = 0;
      setDropHoverDay(null);
      const raw = e.dataTransfer.getData(TASK_DND_TYPE);
      if (!raw) return;
      e.preventDefault();
      const day = dayFromClientX(e.clientX);
      if (day === null) return;
      let task: Task;
      try {
        task = JSON.parse(raw) as Task;
      } catch {
        return;
      }
      onCommitDates(task, computeScheduleDrop(task.data, addDaysToDateStr(win.startStr, day)));
    },
    [dayFromClientX, onCommitDates, win.startStr],
  );

  // ── Sweep out a range on an unscheduled row ───────────────────────────────
  // The other half of scheduling: dragging from the task column drops a one-day
  // span, while dragging across the empty track sets both dates in one gesture.

  const rangeRef = useRef<RangeDrag | null>(null);

  const handleRangeStart = useCallback(
    (e: React.PointerEvent, task: Task) => {
      if (!dragEnabled || e.pointerType === 'touch' || e.button !== 0) return;
      const day = dayFromClientX(e.clientX);
      if (day === null) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const drag: RangeDrag = { uid: task.uid, startX: e.clientX, anchorDay: day, currentDay: day, moved: false };
      rangeRef.current = drag;
      setRangeDrag(drag);
    },
    [dragEnabled, dayFromClientX],
  );

  const handleRangeMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = rangeRef.current;
      if (!drag) return;
      // Same dead zone as the bar drag, so a click still reads as a click.
      if (!drag.moved && Math.abs(e.clientX - drag.startX) < DRAG_DEAD_ZONE_PX) return;
      const day = dayFromClientX(e.clientX);
      if (day === null) return;
      const next = { ...drag, moved: true, currentDay: day };
      rangeRef.current = next;
      setRangeDrag(next);
    },
    [dayFromClientX],
  );

  const handleRangeEnd = useCallback(
    (task: Task) => {
      const drag = rangeRef.current;
      rangeRef.current = null;
      setRangeDrag(null);
      if (!drag) return;
      if (!drag.moved) {
        // A press without travel is a selection, not a zero-length schedule.
        onSelect(task.uid);
        return;
      }
      onCommitDates(
        task,
        computeRangeSchedule(
          task.data,
          addDaysToDateStr(win.startStr, drag.anchorDay),
          addDaysToDateStr(win.startStr, drag.currentDay),
        ),
      );
    },
    [onSelect, onCommitDates, win.startStr],
  );

  // Escape abandons an in-flight range sweep without writing anything.
  useEffect(() => {
    if (!rangeDrag) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      rangeRef.current = null;
      setRangeDrag(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rangeDrag]);

  const handleZoom = useCallback(
    (next: GanttZoom) => {
      // A page index means a different span at each zoom, so it can't carry over.
      setPage(0);
      onZoomChange(next);
    },
    [onZoomChange],
  );

  const offWindowCount = useMemo(
    () => rows.filter((r) => layoutBar(win, taskGanttShape(r.task.data))?.offWindow).length,
    [rows, win],
  );

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
        No tasks to chart.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Sub-toolbar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? 'Hide task list' : 'Show task list'}
          aria-label={sidebarOpen ? 'Hide task list' : 'Show task list'}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => setPage((p) => p - 1)}
          title="Previous"
          aria-label="Previous"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={goToday}
          className="rounded-md border border-input px-2 py-1 text-xs hover:bg-muted"
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => setPage((p) => p + 1)}
          title="Next"
          aria-label="Next"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        {offWindowCount > 0 && (
          <span className="ml-2 text-xs text-muted-foreground">{offWindowCount} off-screen</span>
        )}

        <div className="ml-auto flex items-center gap-0.5 rounded-md border border-input p-0.5">
          {GANTT_ZOOMS.map((z) => (
            <ZoomButton key={z} active={zoom === z} label={ZOOM_LABELS[z]} onClick={() => handleZoom(z)} />
          ))}
        </div>
      </div>

      {/* Chart */}
      <div ref={scrollRef} data-testid="gantt-chart" className="flex-1 overflow-auto">
        <div style={{ width: sidebarW + win.totalWidth }}>
          {/* Header */}
          <div className="sticky top-0 z-20 flex bg-background" style={{ height: HEADER_H }}>
            {sidebarOpen && (
              <div
                className="sticky left-0 z-30 shrink-0 border-b border-r border-border bg-background"
                style={{ width: SIDEBAR_W }}
              />
            )}
            <div className="border-b border-border">
              <GanttHeaderBands win={win} todayStr={todayStr} sidebarW={sidebarW} />
            </div>
          </div>

          {/* Body */}
          <div className="relative flex" style={{ height: rows.length * ROW_H }}>
            {sidebarOpen && (
              <div
                className="sticky left-0 z-10 shrink-0 bg-background"
                style={{ width: SIDEBAR_W }}
              >
                {rows.map((row) => {
                  const unscheduled = taskGanttShape(row.task.data).kind === 'none';
                  return (
                    <div key={row.task.uid} style={{ height: ROW_H }}>
                      <GanttSidebarRow
                        row={row}
                        isOrphan={orphanedParentUid.has(row.task.uid)}
                        isSelected={selectedUid === row.task.uid}
                        isUnscheduled={unscheduled}
                        // Only undated tasks are drag sources — a dated one is
                        // rescheduled by dragging its bar instead.
                        draggable={dragEnabled && unscheduled}
                        onSelect={() => onSelect(row.task.uid)}
                        onToggleCollapse={() => toggleCollapse(row.task.uid)}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(TASK_DND_TYPE, JSON.stringify(row.task));
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onUnschedule={() => onUnschedule(row.task)}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            <div
              ref={bodyRef}
              className="relative"
              style={{ width: win.totalWidth }}
              onDragOver={handleDragOver}
              onDragEnter={(e) => {
                if (!e.dataTransfer.types.includes(TASK_DND_TYPE)) return;
                // Counter rather than a boolean: bars and labels inside the body
                // fire their own enter/leave pairs, which would flicker the hint.
                dragCounter.current += 1;
              }}
              onDragLeave={() => {
                dragCounter.current -= 1;
                if (dragCounter.current <= 0) {
                  dragCounter.current = 0;
                  setDropHoverDay(null);
                }
              }}
              onDrop={handleDrop}
            >
              {/* Gridlines + weekend shading */}
              <GanttGrid win={win} todayStr={todayStr} height={rows.length * ROW_H} />

              {dropHoverDay !== null && (
                <div
                  data-testid="gantt-drop-hint"
                  className="pointer-events-none absolute inset-y-0 z-10 bg-primary/20"
                  style={{ left: dropHoverDay * win.pxPerDay, width: win.pxPerDay }}
                />
              )}

              {todayOffset !== null && (
                <div
                  data-testid="gantt-today-line"
                  className="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary/60"
                  style={{ left: todayOffset }}
                />
              )}

              {rows.map((row) => {
                const shape = taskGanttShape(row.task.data);
                const bar = layoutBar(win, shape);
                const drag = activeDrag?.uid === row.task.uid ? activeDrag : null;
                const sweep = rangeDrag?.uid === row.task.uid ? rangeDrag : null;
                // Only an undated row has a free track to sweep a range across.
                const sweepable = dragEnabled && shape.kind === 'none';
                return (
                  <div
                    key={row.task.uid}
                    className={cn(
                      'relative border-b border-border/50',
                      sweepable && 'cursor-crosshair',
                    )}
                    style={{ height: ROW_H, touchAction: 'pan-x pan-y' }}
                    onPointerDown={sweepable ? (e) => handleRangeStart(e, row.task) : undefined}
                    onPointerMove={sweepable ? handleRangeMove : undefined}
                    onPointerUp={sweepable ? () => handleRangeEnd(row.task) : undefined}
                    onPointerCancel={sweepable ? () => handleRangeEnd(row.task) : undefined}
                  >
                    {sweep?.moved && (
                      // Previews the bar it is about to become — same colour, dashed
                      // and translucent to read as pending rather than committed.
                      <div
                        data-testid="gantt-range-preview"
                        className="pointer-events-none absolute top-1/2 h-5 -translate-y-1/2 rounded border-2 border-dashed opacity-70"
                        style={{
                          left: Math.min(sweep.anchorDay, sweep.currentDay) * win.pxPerDay,
                          width: (Math.abs(sweep.currentDay - sweep.anchorDay) + 1) * win.pxPerDay,
                          backgroundColor: `${hex6(collectionColorMap.get(row.task.collectionUrl) ?? DEFAULT_COLOR)}66`,
                          borderColor: hex6(collectionColorMap.get(row.task.collectionUrl) ?? DEFAULT_COLOR),
                        }}
                      />
                    )}
                    {bar && (
                      <GanttBar
                        task={row.task}
                        shape={shape}
                        bar={drag ? previewBar(bar, drag, win.pxPerDay) : bar}
                        color={hex6(collectionColorMap.get(row.task.collectionUrl) ?? DEFAULT_COLOR)}
                        isSelected={selectedUid === row.task.uid}
                        isDragging={Boolean(drag)}
                        dragEnabled={dragEnabled}
                        sidebarW={sidebarW}
                        onSelect={() => handleBarClick(row.task.uid)}
                        onDragHandleDown={(e, mode) => handleDragStart(e, row.task, mode)}
                        onDragHandleMove={handleDragMove}
                        onDragHandleUp={(e) => handleDragEnd(e, row.task)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Vertical rules and weekend tint, drawn from the header's bottom band so the two always agree. */
function GanttGrid({ win, todayStr, height }: { win: GanttWindow; todayStr: string; height: number }) {
  const { bottom } = useMemo(() => buildHeaderBands(win, todayStr), [win, todayStr]);
  return (
    <div className="pointer-events-none absolute inset-0" style={{ height }}>
      {bottom.map((cell) => (
        <div
          key={cell.key}
          className={cn('absolute inset-y-0 border-r border-border/40', cell.isWeekend && 'bg-muted/30')}
          style={{ left: cell.x, width: cell.width }}
        />
      ))}
    </div>
  );
}
