import { z } from 'zod';
import path from 'path';

/**
 * Normalize the DAV endpoint so downstream URL building has one shape to expect.
 *
 * Servers differ in what this points at: Baikal wants a path
 * (`https://host/dav.php`) while Radicale is served from the root
 * (`http://host:5232`). Both forms are fine, but a trailing slash is not — every
 * collection URL is built by appending `/<id>/`, and `http://host:5232/` would
 * yield a double slash that some servers 301-redirect. `davFetch` refuses to
 * follow redirects (it must never replay the Authorization header to another
 * target), so that redirect surfaces as a hard failure rather than a retry.
 *
 * A query or fragment is always a misconfiguration — it would be silently
 * dropped when resolving relative hrefs against this base.
 */
const davBaseUrl = z
  .string()
  .url('DAV_BASE_URL must be a valid URL')
  .superRefine((value, ctx) => {
    const parsed = new URL(value);
    if (parsed.search || parsed.hash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DAV_BASE_URL must not contain a query string or fragment',
      });
    }
  })
  .transform((value) => value.replace(/\/+$/, ''));

const schema = z.object({
  DAV_BASE_URL: davBaseUrl,
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  BIND_ADDRESS: z.string().default('0.0.0.0'),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
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
  DAV_ARCHIVE_SEARCH_MAX_AGE_DAYS: z.coerce.number().int().positive().default(365),
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
