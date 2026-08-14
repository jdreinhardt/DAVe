/**
 * Refuse to send DAV requests — and the Basic auth header they carry — over
 * plaintext http:// when the configured DAV server is https://.
 *
 * `assertDavTarget` already pins every target this codebase builds to the
 * configured origin, scheme included. It cannot cover tsdav: tsdav constructs
 * its own requests and never passes through `davFetch`. Service discovery is
 * the concrete hole. tsdav honors the scheme of a `.well-known` redirect
 * verbatim, so a server whose `.well-known/caldav` 302s to `http://` (a common
 * reverse-proxy misconfiguration) downgrades the connection, and the very first
 * authenticated PROPFIND puts base64-encoded credentials on the wire in the
 * clear. A hostile or MITM'd redirect gets the same leverage deliberately.
 *
 * The guard is installed on `globalThis` rather than threaded through tsdav's
 * per-call `fetch` option because it has to hold for requests tsdav makes
 * internally, not just the call sites enumerated in `lib/dav.ts` — a guard you
 * have to remember to pass is one you will eventually forget to pass.
 *
 * INSTALLED AT MODULE LOAD, DELIBERATELY. tsdav binds `globalThis.fetch` once,
 * when its module body runs (`const fetch = resolveFetch()`), so a wrapper
 * installed after that import is dead code — tsdav keeps calling the original.
 * `server.ts` therefore imports this module before anything that reaches tsdav,
 * and ESM's depth-first, source-order evaluation guarantees this body runs
 * first. Moving that import, or importing it lazily, silently disables the
 * guard. `secureFetch.test.ts` pins the ordering.
 */

/** Set once the config is known; until then the wrapper passes everything through. */
let requireSecureTransport = false;

const originalFetch = globalThis.fetch;

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

globalThis.fetch = function guardedFetch(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
): Promise<Response> {
  if (requireSecureTransport) {
    let protocol: string;
    try {
      protocol = new URL(urlOf(input)).protocol;
    } catch {
      // Not our business to reject malformed input — let fetch report it.
      return originalFetch(input, init);
    }
    if (protocol === 'http:') {
      // Fail closed. Downgrading silently would mean shipping the credentials
      // anyway; failing the login is the recoverable outcome. The URL is safe to
      // include (credentials live in the Authorization header, never the URL).
      return Promise.reject(
        Object.assign(
          new Error(
            `Refusing to send a request over plaintext http:// while DAV_BASE_URL is https://. ` +
              `Target: ${urlOf(input)}. If this is your own server, its .well-known ` +
              `redirect is downgrading the scheme — point it at https://.`,
          ),
          { statusCode: 502 },
        ),
      );
    }
  }
  return originalFetch(input, init);
};

/**
 * Enable the guard when the configured DAV base is https. Called from bootstrap
 * once the config is parsed. A plaintext DAV_BASE_URL (the local Baikal and
 * Radicale test stacks) leaves it off, so http stays usable where it was chosen
 * deliberately rather than arrived at via a redirect.
 */
export function setSecureTransportPolicy(davBaseUrl: string): void {
  try {
    requireSecureTransport = new URL(davBaseUrl).protocol === 'https:';
  } catch {
    requireSecureTransport = false;
  }
}

/** Test seam: report whether the guard is currently enforcing. */
export function isSecureTransportRequired(): boolean {
  return requireSecureTransport;
}
