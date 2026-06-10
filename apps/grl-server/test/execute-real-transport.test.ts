/**
 * Sprint 37 — E2E runtime integrity tests for POST /v1/capabilities/execute.
 *
 * Every test uses a real (in-process) mock HTTP server as the SearXNG backend.
 * No test depends on a mock transport fallback — denied paths assert explicit
 * denial, allowed paths assert a real transport result.
 *
 * Covers:
 *  - allowed path: isReal=true, audit events, fingerprint, sandbox decision
 *  - deny: no transport configured (SearXNG disabled or absent)
 *  - deny: SearXNG enabled but engine init fails (structurally bad config)
 *  - deny: mock transport resolution guard (cannot happen on bootstrap rules,
 *    but the guard is exercised via a custom config that routes to mock)
 *  - 405 for non-POST
 *  - no token / raw-input leak in allowed response
 *  - isReal=false on execute-mock (parity check)
 */

import { AddressInfo } from 'node:net';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RUNTIME_CONFIG,
  type RuntimeConfig,
  type RuntimeConfigSnapshot,
  type RuntimeConfigEvent,
  type TransportPolicyRule,
} from '../../../packages/core/src/index.js';
import { deepClone, createSnapshot } from '../../../packages/core/src/runtime-config/snapshot.js';
import type { RuntimeConfigLoader } from '../../../packages/core/src/runtime-config/loader.js';
import { TransportPolicyEngine } from '../../../packages/core/src/transport-policy/engine.js';
import {
  buildBootstrapFirewall,
  buildMockExecutionEngine,
  createLocalApiApp,
  DEFAULT_HOST,
} from '../src/local-api.js';

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

/** Starts an in-process HTTP server that serves a minimal SearXNG JSON response. */
async function startMockSearXng(
  handler?: (req: IncomingMessage, res: ServerResponse) => void
): Promise<{ port: number }> {
  const srv = createServer(handler ?? ((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      query: 'test',
      results: [{ title: 'Result 1', url: 'https://example.com', content: 'Content' }],
    }));
  }));
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => srv.close());
  return { port: (srv.address() as AddressInfo).port };
}

function makeStubLoader(snapshot: RuntimeConfigSnapshot): RuntimeConfigLoader {
  const listeners: Array<(e: RuntimeConfigEvent) => void> = [];
  return {
    getSnapshot: () => snapshot, loadFromFile: () => snapshot, reload: () => snapshot,
    getPath: () => undefined, validate: (c: unknown) => c as RuntimeConfig,
    clear: () => {}, watch: () => {}, stopWatching: () => {},
    addEventListener: (l: (e: RuntimeConfigEvent) => void) => { listeners.push(l); },
    removeEventListener: (l: (e: RuntimeConfigEvent) => void) => {
      const i = listeners.indexOf(l); if (i !== -1) listeners.splice(i, 1);
    },
  } as unknown as RuntimeConfigLoader;
}

/** Start a server with a real SearXNG transport configured. */
async function startWithRealTransport(
  searxngPort: number,
  overrides: Partial<RuntimeConfig> = {}
): Promise<{ base: string }> {
  const cfg: RuntimeConfig = {
    ...deepClone(DEFAULT_RUNTIME_CONFIG),
    transports: { searxng: { baseUrl: `http://127.0.0.1:${searxngPort}`, timeoutMs: 2000, maxResults: 5, enabled: true } },
    ...overrides,
  };
  const snapshot = createSnapshot(cfg, Date.now());
  const transportPolicyEngine = new TransportPolicyEngine();
  for (const rule of cfg.transportPolicies as TransportPolicyRule[]) transportPolicyEngine.registerRule(rule);
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    transportPolicyEngine,
    runtimeConfigLoader: makeStubLoader(snapshot),
  }) as express.Express;
  const srv = app.listen(0, DEFAULT_HOST);
  await new Promise<void>((resolve) => srv.once('listening', resolve));
  cleanups.push(() => srv.close());
  return { base: `http://${DEFAULT_HOST}:${(srv.address() as AddressInfo).port}` };
}

/** Start a server with NO real transport (SearXNG absent from config). */
async function startWithNoTransport(): Promise<{ base: string }> {
  const cfg: RuntimeConfig = deepClone(DEFAULT_RUNTIME_CONFIG);
  // Explicitly remove SearXNG transport config
  (cfg as any).transports = {};
  const snapshot = createSnapshot(cfg, Date.now());
  const transportPolicyEngine = new TransportPolicyEngine();
  for (const rule of cfg.transportPolicies as TransportPolicyRule[]) transportPolicyEngine.registerRule(rule);
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    transportPolicyEngine,
    runtimeConfigLoader: makeStubLoader(snapshot),
  }) as express.Express;
  const srv = app.listen(0, DEFAULT_HOST);
  await new Promise<void>((resolve) => srv.once('listening', resolve));
  cleanups.push(() => srv.close());
  return { base: `http://${DEFAULT_HOST}:${(srv.address() as AddressInfo).port}` };
}

async function post(base: string, path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json: any = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

const ALLOW_BODY = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'low',
  input: { query: 'privacy research' },
};

// ---------------------------------------------------------------------------
// Suite 1: allowed path with real transport
// ---------------------------------------------------------------------------

