import { useState } from 'react';
import { X, ArrowUpAZ, ArrowDownAZ, Sun, Moon, Monitor, List, LayoutGrid, Columns3, Grid, AlignLeft, CalendarDays } from 'lucide-react';
import { cn } from '../lib/utils';
import { useSettings } from '../contexts/Settings';
import type { SortBy, SortDir, ContactSubtitleField, MapService, DarkMode, TaskLayout, NotesView, JournalsView } from '../contexts/Settings';

interface SettingsModalProps {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const { contactSort, updateContactSort, contactSubtitleField, updateContactSubtitleField, mapService, updateMapService, darkMode, updateDarkMode, taskDefaultLayout, updateTaskDefaultLayout, notesDefaultView, updateNotesDefaultView, journalsDefaultView, updateJournalsDefaultView } =
    useSettings();
  const [sortBy, setSortBy] = useState<SortBy>(contactSort.sortBy);
  const [sortDir, setSortDir] = useState<SortDir>(contactSort.sortDir);
  const [subtitleField, setSubtitleField] = useState<ContactSubtitleField>(contactSubtitleField);
  const [mapSvc, setMapSvc] = useState<MapService>(mapService);
  const [dm, setDm] = useState<DarkMode>(darkMode);
  const [taskLayout, setTaskLayout] = useState<TaskLayout>(taskDefaultLayout);
  const [notesView, setNotesView] = useState<NotesView>(notesDefaultView);
  const [journalsView, setJournalsView] = useState<JournalsView>(journalsDefaultView);

  const handleSave = () => {
    updateContactSort({ sortBy, sortDir });
    updateContactSubtitleField(subtitleField);
    updateMapService(mapSvc);
    updateDarkMode(dm);
    updateTaskDefaultLayout(taskLayout);
    updateNotesDefaultView(notesView);
    updateJournalsDefaultView(journalsView);
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
    journalsView !== journalsDefaultView;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-lg border border-border bg-card shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4 space-y-5">
          {/* Contact sort */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Contacts
            </h3>

            <div className="flex items-center gap-2">
              <label htmlFor="contact-sort-by" className="text-sm font-medium shrink-0">
                Sort order
              </label>
              <select
                id="contact-sort-by"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="contact-subtitle-field" className="text-sm font-medium shrink-0">
                Contact subtitle
              </label>
              <select
                id="contact-subtitle-field"
                value={subtitleField}
                onChange={(e) => setSubtitleField(e.target.value as ContactSubtitleField)}
                className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Nothing</option>
                <option value="nickname">Nickname</option>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="organization">Organization</option>
                <option value="title">Title</option>
              </select>
            </div>
          </section>

          {/* Calendar */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Calendar
            </h3>

            <div className="flex items-center gap-2">
              <label htmlFor="map-service" className="text-sm font-medium shrink-0">
                Map service
              </label>
              <select
                id="map-service"
                value={mapSvc}
                onChange={(e) => setMapSvc(e.target.value as MapService)}
                className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="osm">OpenStreetMap</option>
                <option value="google">Google Maps</option>
                <option value="apple">Apple Maps</option>
              </select>
            </div>
          </section>

          {/* Tasks */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tasks
            </h3>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium shrink-0">Default view</span>
              <div className="flex flex-1 gap-1">
                {([
                  { value: 'list',    label: 'List',    icon: <List className="h-3.5 w-3.5" /> },
                  { value: 'compact', label: 'Compact', icon: <LayoutGrid className="h-3.5 w-3.5" /> },
                  { value: 'kanban',  label: 'Kanban',  icon: <Columns3 className="h-3.5 w-3.5" /> },
                ] as { value: TaskLayout; label: string; icon: React.ReactNode }[]).map(({ value, label, icon }) => (
                  <button
                    key={value}
                    onClick={() => setTaskLayout(value)}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs transition-colors',
                      taskLayout === value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {icon}
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Notes */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Notes
            </h3>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium shrink-0">Default view</span>
              <div className="flex flex-1 gap-1">
                {([
                  { value: 'list', label: 'List', icon: <List className="h-3.5 w-3.5" /> },
                  { value: 'grid', label: 'Grid', icon: <Grid className="h-3.5 w-3.5" /> },
                ] as { value: NotesView; label: string; icon: React.ReactNode }[]).map(({ value, label, icon }) => (
                  <button
                    key={value}
                    onClick={() => setNotesView(value)}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs transition-colors',
                      notesView === value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {icon}
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Journals */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Journals
            </h3>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium shrink-0">Default view</span>
              <div className="flex flex-1 gap-1">
                {([
                  { value: 'timeline', label: 'Timeline', icon: <AlignLeft className="h-3.5 w-3.5" /> },
                  { value: 'list',     label: 'List',     icon: <List className="h-3.5 w-3.5" /> },
                  { value: 'calendar', label: 'Calendar', icon: <CalendarDays className="h-3.5 w-3.5" /> },
                ] as { value: JournalsView; label: string; icon: React.ReactNode }[]).map(({ value, label, icon }) => (
                  <button
                    key={value}
                    onClick={() => setJournalsView(value)}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs transition-colors',
                      journalsView === value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {icon}
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Appearance */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Appearance
            </h3>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium shrink-0">Theme</span>
              <div className="flex flex-1 gap-1">
                {([
                  { value: 'light', label: 'Light', icon: <Sun className="h-3.5 w-3.5" /> },
                  { value: 'system', label: 'System', icon: <Monitor className="h-3.5 w-3.5" /> },
                  { value: 'dark',  label: 'Dark',   icon: <Moon className="h-3.5 w-3.5" /> },
                ] as { value: DarkMode; label: string; icon: React.ReactNode }[]).map(({ value, label, icon }) => (
                  <button
                    key={value}
                    onClick={() => setDm(value)}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs transition-colors',
                      dm === value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {icon}
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
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
