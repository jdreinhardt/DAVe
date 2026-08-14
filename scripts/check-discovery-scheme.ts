// Report every HTTP request the login/discovery path makes, and whether it
// carries the Authorization header — specifically, whether any of them go out
// over plaintext http://.
//
// Discovery runs before credentials are validated, so this is meant to be run
// with a DUMMY password: the request pattern is identical and no real secret
// ever leaves the machine. A 401 at the end is the expected outcome.
//
//   DAV_BASE_URL=https://dav.example.com/dav.php \
//     DAV_USER=alice DAV_PASS=not-my-real-password npm run diagnose:discovery
//
// Any line marked PLAINTEXT + auth=yes means the DAV password is transmitted
// unencrypted on that request. tsdav's service discovery honors the scheme in a
// .well-known redirect verbatim, so a server that redirects .well-known to
// http:// downgrades the connection, and assertDavTarget cannot catch it —
// tsdav builds its own requests and never goes through davFetch.

import type { Config } from '../packages/backend/src/config.js';

const BASE = process.env.DAV_BASE_URL;
const USER = process.env.DAV_USER;
const PASS = process.env.DAV_PASS;

if (!BASE || !USER || !PASS) {
  console.error('Set DAV_BASE_URL, DAV_USER and DAV_PASS (use a dummy password).');
  process.exit(1);
}

const config = { DAV_BASE_URL: BASE.replace(/\/+$/, '') } as Config;

const realFetch = globalThis.fetch;
let plaintextWithAuth = 0;

globalThis.fetch = async (input: Parameters<typeof realFetch>[0], init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const hasAuth = headers.has('authorization');
  const insecure = url.startsWith('http://');
  if (insecure && hasAuth) plaintextWithAuth++;

  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  console.log(
    `${insecure ? 'PLAINTEXT' : '  https  '}  ${String(method).padEnd(9)} ` +
      `auth=${hasAuth ? 'yes' : 'no '}  ${url}`,
  );
  return realFetch(input, init);
};

// tsdav binds globalThis.fetch at module-load time (`const fetch = resolveFetch()`),
// so it must be imported *after* the patch above is installed — a static import
// would be hoisted above it and the wrapper would never see a single request.
const { initDavBase, discoverAndValidate } = await import('../packages/backend/src/lib/dav.js');
initDavBase(config);

try {
  const d = await discoverAndValidate(USER, PASS, config);
  console.log('\ndiscovery result:', d);
} catch (err) {
  console.log(`\ndiscovery threw (expected with a dummy password): ${(err as Error).message}`);
}

console.log(
  plaintextWithAuth === 0
    ? '\nOK: no credentials sent over plaintext http://.'
    : `\nFAIL: ${plaintextWithAuth} request(s) sent the Authorization header over plaintext http://.`,
);