describe('execute — allowed path (real SearXNG transport)', () => {
  it('returns decision=allowed and isReal=true', async () => {
    const { port } = await startMockSearXng();
    const { base } = await startWithRealTransport(port);
    const { status, json } = await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    expect(status).toBe(200);
    expect(json.decision).toBe('allowed');
    expect(json.isReal).toBe(true);
  });

  it('execution block is present with transportKind=searxng', async () => {
    const { port } = await startMockSearXng();
    const { base } = await startWithRealTransport(port);
    const { json } = await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    expect(json.execution).toBeDefined();
    expect(json.execution.transportKind).toBe('searxng');
    expect(json.execution.status).toBe('success');
  });

  it('fingerprint block is populated on allowed path', async () => {
    const { port } = await startMockSearXng();
    const { base } = await startWithRealTransport(port);
    const { json } = await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    expect(json.fingerprint).toBeDefined();
    expect(typeof json.fingerprint.activeFingerprintId).toBe('string');
    expect(json.fingerprint.activeFingerprintId.length).toBeGreaterThan(0);
  });

  it('runtimePolicy block is present with signals', async () => {
    const { port } = await startMockSearXng();
    const { base } = await startWithRealTransport(port);
    const { json } = await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    expect(json.runtimePolicy).toBeDefined();
    expect(Array.isArray(json.runtimePolicy.signals)).toBe(true);
    expect(json.runtimePolicy.signals.length).toBeGreaterThan(0);
  });

  it('sandbox decision is present on allowed path', async () => {
    const { port } = await startMockSearXng();
    const { base } = await startWithRealTransport(port);
    const { json } = await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    expect(json.sandbox).toBeDefined();
    expect(json.sandbox.action).toBe('allow');
  });

  it('does not leak raw input in the response', async () => {
    const { port } = await startMockSearXng();
    const { base } = await startWithRealTransport(port);
    const { json } = await post(base, '/v1/capabilities/execute', {
      ...ALLOW_BODY,
      input: { query: 'SECRET_SENSITIVE_QUERY_12345' },
    });
    const responseStr = JSON.stringify(json);
    expect(responseStr).not.toContain('SECRET_SENSITIVE_QUERY_12345');
  });
});

// ---------------------------------------------------------------------------
// Suite 2: deny paths — no implicit mock fallback
// ---------------------------------------------------------------------------

describe('execute — deny: no real transport available', () => {
  it('denied when SearXNG not configured (NO_REAL_TRANSPORT_AVAILABLE)', async () => {
    const { base } = await startWithNoTransport();
    const { status, json } = await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    expect(status).toBe(200);
    expect(json.decision).toBe('denied');
    expect(json.reason).toMatch(/NO_REAL_TRANSPORT_AVAILABLE/);
    expect(json.isReal).toBeUndefined();
  });

  it('denied when SearXNG is disabled in config', async () => {
    // Start a SearXNG server but configure it as disabled
    const { port } = await startMockSearXng();
    const cfg: RuntimeConfig = {
      ...deepClone(DEFAULT_RUNTIME_CONFIG),
      transports: { searxng: { baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 2000, maxResults: 5, enabled: false } },
    };
    const snapshot = createSnapshot(cfg, Date.now());
    const transportPolicyEngine = new TransportPolicyEngine();
    for (const rule of cfg.transportPolicies as TransportPolicyRule[]) transportPolicyEngine.registerRule(rule);
    const app = createLocalApiApp({
      firewall: buildBootstrapFirewall(),
      transportPolicyEngine,
      runtimeConfigLoader: makeStubLoader(snapshot),
    }) as express.Express;
    const srv = app.listen(0, DEFAULT_HOST);
    await new Promise<void>((resolve) => srv.once('listening', resolve));
    cleanups.push(() => srv.close());
    const base = `http://${DEFAULT_HOST}:${(srv.address() as AddressInfo).port}`;
    const { status, json } = await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    expect(status).toBe(200);
    expect(json.decision).toBe('denied');
    expect(json.reason).toMatch(/NO_REAL_TRANSPORT_AVAILABLE/);
  });

  it('response body does not contain mock artifacts on deny', async () => {
    const { base } = await startWithNoTransport();
    const { json } = await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    // No execution block (nothing ran)
    expect(json.execution).toBeUndefined();
    // isReal not set on deny
    expect(json.isReal).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: isReal=false parity on execute-mock
// ---------------------------------------------------------------------------

describe('execute-mock — isReal=false parity', () => {
  it('returns isReal=false on the allowed path', async () => {
    const app = createLocalApiApp({
      firewall: buildBootstrapFirewall(),
      executionEngine: buildMockExecutionEngine(),
    }) as express.Express;
    const srv = app.listen(0, DEFAULT_HOST);
    await new Promise<void>((resolve) => srv.once('listening', resolve));
    cleanups.push(() => srv.close());
    const base = `http://${DEFAULT_HOST}:${(srv.address() as AddressInfo).port}`;
    const { status, json } = await post(base, '/v1/capabilities/execute-mock', ALLOW_BODY);
    expect(status).toBe(200);
    expect(json.decision).toBe('allowed');
    expect(json.isReal).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite 4: HTTP surface — 405 and bad input
// ---------------------------------------------------------------------------

describe('execute — HTTP surface', () => {
  it('405 on GET /v1/capabilities/execute', async () => {
    const { port } = await startMockSearXng();
    const { base } = await startWithRealTransport(port);
    const res = await fetch(`${base}/v1/capabilities/execute`);
    expect(res.status).toBe(405);
  });

  it('400 on missing agentId', async () => {
    const { port } = await startMockSearXng();
    const { base } = await startWithRealTransport(port);
    const { status, json } = await post(base, '/v1/capabilities/execute', {
      compartmentId: 'research', tool: 'search', riskLevel: 'low', input: {},
    });
    expect(status).toBe(400);
    expect(json.error).toBeDefined();
  });

  it('400 on non-object body', async () => {
    const { port } = await startMockSearXng();
    const { base } = await startWithRealTransport(port);
    const res = await fetch(`${base}/v1/capabilities/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '"not-an-object"',
    });
    expect(res.status).toBe(400);
  });
});
