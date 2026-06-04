import { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionManager } from '../../../packages/core/src/index.js';
import {
  buildApprovalQueue,
  buildBootstrapFirewall,
  buildBootstrapSessionManager,
  buildMockExecutionEngine,
  createLocalApiApp,
  DEFAULT_HOST,
  DEFAULT_SESSION_MAX_REQUESTS,
  DEFAULT_SESSION_REUSE_POLICY,
  DEFAULT_SESSION_TTL_MS,
  resolveServerConfig
} from '../src/local-api.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

interface StartedServer {
  base: string;
  sessionManager: SessionManager;
}

function startApp(sessionManager?: SessionManager): Promise<StartedServer> {
  const manager =
    sessionManager ??
    buildBootstrapSessionManager({
      ttlMs: DEFAULT_SESSION_TTL_MS,
      maxRequests: DEFAULT_SESSION_MAX_REQUESTS,
      reusePolicy: DEFAULT_SESSION_REUSE_POLICY
    });
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    approvalQueue: buildApprovalQueue(),
    executionEngine: buildMockExecutionEngine(),
    sessionManager: manager
  });
  const server = app.listen(0, DEFAULT_HOST);
  return new Promise<StartedServer>((resolveStarted) => {
    server.once('listening', () => {
      const address = server.address() as AddressInfo;
      cleanups.push(() => server.close());
      resolveStarted({
        base: `http://${DEFAULT_HOST}:${address.port}`,
        sessionManager: manager
      });
    });
  });
}

async function rawRequest(
  base: string,
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, init);
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function executeMock(
  base: string,
  body: unknown
): Promise<{ status: number; json: any }> {
  return rawRequest(base, '/v1/capabilities/execute-mock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

const ALLOW_BODY = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'low',
  input: 'bitcoin privacy research'
};

const PENDING_BODY = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'fetch_html',
  riskLevel: 'medium',
  input: 'sensitive lookup'
};

const DENY_BODY = {
  agentId: 'rogue-agent',
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'low',
  input: 'x'
};

describe('GRL Local API — execute-mock session lifecycle', () => {
  it('creates a session when a capability is allowed', async () => {
    const { base, sessionManager } = await startApp();
    expect(sessionManager.size()).toBe(0);
    await executeMock(base, ALLOW_BODY);
    expect(sessionManager.size()).toBe(1);
    const session = sessionManager.listSessions('research')[0];
    expect(session.status).toBe('active');
    expect(session.requestCount).toBe(1);
  });

  it('reuses the same active session in reuse_active', async () => {
    const { base, sessionManager } = await startApp();
    const first = await executeMock(base, ALLOW_BODY);
    const second = await executeMock(base, ALLOW_BODY);
    expect(first.json.execution.output.sessionId).toBe(
      second.json.execution.output.sessionId
    );
    expect(sessionManager.size()).toBe(1);
    expect(sessionManager.listSessions('research')[0].requestCount).toBe(2);
  });

  it('does not create a session when denied', async () => {
    const { base, sessionManager } = await startApp();
    const res = await executeMock(base, DENY_BODY);
    expect(res.json.decision).toBe('denied');
    expect(sessionManager.size()).toBe(0);
  });

  it('does not create a session when pending', async () => {
    const { base, sessionManager } = await startApp();
    const res = await executeMock(base, PENDING_BODY);
    expect(res.json.decision).toBe('pending');
    expect(sessionManager.size()).toBe(0);
  });

  it('rotates the session once maxRequests is reached', async () => {
    const manager = buildBootstrapSessionManager({
      ttlMs: DEFAULT_SESSION_TTL_MS,
      maxRequests: 2,
      reusePolicy: 'reuse_active'
    });
    const { base } = await startApp(manager);
    const r1 = await executeMock(base, ALLOW_BODY);
    const r2 = await executeMock(base, ALLOW_BODY);
    // Third request: the ceiling (2) is reached, so a new session is minted.
    const r3 = await executeMock(base, ALLOW_BODY);

    expect(r1.json.execution.output.sessionId).toBe(
      r2.json.execution.output.sessionId
    );
    expect(r3.json.execution.output.sessionId).not.toBe(
      r2.json.execution.output.sessionId
    );
    const statuses = manager
      .listSessions('research')
      .map((s) => s.status)
      .sort();
    expect(statuses).toEqual(['active', 'rotated']);
  });
});

