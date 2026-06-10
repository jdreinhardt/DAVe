import { useState } from 'react';
import { Repeat } from 'lucide-react';
import type { RecurrenceRule } from '@dave/shared';
import { cn } from '../lib/utils';

type FreqPreset = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'CUSTOM';
type EndType = 'never' | 'until' | 'count';

function buildRaw(
  freq: RecurrenceRule['freq'],
  interval: number,
  endType: EndType,
  until: string,
  count: number,
  byDay: string[],
): string {
  let raw = `FREQ=${freq}`;
  if (interval > 1) raw += `;INTERVAL=${interval}`;
  if (freq === 'WEEKLY' && byDay.length > 0) raw += `;BYDAY=${byDay.join(',')}`;
  if (endType === 'until' && until) raw += `;UNTIL=${until.replace(/-/g, '')}`;
  if (endType === 'count' && count > 0) {
    // COUNT in RFC 5545 means total occurrences, not repeat cycles.
    // For WEEKLY with multiple days the user thinks in "weeks", so we convert.
    const icalCount = freq === 'WEEKLY' && byDay.length > 1 ? count * byDay.length : count;
    raw += `;COUNT=${icalCount}`;
  }
  return raw;
}

function countToCycles(count: number, freq: RecurrenceRule['freq'], byDay: string[] | undefined): number {
  if (freq === 'WEEKLY' && byDay && byDay.length > 1) {
    return Math.max(1, Math.round(count / byDay.length));
  }
  return count;
}

const DOW_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function defaultByDay(dtstart: string): string[] {
  try {
    const day = new Date(dtstart.length === 10 ? dtstart + 'T00:00:00' : dtstart).getDay();
    return [DOW_CODES[day] ?? 'MO'];
  } catch {
    return ['MO'];
  }
}

