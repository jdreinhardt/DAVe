import * as client from 'openid-client';
import type { Config } from '../config.js';

/**
 * OIDC relying-party plumbing. Authorization code flow with PKCE, state and
 * nonce — the transaction values travel in an encrypted, short-lived cookie
 * (see routes/oidc.ts), so no server-side state is kept between the redirect
 * and the callback.
 */

let configuration: Promise<client.Configuration> | null = null;

/**
 * Discover the provider lazily and cache the result. Lazy so an unreachable
 * provider doesn't stop DAVe from starting; a failed discovery is not cached,
 * so the next sign-in attempt retries it.
 */
export function getOidcConfiguration(config: Config): Promise<client.Configuration> {
  if (!configuration) {
    configuration = client
      .discovery(
        new URL(config.OIDC_ISSUER_URL!),
        config.OIDC_CLIENT_ID!,
        undefined,
        config.OIDC_CLIENT_SECRET
          ? client.ClientSecretPost(config.OIDC_CLIENT_SECRET)
          : client.None(),
      )
      .catch((err: unknown) => {
        configuration = null;
        throw err;
      });
  }
  return configuration;
}

/** Test seam: drop the cached discovery result. */
export function resetOidcConfiguration(): void {
  configuration = null;
}

export interface OidcTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  createdAt: number;
}

export async function beginAuthorization(
  config: Config,
): Promise<{ url: URL; transaction: OidcTransaction }> {
  const oidc = await getOidcConfiguration(config);
  const transaction: OidcTransaction = {
    state: client.randomState(),
    nonce: client.randomNonce(),
    codeVerifier: client.randomPKCECodeVerifier(),
    createdAt: Date.now(),
  };
  const url = client.buildAuthorizationUrl(oidc, {
    redirect_uri: config.OIDC_REDIRECT_URI!,
    scope: config.OIDC_SCOPES,
    state: transaction.state,
    nonce: transaction.nonce,
    code_challenge: await client.calculatePKCECodeChallenge(transaction.codeVerifier),
    code_challenge_method: 'S256',
  });
  return { url, transaction };
}

export interface OidcIdentity {
  username: string;
  displayName: string;
}

/**
 * Thrown when the provider authenticated someone but DAVe can't map them to a
 * DAV username. Distinct from protocol failures so the route can tell the user
 * which side to fix.
 */
export class OidcIdentityError extends Error {}

/**
 * Exchange the authorization code and return the DAV username for the user.
 *
 * `search` is the callback's raw query string. It is joined onto the configured
 * redirect URI rather than the request's own URL: openid-client sends the base
 * of this URL as `redirect_uri` in the token request, and it must be the exact
 * value registered with the provider — not whatever Host the request carried.
 */
export async function completeAuthorization(
  config: Config,
  search: string,
  transaction: OidcTransaction,
): Promise<OidcIdentity> {
  const oidc = await getOidcConfiguration(config);
  const callbackUrl = new URL(config.OIDC_REDIRECT_URI!);
  callbackUrl.search = search;

  const tokens = await client.authorizationCodeGrant(oidc, callbackUrl, {
    pkceCodeVerifier: transaction.codeVerifier,
    expectedState: transaction.state,
    expectedNonce: transaction.nonce,
    idTokenExpected: true,
  });

  const idClaims = tokens.claims()!;
  let claims: Record<string, unknown> = idClaims;
  // Many providers keep profile claims out of the ID token and only serve them
  // from userinfo; fall back to it before giving up on the username claim.
  if (claims[config.OIDC_USERNAME_CLAIM] === undefined) {
    claims = await client.fetchUserInfo(oidc, tokens.access_token, idClaims.sub);
  }

  const username = claims[config.OIDC_USERNAME_CLAIM];
  if (typeof username !== 'string' || !isSafeUsername(username)) {
    throw new OidcIdentityError(
      `The identity provider did not supply a usable "${config.OIDC_USERNAME_CLAIM}" claim`,
    );
  }
  const name = claims.name;
  return {
    username,
    displayName: typeof name === 'string' && name.trim() ? name : username,
  };
}

/**
 * The username becomes both a header value and, on servers like Radicale, the
 * principal path segment. Reject anything that could act as a path or break the
 * header — a provider is trusted to authenticate, not to emit sane usernames.
 */
export function isSafeUsername(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 256 &&
    value !== '.' &&
    value !== '..' &&
    // eslint-disable-next-line no-control-regex
    !/[/\\\u0000-\u001f\u007f]/.test(value)
  );
}

/**
 * Where the browser goes after DAVe drops its session. Without a provider-side
 * logout the provider's own session would sign the user straight back in.
 * Returns null when the provider has no end-session endpoint.
 */
export async function endSessionUrl(config: Config): Promise<string | null> {
  const oidc = await getOidcConfiguration(config);
  if (!oidc.serverMetadata().end_session_endpoint) return null;
  const params: Record<string, string> = { client_id: config.OIDC_CLIENT_ID! };
  if (config.OIDC_POST_LOGOUT_REDIRECT_URI) {
    params.post_logout_redirect_uri = config.OIDC_POST_LOGOUT_REDIRECT_URI;
  }
  return client.buildEndSessionUrl(oidc, params).href;
}
