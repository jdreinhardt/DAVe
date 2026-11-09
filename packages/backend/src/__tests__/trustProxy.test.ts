import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { trustProxyValue, type Config } from '../config.js';
import { testConfig } from './helpers.js';

/**
 * Guards the one thing that matters about proxy trust: a client must not be able
 * to choose its own apparent IP, because that is what the login throttle keys on.
 *
 * These drive a real Fastify instance rather than asserting on the config value,
 * because the failure mode is in how proxy-addr walks the header — `trustProxy:
 * true` looks like the obvious setting and is precisely the broken one.
 */

// What nginx's `$proxy_add_x_forwarded_for` produces: whatever the client sent,
// with the address it actually connected from appended on the right.
const FORGED = '203.0.113.99';
const REAL = '198.51.100.7';
const XFF = `${FORGED}, ${REAL}`;

let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

async function resolvedIp(trustProxy: string | boolean): Promise<string> {
  app = Fastify({ logger: false, trustProxy });
  app.get('/', (req, reply) => reply.send({ ip: req.ip }));
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  const res = await fetch(`http://127.0.0.1:${addr.port}/`, {
    headers: { 'X-Forwarded-For': XFF },
  });
  return ((await res.json()) as { ip: string }).ip;
}

const withEnv = (env: Record<string, string>): Config =>
  ({ ...testConfig, ...env } as unknown as Config);

describe('trustProxyValue', () => {
  it('is off when TRUST_PROXY is not set', () => {
    expect(trustProxyValue(withEnv({}))).toBe(false);
  });

  it('defaults to the private-address ranges when enabled', () => {
    expect(
      trustProxyValue({
        ...testConfig,
        TRUST_PROXY: true,
        TRUST_PROXY_IPS: 'loopback,uniquelocal',
      } as unknown as Config),
    ).toBe('loopback,uniquelocal');
  });

  it('ignores the allowlist entirely while TRUST_PROXY is off', () => {
    expect(
      trustProxyValue({
        ...testConfig,
        TRUST_PROXY: false,
        TRUST_PROXY_IPS: '172.18.0.0/16',
      } as unknown as Config),
    ).toBe(false);
  });

  it('never yields `true`, which would trust every hop', () => {
    for (const ips of ['loopback,uniquelocal', '172.18.0.0/16', '10.10.10.100']) {
      const v = trustProxyValue({
        ...testConfig,
        TRUST_PROXY: true,
        TRUST_PROXY_IPS: ips,
      } as unknown as Config);
      expect(v).not.toBe(true);
      expect(typeof v).toBe('string');
    }
  });
});

describe('X-Forwarded-For handling', () => {
  it('lets a client forge its IP when every hop is trusted', async () => {
    // Not a recommendation — this is the behaviour the allowlist exists to avoid,
    // pinned so nobody "simplifies" trustProxyValue back to a boolean.
    expect(await resolvedIp(true)).toBe(FORGED);
  });

  it('ignores a forged entry when only the connecting proxy is trusted', async () => {
    // The request arrives from loopback, so loopback is the proxy here; the
    // forged public entry sits beyond it and must not be believed.
    expect(await resolvedIp('loopback')).toBe(REAL);
  });

  it('falls back to the socket address when the proxy is not on the list', async () => {
    // Safe failure: an allowlist that does not match means X-Forwarded-For is
    // disregarded, not trusted.
    expect(await resolvedIp('10.10.10.100')).toBe('127.0.0.1');
  });
});
