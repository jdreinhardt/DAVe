import type { FastifyInstance, FastifyReply } from 'fastify';
import type { OidcLoginError } from '@dave/shared';
import type { DbInstance as DatabaseSync } from '../db/index.js';
import { isOidcEnabled, type Config } from '../config.js';
import { discoverWithRemoteUser } from '../lib/dav.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import {
  beginAuthorization,
  completeAuthorization,
  OidcIdentityError,
  type OidcTransaction,
} from '../lib/oidc.js';
import { createSession } from '../services/session.js';
import { classifyDiscoveryError, setSessionCookie } from './auth.js';

export const OIDC_COOKIE_NAME = 'dave_oidc';
const OIDC_COOKIE_PATH = '/api/auth/oidc';
const TRANSACTION_TTL_MS = 10 * 60_000;

// Sign-in round trips are few per user; this only has to stop a client from
// hammering the provider discovery or token endpoint through DAVe.
const rateLimit = { rateLimit: { max: 30, timeWindow: '15 minutes' } };

export async function oidcRoutes(
  app: FastifyInstance,
  opts: { config: Config; db: DatabaseSync },
) {
  const { config, db } = opts;
  if (!isOidcEnabled(config)) return;

  // Errors go back to the login page as a code instead of re-entering the flow:
  // an automatic retry would loop between DAVe and the provider.
  const fail = (reply: FastifyReply, code: OidcLoginError) => {
    reply.clearCookie(OIDC_COOKIE_NAME, { path: OIDC_COOKIE_PATH });
    return reply.redirect(`/login?error=${code}`);
  };

  // GET /api/auth/oidc/login — start the authorization code flow.
  app.get('/api/auth/oidc/login', { config: rateLimit }, async (_req, reply) => {
    let started;
    try {
      started = await beginAuthorization(config);
    } catch (e) {
      app.log.error({ msg: e instanceof Error ? e.message : String(e) }, 'OIDC discovery failed');
      return fail(reply, 'oidc_failed');
    }
    reply.setCookie(OIDC_COOKIE_NAME, encrypt(JSON.stringify(started.transaction), config.SESSION_SECRET), {
      httpOnly: true,
      secure: config.TRUST_PROXY,
      // Lax still sends the cookie on the provider's top-level GET redirect back
      // to the callback, which is the only request that needs it.
      sameSite: 'lax',
      path: OIDC_COOKIE_PATH,
      maxAge: TRANSACTION_TTL_MS / 1000,
    });
    return reply.redirect(started.url.href);
  });

  // GET /api/auth/oidc/callback — provider redirects here with ?code&state.
  app.get('/api/auth/oidc/callback', { config: rateLimit }, async (req, reply) => {
    const transaction = readTransaction(req.cookies[OIDC_COOKIE_NAME], config.SESSION_SECRET);
    if (!transaction) {
      app.log.warn('OIDC callback without a valid transaction cookie');
      return fail(reply, 'oidc_failed');
    }

    const search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    let identity;
    try {
      identity = await completeAuthorization(config, search, transaction);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof OidcIdentityError) {
        app.log.warn({ msg }, 'OIDC identity rejected');
        return fail(reply, 'oidc_identity');
      }
      app.log.warn({ msg }, 'OIDC callback failed');
      return fail(reply, 'oidc_failed');
    }

    let discovery;
    try {
      discovery = await discoverWithRemoteUser(identity.username, config);
    } catch (e) {
      const { kind, msg } = classifyDiscoveryError(e);
      app.log.error({ msg, username: identity.username }, 'DAV discovery failed for OIDC user');
      return fail(reply, kind === 'unauthorized' ? 'dav_denied' : 'dav_unavailable');
    }

    const sessionId = createSession(
      {
        username: identity.username,
        password: '',
        authMode: 'remote-user',
        displayName: identity.displayName,
        principalUrl: discovery.principalUrl,
        calendarHomeUrl: discovery.calendarHomeUrl,
        addressBookHomeUrl: discovery.addressBookHomeUrl,
      },
      config.SESSION_SECRET,
      db,
    );

    reply.clearCookie(OIDC_COOKIE_NAME, { path: OIDC_COOKIE_PATH });
    setSessionCookie(reply, sessionId, config);
    return reply.redirect('/');
  });
}

function readTransaction(raw: string | undefined, secret: string): OidcTransaction | null {
  if (!raw) return null;
  try {
    const t = JSON.parse(decrypt(raw, secret)) as OidcTransaction;
    if (Date.now() - t.createdAt > TRANSACTION_TTL_MS) return null;
    return t;
  } catch {
    return null;
  }
}
