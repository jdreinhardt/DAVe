import type { DbInstance } from '../db/index.js';
import type { CacheDbInstance } from '../db/cache.js';
import type { Config } from '../config.js';
import { getAllActiveSessions } from '../services/session.js';
import { syncAllCollectionsForUser } from '../services/cacheSync.js';

type Logger = {
  info: (obj: object | string, msg?: string) => void;
  debug: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
};

export class SyncWorker {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastRunAt: Date | null = null;
  private consecutiveErrors = 0;
  private logger: Logger = console;

  constructor(
    private readonly db: DbInstance,
    private readonly cacheDb: CacheDbInstance,
    private readonly config: Config,
  ) {}

  start(logger?: Logger): void {
    if (logger) this.logger = logger;
    if (this.intervalId) return;

    // Run an initial sync shortly after startup, then on each interval.
    const run = () => void this.runOnce();
    setTimeout(run, 5_000);
    this.intervalId = setInterval(run, this.config.SYNC_INTERVAL_SECONDS * 1_000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  health(): { running: boolean; lastRunAt: string | null; consecutiveErrors: number } {
    return {
      running: this.intervalId !== null,
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      consecutiveErrors: this.consecutiveErrors,
    };
  }

  /** Trigger an immediate sync for a specific user (called after mutations). */
  async triggerForUser(username: string): Promise<void> {
    const sessions = getAllActiveSessions(
      this.db,
      this.config.SESSION_SECRET,
      this.config.SESSION_TTL_HOURS,
    );
    const match = sessions.find((s) => s.data.username === username);
    if (!match) return;
    try {
      await syncAllCollectionsForUser(
        match.data,
        username,
        this.cacheDb,
        this.config,
        this.logger,
      );
    } catch (err) {
      this.logger.warn({ err, username }, 'Triggered sync failed');
    }
  }

  private async runOnce(): Promise<void> {
    const sessions = getAllActiveSessions(
      this.db,
      this.config.SESSION_SECRET,
      this.config.SESSION_TTL_HOURS,
    );

    // Deduplicate — same user may have multiple browser sessions.
    const seen = new Set<string>();
    let errors = 0;
    for (const { data: session } of sessions) {
      if (seen.has(session.username)) continue;
      seen.add(session.username);
      try {
        await syncAllCollectionsForUser(
          session,
          session.username,
          this.cacheDb,
          this.config,
          this.logger,
        );
      } catch (err) {
        errors++;
        this.logger.warn({ err, username: session.username }, 'Background sync failed for user');
      }
    }

    if (errors > 0) {
      this.consecutiveErrors++;
    } else {
      this.consecutiveErrors = 0;
    }
    this.lastRunAt = new Date();
  }
}
