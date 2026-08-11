import { cn } from '../lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * A row of mutually-exclusive segment buttons (icon + label), styled to match the
 * app's toggle controls. Extracted from the Settings modal, where the same markup
 * was repeated for theme, task/notes/journals default views, and the calendar
 * task-date basis.
 */
export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <div className="flex flex-1 gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          title={opt.title}
          aria-pressed={value === opt.value}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs transition-colors',
            value === opt.value
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
