import { describe, it, expect } from 'vitest';
import { isWithinArchiveWindow } from '../lib/routeUtils.js';
import { archiveSearchWindow } from '../lib/dav.js';
import { testConfig } from './helpers.js';

const START = Date.parse('2026-01-01T00:00:00Z');
const END = Date.parse('2026-06-01T00:00:00Z');

describe('isWithinArchiveWindow', () => {
  it('accepts a timestamp inside the window', () => {
    expect(isWithinArchiveWindow('2026-03-01T12:00:00Z', START, END)).toBe(true);
  });

  it('includes the start bound and excludes the end bound', () => {
    // End is the retention cutoff: a task completed exactly there is still in
    // the local cache, so surfacing it again would duplicate a visible row.
    expect(isWithinArchiveWindow('2026-01-01T00:00:00Z', START, END)).toBe(true);
    expect(isWithinArchiveWindow('2026-06-01T00:00:00Z', START, END)).toBe(false);
  });

  it('rejects timestamps outside the window', () => {
    expect(isWithinArchiveWindow('2025-12-31T23:59:59Z', START, END)).toBe(false);
    expect(isWithinArchiveWindow('2026-08-01T00:00:00Z', START, END)).toBe(false);
  });

  it('rejects missing or unparseable timestamps', () => {
    expect(isWithinArchiveWindow(null, START, END)).toBe(false);
    expect(isWithinArchiveWindow('', START, END)).toBe(false);
    expect(isWithinArchiveWindow('not-a-date', START, END)).toBe(false);
  });
});

describe('archiveSearchWindow', () => {
  it('spans from max-age ago up to the retention cutoff', () => {
    const { startMs, endMs } = archiveSearchWindow(testConfig);
    const now = Date.now();

    const startDaysAgo = (now - startMs) / 86_400_000;
    const endDaysAgo = (now - endMs) / 86_400_000;

    expect(startDaysAgo).toBeCloseTo(testConfig.DAV_ARCHIVE_SEARCH_MAX_AGE_DAYS, 1);
    expect(endDaysAgo).toBeCloseTo(testConfig.COMPLETED_TASK_RETENTION_DAYS, 1);
    expect(startMs).toBeLessThan(endMs);
  });
});