describe('GRL Local API — GET /v1/compartments', () => {
  it('returns the bootstrap research compartment', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/compartments');
    expect(res.status).toBe(200);
    expect(res.json.compartments).toHaveLength(1);
    const research = res.json.compartments[0];
    expect(research.id).toBe('research');
    expect(research.transportKind).toBe('mock');
    expect(research.reusePolicy).toBe('reuse_active');
  });

  it('returns 405 for a wrong method', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/compartments', { method: 'POST' });
    expect(res.status).toBe(405);
  });
});

describe('GRL Local API — GET /v1/sessions', () => {
  it('returns session metadata without any secret', async () => {
    const { base } = await startApp();
    await executeMock(base, ALLOW_BODY);
    const res = await rawRequest(base, '/v1/sessions');
    expect(res.status).toBe(200);
    expect(res.json.sessions).toHaveLength(1);
    const session = res.json.sessions[0];
    expect(typeof session.sessionId).toBe('string');
    expect(session.compartmentId).toBe('research');
    expect(session.status).toBe('active');
    expect(session.requestCount).toBe(1);
    // No secret/token fields are ever exposed.
    const serialized = JSON.stringify(session);
    expect(serialized).not.toContain('token');
    expect(session.token).toBeUndefined();
  });

  it('filters sessions by compartmentId', async () => {
    const { base } = await startApp();
    await executeMock(base, ALLOW_BODY);
    const match = await rawRequest(base, '/v1/sessions?compartmentId=research');
    expect(match.status).toBe(200);
    expect(match.json.sessions).toHaveLength(1);

    const empty = await rawRequest(base, '/v1/sessions?compartmentId=unknown');
    expect(empty.status).toBe(200);
    expect(empty.json.sessions).toHaveLength(0);
  });

  it('returns 405 for a wrong method', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/sessions', { method: 'POST' });
    expect(res.status).toBe(405);
  });
});

describe('GRL Local API — session env configuration', () => {
  it('resolves ttl/maxRequests/reusePolicy from env without global effect', () => {
    const config = resolveServerConfig({
      GRL_SESSION_TTL_MS: '1234',
      GRL_SESSION_MAX_REQUESTS: '3',
      GRL_SESSION_REUSE_POLICY: 'always_rotate'
    } as NodeJS.ProcessEnv);
    expect(config.sessionTtlMs).toBe(1234);
    expect(config.sessionMaxRequests).toBe(3);
    expect(config.sessionReusePolicy).toBe('always_rotate');
  });

  it('falls back to defaults for missing/invalid env', () => {
    const config = resolveServerConfig({} as NodeJS.ProcessEnv);
    expect(config.sessionTtlMs).toBe(DEFAULT_SESSION_TTL_MS);
    expect(config.sessionMaxRequests).toBe(DEFAULT_SESSION_MAX_REQUESTS);
    expect(config.sessionReusePolicy).toBe(DEFAULT_SESSION_REUSE_POLICY);

    const invalid = resolveServerConfig({
      GRL_SESSION_TTL_MS: 'not-a-number',
      GRL_SESSION_MAX_REQUESTS: '-5',
      GRL_SESSION_REUSE_POLICY: 'bogus'
    } as NodeJS.ProcessEnv);
    expect(invalid.sessionTtlMs).toBe(DEFAULT_SESSION_TTL_MS);
    expect(invalid.sessionMaxRequests).toBe(DEFAULT_SESSION_MAX_REQUESTS);
    expect(invalid.sessionReusePolicy).toBe(DEFAULT_SESSION_REUSE_POLICY);
  });

  it('honours always_rotate end-to-end (a new session per allowed request)', async () => {
    const manager = buildBootstrapSessionManager({
      ttlMs: DEFAULT_SESSION_TTL_MS,
      maxRequests: DEFAULT_SESSION_MAX_REQUESTS,
      reusePolicy: 'always_rotate'
    });
    const { base } = await startApp(manager);
    const first = await executeMock(base, ALLOW_BODY);
    const second = await executeMock(base, ALLOW_BODY);
    expect(first.json.execution.output.sessionId).not.toBe(
      second.json.execution.output.sessionId
    );
    expect(manager.size()).toBe(2);
  });
});
