import { useState } from 'react';
import {
  X, ArrowUpAZ, ArrowDownAZ, Sun, Moon, Monitor, List, LayoutGrid, Columns3, Grid, GanttChartSquare,
  AlignLeft, CalendarDays, CalendarClock, CalendarRange,
  BookUser, Calendar, CheckSquare, NotebookPen, ScrollText,
  Info, Eye, EyeOff,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useSettings } from '../contexts/Settings';
import { useIsMobile } from '../hooks/useIsMobile';
import { VIEW_NAV_ITEMS, useViewCapabilities, isViewSupported } from '../hooks/useViewNavItems';
import SegmentedControl from './SegmentedControl';
import type { SortBy, SortDir, ContactSubtitleField, MapService, DarkMode, TaskLayout, NotesView, JournalsView, CalendarTaskDate, CalendarLayerToggle, CalendarDefaultView, HomeView } from '../contexts/Settings';

const LAYER_TOGGLE_OPTIONS = [
  { value: 'on'  as CalendarLayerToggle, label: 'On',  icon: <Eye className="h-3.5 w-3.5" /> },
  { value: 'off' as CalendarLayerToggle, label: 'Off', icon: <EyeOff className="h-3.5 w-3.5" /> },
];

interface SettingsModalProps {
  onClose: () => void;
}

type TabId = 'general' | 'contacts' | 'calendar' | 'tasks' | 'notes' | 'journals';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'general',    label: 'General',    icon: <Info className="h-4 w-4" /> },
  { id: 'contacts',   label: 'Contacts',   icon: <BookUser className="h-4 w-4" /> },
  { id: 'calendar',   label: 'Calendar',   icon: <Calendar className="h-4 w-4" /> },
  { id: 'tasks',      label: 'Tasks',      icon: <CheckSquare className="h-4 w-4" /> },
  { id: 'notes',      label: 'Notes',      icon: <NotebookPen className="h-4 w-4" /> },
  { id: 'journals',   label: 'Journals',   icon: <ScrollText className="h-4 w-4" /> },
];

// A labelled settings row: label on its own line, the control in a div beneath it
// so every control shares the same left edge regardless of label width.
function SettingRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="block text-sm font-medium">{label}</label>
      ) : (
        <span className="block text-sm font-medium">{label}</span>
      )}
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

