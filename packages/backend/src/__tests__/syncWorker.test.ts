import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeDb, makeCacheDb, testConfig } from './helpers.js';
import { SyncWorker } from '../workers/syncWorker.js';
import type { DbInstance } from '../db/index.js';
import type { CacheDbInstance } from '../db/cache.js';

let db: DbInstance;
let cacheDb: CacheDbInstance;
let worker: SyncWorker;

beforeEach(() => {
  db = makeDb();
  cacheDb = makeCacheDb();
  worker = new SyncWorker(db, cacheDb, testConfig);
  vi.useFakeTimers();
});

afterEach(() => {
  worker.stop();
  vi.useRealTimers();
});

describe('SyncWorker.health()', () => {
  it('reports not running before start()', () => {
    const h = worker.health();
    expect(h.running).toBe(false);
    expect(h.lastRunAt).toBeNull();
    expect(h.consecutiveErrors).toBe(0);
  });

  it('reports running after start()', () => {
    worker.start();
    expect(worker.health().running).toBe(true);
  });

  it('reports not running after stop()', () => {
    worker.start();
    worker.stop();
    expect(worker.health().running).toBe(false);
  });

  it('calling start() twice does not create a second interval', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    worker.start();
    worker.start();
    // setInterval is called once for the recurring interval;
    // the initial setTimeout is separate.
    const intervalCalls = setIntervalSpy.mock.calls.length;
    expect(intervalCalls).toBe(1);
    setIntervalSpy.mockRestore();
  });

  it('calling stop() when not running does not throw', () => {
    expect(() => worker.stop()).not.toThrow();
  });
});

describe('SyncWorker.triggerForUser()', () => {
  it('resolves without error when no sessions exist', async () => {
    await expect(worker.triggerForUser('alice')).resolves.toBeUndefined();
  });
});
