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

// Compose and similar tools pass an unset-but-declared variable as ''. Treat
// that as absent so `OIDC_ISSUER_URL=` disables OIDC instead of failing URL
// validation.
const emptyAsUndefined = (v: unknown) => (v === '' ? undefined : v);
const optionalUrl = (name: string) =>
  z.preprocess(emptyAsUndefined, z.string().url(`${name} must be a valid URL`).optional());
const optionalString = z.preprocess(emptyAsUndefined, z.string().optional());

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
  // Which proxies may set X-Forwarded-For, as a comma-separated list of IPs,
  // CIDRs, or the named ranges proxy-addr understands (loopback, linklocal,
  // uniquelocal). Ignored entirely unless TRUST_PROXY is on.
  //
  // This exists because trusting *every* hop (Fastify's `trustProxy: true`) takes
  // the left-most X-Forwarded-For entry as the client — and nginx's usual
  // `$proxy_add_x_forwarded_for` preserves whatever the client sent and appends
  // the real address on the right. So a client could name its own IP and get a
  // private rate-limit bucket per request.
  //
  // The default covers every layout where the proxy reaches DAVe over a private
  // address: same host via loopback, a shared container network, or another
  // machine on the LAN. A proxy arriving from a *public* address (Cloudflare and
  // friends) must be listed explicitly.
  //
  // Setting this replaces the default rather than adding to it, and the value is
  // the address the proxy *connects from* — for nginx in a compose network that
  // is the container subnet, not its public address. Narrowing it this way is
  // also the only way to stop a client that is itself on a private address from
  // spoofing, since `uniquelocal` trusts any private hop in the chain.
  TRUST_PROXY_IPS: z.preprocess(
    emptyAsUndefined,
    z.string().default('loopback,uniquelocal'),
  ),
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
  // OIDC sign-in. Setting OIDC_ISSUER_URL switches DAVe from password login to
  // OIDC, and DAV requests then identify the user with DAV_REMOTE_USER_HEADER
  // instead of Basic auth. The DAV server must trust that header, and must be
  // reachable only by DAVe — see README "OIDC sign-in".
  OIDC_ISSUER_URL: optionalUrl('OIDC_ISSUER_URL'),
  OIDC_CLIENT_ID: optionalString,
  // Omit for a public client; PKCE is used either way.
  OIDC_CLIENT_SECRET: optionalString,
  // Explicit rather than derived from the request's Host header, which a client
  // controls unless every proxy in front of DAVe rewrites it.
  OIDC_REDIRECT_URI: optionalUrl('OIDC_REDIRECT_URI'),
  OIDC_SCOPES: z.preprocess(emptyAsUndefined, z.string().default('openid profile email')),
  OIDC_USERNAME_CLAIM: z.preprocess(emptyAsUndefined, z.string().default('preferred_username')),
  OIDC_POST_LOGOUT_REDIRECT_URI: optionalUrl('OIDC_POST_LOGOUT_REDIRECT_URI'),
  DAV_REMOTE_USER_HEADER: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .regex(/^[A-Za-z0-9-]+$/, 'DAV_REMOTE_USER_HEADER must be a valid HTTP header name')
      .default('X-Remote-User'),
  ),
});

const refinedSchema = schema.superRefine((cfg, ctx) => {
  if (!cfg.OIDC_ISSUER_URL) return;
  for (const key of ['OIDC_CLIENT_ID', 'OIDC_REDIRECT_URI'] as const) {
    if (!cfg[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required when OIDC_ISSUER_URL is set`,
      });
    }
  }
  if (!cfg.OIDC_SCOPES.split(/\s+/).includes('openid')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['OIDC_SCOPES'],
      message: 'OIDC_SCOPES must include "openid"',
    });
  }
  // Required here rather than warned about at startup, unlike TRUST_PROXY on its
  // own: OIDC needs an HTTPS issuer, so a deployment that reaches one terminates
  // TLS somewhere, and the sign-in transaction cookie carries the PKCE code
  // verifier and nonce. Shipping those without Secure is not a trade-off worth
  // leaving to a log line. Development is exempt so an http://localhost setup runs.
  if (cfg.NODE_ENV === 'production' && !cfg.TRUST_PROXY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['TRUST_PROXY'],
      message:
        'TRUST_PROXY must be set when OIDC_ISSUER_URL is set in production — without it the ' +
        'session cookie and the OIDC sign-in transaction cookie (which carries the PKCE code ' +
        'verifier and nonce) are sent without the Secure flag',
    });
  }
});

export type Config = z.infer<typeof schema>;

export function isOidcEnabled(config: Config): boolean {
  return Boolean(config.OIDC_ISSUER_URL);
}

/**
 * The value Fastify's `trustProxy` option wants.
 *
 * Deliberately never `true`: that trusts every hop and hands the client control
 * of its own apparent IP, which defeats the per-IP login throttle. Off, or an
 * explicit allowlist — nothing in between.
 */
export function trustProxyValue(config: Config): string | false {
  return config.TRUST_PROXY ? config.TRUST_PROXY_IPS : false;
}

export function loadConfig(): Config {
  const result = refinedSchema.safeParse(process.env);
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
