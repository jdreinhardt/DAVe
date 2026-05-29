import { z } from 'zod';
import path from 'path';

const schema = z.object({
  BAIKAL_BASE_URL: z.string().url('BAIKAL_BASE_URL must be a valid URL'),
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  BIND_ADDRESS: z.string().default('0.0.0.0'),
  TRUST_PROXY: z.coerce.boolean().default(false),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Path to the compiled frontend build; used in production to serve the SPA.
  FRONTEND_DIST: z.string().optional(),
  // Directory for the SQLite session database.
  DATA_DIR: z.string().default('/data'),
  // Sync cache settings
  SYNC_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  // Explicit path for the cache DB; defaults to DATA_DIR/cache.db when absent.
  CACHE_DB_PATH: z.string().optional(),
  MAX_CACHED_ENTRIES_PER_USER: z.coerce.number().int().positive().default(10000),
  COMPLETED_TASK_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  BAIKAL_ARCHIVE_SEARCH_MAX_AGE_DAYS: z.coerce.number().int().positive().default(365),
  EVENT_SEARCH_RANGE_DAYS: z.coerce.number().int().positive().default(60),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(): Config {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    console.error(`Configuration error:\n${issues}`);
    process.exit(1);
  }
  return result.data;
}

export function cacheDbPath(config: Config): string {
  return config.CACHE_DB_PATH ?? path.join(config.DATA_DIR, 'cache.db');
}