const SELECT_CLASS =
  'flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const { contactSort, updateContactSort, contactSubtitleField, updateContactSubtitleField, mapService, updateMapService, darkMode, updateDarkMode, taskDefaultLayout, updateTaskDefaultLayout, notesDefaultView, updateNotesDefaultView, journalsDefaultView, updateJournalsDefaultView, calendarTaskDate, updateCalendarTaskDate, calendarShowTasks, updateCalendarShowTasks, calendarShowJournals, updateCalendarShowJournals, calendarDefaultView, updateCalendarDefaultView, homeView, updateHomeView } =
    useSettings();
  const isMobile = useIsMobile();
  const caps = useViewCapabilities();

  const [activeTab, setActiveTab] = useState<TabId>('contacts');
  const [sortBy, setSortBy] = useState<SortBy>(contactSort.sortBy);
  const [sortDir, setSortDir] = useState<SortDir>(contactSort.sortDir);
  const [subtitleField, setSubtitleField] = useState<ContactSubtitleField>(contactSubtitleField);
  const [mapSvc, setMapSvc] = useState<MapService>(mapService);
  const [dm, setDm] = useState<DarkMode>(darkMode);
  const [taskLayout, setTaskLayout] = useState<TaskLayout>(taskDefaultLayout);
  const [notesView, setNotesView] = useState<NotesView>(notesDefaultView);
  const [journalsView, setJournalsView] = useState<JournalsView>(journalsDefaultView);
  const [taskDate, setTaskDate] = useState<CalendarTaskDate>(calendarTaskDate);
  const [showTasks, setShowTasks] = useState<CalendarLayerToggle>(calendarShowTasks);
  const [showJournals, setShowJournals] = useState<CalendarLayerToggle>(calendarShowJournals);
  const [calView, setCalView] = useState<CalendarDefaultView>(calendarDefaultView);
  const [home, setHome] = useState<HomeView>(homeView);

  // Only offer views the account can actually reach. The saved value stays in the
  // list even if its collections went away, so the select never renders blank.
  const homeOptions = VIEW_NAV_ITEMS.filter(
    (item) => !caps.calsLoaded || isViewSupported(item.to, caps) || item.to.slice(1) === home,
  );

  const handleSave = () => {
    updateContactSort({ sortBy, sortDir });
    updateContactSubtitleField(subtitleField);
    updateMapService(mapSvc);
    updateDarkMode(dm);
    updateTaskDefaultLayout(taskLayout);
    updateNotesDefaultView(notesView);
    updateJournalsDefaultView(journalsView);
    updateCalendarTaskDate(taskDate);
    updateCalendarShowTasks(showTasks);
    updateCalendarShowJournals(showJournals);
    updateCalendarDefaultView(calView);
    updateHomeView(home);
    onClose();
  };

  const isDirty =
    sortBy !== contactSort.sortBy ||
    sortDir !== contactSort.sortDir ||
    subtitleField !== contactSubtitleField ||
    mapSvc !== mapService ||
    dm !== darkMode ||
    taskLayout !== taskDefaultLayout ||
    notesView !== notesDefaultView ||
    journalsView !== journalsDefaultView ||
    taskDate !== calendarTaskDate ||
    showTasks !== calendarShowTasks ||
    showJournals !== calendarShowJournals ||
    calView !== calendarDefaultView ||
    home !== homeView;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex flex-col w-full max-w-2xl h-[30rem] max-h-[90vh] mx-4 rounded-lg border border-border bg-card shadow-lg"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
          <h2 id="settings-title" className="text-sm font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body: tab rail + content */}
        <div className={cn('flex-1 min-h-0 flex', isMobile ? 'flex-col' : 'flex-row')}>
          {/* Tab rail — vertical on desktop, horizontal scroll row on mobile */}
          <div
            className={cn(
              'shrink-0',
              isMobile
                ? 'flex flex-row gap-1 overflow-x-auto border-b border-border px-2 py-2'
                : 'flex flex-col gap-0.5 w-44 border-r border-border p-2',
            )}
          >
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors shrink-0',
                  isMobile ? 'whitespace-nowrap' : 'w-full',
                  activeTab === tab.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content pane */}
          <div className="flex-1 min-w-0 overflow-y-auto px-4 py-4 space-y-6">
            {activeTab === 'contacts' && (
              <>
                <SettingRow label="Sort order" htmlFor="contact-sort-by">
                  <select
                    id="contact-sort-by"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortBy)}
                    className={SELECT_CLASS}
                  >
                    <option value="last">Last name</option>
                    <option value="first">First name</option>
                  </select>
                  <button
                    onClick={() => setSortDir('asc')}
                    title="Ascending (A → Z)"
                    aria-label="Sort ascending"
                    className={cn(
                      'rounded-md border p-1.5 transition-colors',
                      sortDir === 'asc'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <ArrowDownAZ className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setSortDir('desc')}
                    title="Descending (Z → A)"
                    aria-label="Sort descending"
                    className={cn(
                      'rounded-md border p-1.5 transition-colors',
                      sortDir === 'desc'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <ArrowUpAZ className="h-4 w-4" />
                  </button>
                </SettingRow>

                <SettingRow label="Contact subtitle" htmlFor="contact-subtitle-field">
                  <select
                    id="contact-subtitle-field"
                    value={subtitleField}
                    onChange={(e) => setSubtitleField(e.target.value as ContactSubtitleField)}
                    className={SELECT_CLASS}
                  >
                    <option value="">Nothing</option>
                    <option value="nickname">Nickname</option>
                    <option value="email">Email</option>
                    <option value="phone">Phone</option>
                    <option value="organization">Organization</option>
                    <option value="title">Title</option>
                  </select>
                </SettingRow>
              </>
            )}

            {activeTab === 'calendar' && (
              <>
                <SettingRow label="Default view">
                  <SegmentedControl<CalendarDefaultView>
                    value={calView}
                    onChange={setCalView}
                    options={[
                      { value: 'dayGridMonth', label: 'Month', icon: <CalendarDays className="h-3.5 w-3.5" /> },
                      { value: 'timeGridWeek', label: 'Week',  icon: <CalendarRange className="h-3.5 w-3.5" /> },
                      { value: 'timeGridDay',  label: 'Day',   icon: <CalendarClock className="h-3.5 w-3.5" /> },
                    ]}
                  />
                </SettingRow>

                <SettingRow label="Map service" htmlFor="map-service">
                  <select
                    id="map-service"
                    value={mapSvc}
                    onChange={(e) => setMapSvc(e.target.value as MapService)}
                    className={SELECT_CLASS}
                  >
                    <option value="osm">OpenStreetMap</option>
                    <option value="google">Google Maps</option>
                    <option value="apple">Apple Maps</option>
                  </select>
                </SettingRow>

                <SettingRow label="Tasks by">
                  <SegmentedControl<CalendarTaskDate>
                    value={taskDate}
                    onChange={setTaskDate}
                    options={[
                      { value: 'due',     label: 'Due',   icon: <CalendarClock className="h-3.5 w-3.5" />, title: 'Position tasks by due date' },
                      { value: 'dtstart', label: 'Start', icon: <CalendarDays className="h-3.5 w-3.5" />, title: 'Position tasks by start date' },
                      { value: 'span',    label: 'Span',  icon: <CalendarRange className="h-3.5 w-3.5" />, title: 'Span tasks from start to due date' },
                    ]}
                  />
                </SettingRow>
              </>
            )}

            {activeTab === 'tasks' && (
              <>
                <SettingRow label="Default view">
                  <SegmentedControl<TaskLayout>
                    value={taskLayout}
                    onChange={setTaskLayout}
                    options={[
                      { value: 'list',    label: 'List',    icon: <List className="h-3.5 w-3.5" /> },
                      { value: 'compact', label: 'Compact', icon: <LayoutGrid className="h-3.5 w-3.5" /> },
                      { value: 'kanban',  label: 'Kanban',  icon: <Columns3 className="h-3.5 w-3.5" /> },
                      { value: 'gantt',   label: 'Gantt',   icon: <GanttChartSquare className="h-3.5 w-3.5" /> },
                    ]}
                  />
                </SettingRow>
                <SettingRow label="Show on calendar">
                  <SegmentedControl<CalendarLayerToggle>
                    value={showTasks}
                    onChange={setShowTasks}
                    options={LAYER_TOGGLE_OPTIONS}
                  />
                </SettingRow>
              </>
            )}

            {activeTab === 'notes' && (
              <SettingRow label="Default view">
                <SegmentedControl<NotesView>
                  value={notesView}
                  onChange={setNotesView}
                  options={[
                    { value: 'list', label: 'List', icon: <List className="h-3.5 w-3.5" /> },
                    { value: 'grid', label: 'Grid', icon: <Grid className="h-3.5 w-3.5" /> },
                  ]}
                />
              </SettingRow>
            )}

            {activeTab === 'journals' && (
              <>
                <SettingRow label="Default view">
                  <SegmentedControl<JournalsView>
                    value={journalsView}
                    onChange={setJournalsView}
                    options={[
                      { value: 'timeline', label: 'Timeline', icon: <AlignLeft className="h-3.5 w-3.5" /> },
                      { value: 'list',     label: 'List',     icon: <List className="h-3.5 w-3.5" /> },
                      { value: 'calendar', label: 'Calendar', icon: <CalendarDays className="h-3.5 w-3.5" /> },
                    ]}
                  />
                </SettingRow>
                <SettingRow label="Show on calendar">
                  <SegmentedControl<CalendarLayerToggle>
                    value={showJournals}
                    onChange={setShowJournals}
                    options={LAYER_TOGGLE_OPTIONS}
                  />
                </SettingRow>
              </>
            )}

            {activeTab === 'general' && (
              <>
                <SettingRow label="Theme">
                  <SegmentedControl<DarkMode>
                    value={dm}
                    onChange={setDm}
                    options={[
                      { value: 'light',  label: 'Light',  icon: <Sun className="h-3.5 w-3.5" /> },
                      { value: 'system', label: 'System', icon: <Monitor className="h-3.5 w-3.5" /> },
                      { value: 'dark',   label: 'Dark',   icon: <Moon className="h-3.5 w-3.5" /> },
                    ]}
                  />
                </SettingRow>

                <SettingRow label="Home page" htmlFor="home-view">
                  <select
                    id="home-view"
                    value={home}
                    onChange={(e) => setHome(e.target.value as HomeView)}
                    className={SELECT_CLASS}
                  >
                    {homeOptions.map((item) => (
                      <option key={item.to} value={item.to.slice(1)}>{item.label}</option>
                    ))}
                  </select>
                </SettingRow>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3 shrink-0">
          <button
            onClick={onClose}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!isDirty}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm text-primary-foreground transition-colors',
              isDirty ? 'bg-primary hover:bg-primary/90' : 'bg-primary/40 cursor-not-allowed',
            )}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