export function RecurrenceEditor({
  value,
  onChange,
  dtstart,
  disabled,
}: {
  value: RecurrenceRule | null;
  onChange: (r: RecurrenceRule | null) => void;
  dtstart: string;
  disabled?: boolean;
}) {
  const initPreset = (): FreqPreset => {
    if (!value) return 'NONE';
    if (value.raw.includes('BYHOUR') || value.raw.includes('BYSETPOS')) return 'CUSTOM';
    return value.freq as FreqPreset;
  };

  const [preset, setPreset] = useState<FreqPreset>(initPreset);
  const [interval, setInterval] = useState(value?.interval ?? 1);
  const [endType, setEndType] = useState<EndType>(() =>
    value?.until ? 'until' : value?.count ? 'count' : 'never',
  );
  const [until, setUntil] = useState(value?.until ?? '');
  const [count, setCount] = useState(() =>
    value?.count != null ? countToCycles(value.count, value.freq, value.byDay) : 1,
  );
  const [byDay, setByDay] = useState<string[]>(() =>
    value?.byDay ?? defaultByDay(dtstart),
  );
  const [customRaw, setCustomRaw] = useState(value?.raw ?? '');

  const emit = (
    p: FreqPreset,
    iv: number,
    et: EndType,
    ut: string,
    ct: number,
    bd: string[],
    raw: string,
  ) => {
    if (p === 'NONE') { onChange(null); return; }
    if (p === 'CUSTOM') {
      if (!raw.trim()) { onChange(null); return; }
      const freq = raw.match(/FREQ=(\w+)/)?.[1]?.toUpperCase();
      if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) {
        onChange(null); return;
      }
      onChange({ freq: freq as RecurrenceRule['freq'], raw });
      return;
    }
    const builtRaw = buildRaw(p as RecurrenceRule['freq'], iv, et, ut, ct, bd);
    onChange({
      freq: p as RecurrenceRule['freq'],
      interval: iv > 1 ? iv : undefined,
      count: et === 'count' ? ct : undefined,
      until: et === 'until' ? ut : undefined,
      byDay: p === 'WEEKLY' && bd.length > 0 ? bd : undefined,
      raw: builtRaw,
    });
  };

  const handlePreset = (p: FreqPreset) => {
    setPreset(p);
    const bd = p === 'WEEKLY' ? defaultByDay(dtstart) : byDay;
    setByDay(bd);
    emit(p, interval, endType, until, count, bd, customRaw);
  };

  const handleInterval = (iv: number) => {
    setInterval(iv);
    emit(preset, iv, endType, until, count, byDay, customRaw);
  };

  const handleEndType = (et: EndType) => {
    setEndType(et);
    emit(preset, interval, et, until, count, byDay, customRaw);
  };

  const handleUntil = (ut: string) => {
    setUntil(ut);
    emit(preset, interval, endType, ut, count, byDay, customRaw);
  };

  const handleCount = (ct: number) => {
    setCount(ct);
    emit(preset, interval, endType, until, ct, byDay, customRaw);
  };

  const toggleDay = (code: string) => {
    const next = byDay.includes(code) ? byDay.filter((d) => d !== code) : [...byDay, code];
    const safe = next.length === 0 ? [code] : next;
    setByDay(safe);
    emit(preset, interval, endType, until, count, safe, customRaw);
  };

  const handleCustomRaw = (raw: string) => {
    setCustomRaw(raw);
    emit(preset, interval, endType, until, count, byDay, raw);
  };

  const nounMap: Record<Exclude<FreqPreset, 'NONE' | 'CUSTOM'>, string> = {
    DAILY: 'day(s)', WEEKLY: 'week(s)', MONTHLY: 'month(s)', YEARLY: 'year(s)',
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Repeat className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <select
          value={preset}
          onChange={(e) => handlePreset(e.target.value as FreqPreset)}
          className={inputCls}
          disabled={disabled}
        >
          <option value="NONE">Does not repeat</option>
          <option value="DAILY">Daily</option>
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
          <option value="YEARLY">Yearly</option>
          <option value="CUSTOM">Custom…</option>
        </select>
      </div>

      {preset !== 'NONE' && preset !== 'CUSTOM' && (
        <div className="pl-5 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground text-xs">Every</span>
            <input
              type="number"
              min={1}
              value={interval}
              onChange={(e) => handleInterval(Math.max(1, parseInt(e.target.value) || 1))}
              className={cn(smallSelectCls, 'w-16')}
            />
            <span className="text-muted-foreground text-xs">{nounMap[preset as Exclude<FreqPreset, 'NONE' | 'CUSTOM'>]}</span>
          </div>

          {preset === 'WEEKLY' && (
            <div className="flex flex-wrap gap-1">
              {DOW_CODES.map((code, i) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => toggleDay(code)}
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs border transition-colors',
                    byDay.includes(code)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-input bg-background text-foreground hover:bg-muted',
                  )}
                >
                  {DOW_LABELS[i]}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">Ends</span>
            <select
              value={endType}
              onChange={(e) => handleEndType(e.target.value as EndType)}
              className={smallSelectCls}
            >
              <option value="never">Never</option>
              <option value="until">On date</option>
              <option value="count">After N times</option>
            </select>
            {endType === 'until' && (
              <input
                type="date"
                value={until}
                onChange={(e) => handleUntil(e.target.value)}
                className={cn(smallSelectCls, 'w-36')}
              />
            )}
            {endType === 'count' && (
              <input
                type="number"
                min={1}
                value={count}
                onChange={(e) => handleCount(Math.max(1, parseInt(e.target.value) || 1))}
                className={cn(smallSelectCls, 'w-20')}
              />
            )}
          </div>
        </div>
      )}

      {preset === 'CUSTOM' && (
        <div className="pl-5 space-y-1">
          <input
            type="text"
            value={customRaw}
            onChange={(e) => handleCustomRaw(e.target.value)}
            placeholder="e.g. FREQ=WEEKLY;BYDAY=MO,WE,FR"
            className={inputCls}
          />
          <p className="text-xs text-muted-foreground">Raw RRULE value (without &ldquo;RRULE:&rdquo; prefix)</p>
        </div>
      )}
    </div>
  );
}

const inputCls = [
  'w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground',
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring',
].join(' ');

const smallSelectCls = [
  'rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground',
  'focus:outline-none focus:ring-2 focus:ring-ring',
].join(' ');
