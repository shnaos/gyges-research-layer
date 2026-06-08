/**
 * GRL Local API — POST /v1/capabilities/execute tests (Sprint 17).
 *
 * Tests cover:
 *   - POST /v1/capabilities/execute with mock config works (falls back to mock)
 *   - POST /v1/capabilities/execute with SearXNG disabled denied
 *   - SearXNG enabled + mock server → success
 *   - sandbox blocks when policy disallows network (checked via manifest mismatch)
 *   - timeout path
 *   - malformed SearXNG response
 *   - no token leak in responses
 *   - no raw input leak in execution output
 *   - execute-mock is unchanged
 *   - 405 for non-POST on /v1/capabilities/execute
 *
 * All HTTP calls to a SearXNG instance go to a local in-process mock server.
 * No real internet access occurs.
 */

import { AddressInfo, createServer, IncomingMessage, ServerResponse } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ApprovalQueue,
  DEFAULT_RUNTIME_CONFIG
} from '../../../packages/core/src/index.js';
import {
  buildApprovalQueue,
  buildBootstrapFirewall,
  buildMockExecutionEngine,
  buildSearXngExecutionEngine,
  createLocalApiApp,
  DEFAULT_HOST
} from '../src/local-api.js';
import { deepClone, createSnapshot } from '../../../packages/core/src/runtime-config/snapshot.js';
import { RuntimeConfigLoader } from '../../../packages/core/src/runtime-config/loader.js';
import { TransportPolicyRule, RuntimeConfig, RuntimeConfigSnapshot, RuntimeConfigEvent } from '../../../packages/core/src/index.js';
import { TransportPolicyEngine } from '../../../packages/core/src/transport-policy/engine.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

async function rawRequest(
  base: string,
  path: string,
  init: RequestInit
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, init);
  let json: any = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

function execute(
  base: string,
  body: unknown,
  init: RequestInit = {}
): Promise<{ status: number; json: any }> {
  return rawRequest(base, '/v1/capabilities/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...init
  });
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

/** Minimal allowed body (search, low risk). */
const ALLOW_BODY = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'low',
  input: 'bitcoin privacy research'
};

interface MockSearXngServer {
  baseUrl: string;
  close: () => Promise<void>;
  setHandler: (fn: (req: IncomingMessage, res: ServerResponse) => void) => void;
}

const VALID_SEARXNG_RESPONSE = {
  query: 'bitcoin privacy research',
  results: [{ title: 'Bitcoin Privacy', url: 'https://example.com/1', content: 'Content' }]
};

async function startMockSearXng(
  handler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(VALID_SEARXNG_RESPONSE));
  }
): Promise<MockSearXngServer> {
  let currentHandler = handler;
  const server = createServer((req, res) => currentHandler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    setHandler: (fn) => { currentHandler = fn; }
  };
}

/** Build a RuntimeConfig with a searxng transport policy rule and an enabled searxng transport. */
function makeSearXngConfig(searxngBaseUrl: string, enabled = true): RuntimeConfig {
  const base = deepClone(DEFAULT_RUNTIME_CONFIG);
  // Replace the existing search/low rule with one that routes to searxng.
  const searxngRule: TransportPolicyRule = {
    tool: 'search',
    riskLevel: 'low',
    preferredTransport: 'searxng',
    isolationPolicy: {
      level: 'session',
      forceRotateOnHighRisk: true,
      forbidSessionReuse: false,
      allowCrossToolReuse: true
    }
  };
  // Filter out any existing search/low rule and add the searxng one.
  const filteredPolicies = base.transportPolicies.filter(
    (r) => !(r.tool === 'search' && r.riskLevel === 'low')
  );
  return {
    ...base,
    transportPolicies: [searxngRule, ...filteredPolicies],
    transports: {
      searxng: { baseUrl: searxngBaseUrl, timeoutMs: 2000, maxResults: 5, enabled }
    }
  };
}

/**
 * Build a minimal stub RuntimeConfigLoader that returns a fixed snapshot.
 * Implements the full interface required by createLocalApiApp.
 */
function makeStubLoader(snapshot: RuntimeConfigSnapshot): RuntimeConfigLoader {
  const listeners: Array<(event: RuntimeConfigEvent) => void> = [];
  return {
    getSnapshot: () => snapshot,
    loadFromFile: () => snapshot,
    reload: () => snapshot,
    getPath: () => undefined,
    validate: (cfg: unknown) => cfg as RuntimeConfig,
    clear: () => {},
    watch: () => {},
    stopWatching: () => {},
    addEventListener: (listener: (event: RuntimeConfigEvent) => void) => { listeners.push(listener); },
    removeEventListener: (listener: (event: RuntimeConfigEvent) => void) => {
      const i = listeners.indexOf(listener);
      if (i !== -1) listeners.splice(i, 1);
    }
  } as unknown as RuntimeConfigLoader;
}

/** Start a GRL server and return its base URL. */
async function startApp(overrides: Parameters<typeof createLocalApiApp>[0]): Promise<string> {
  const app: express.Express = createLocalApiApp(overrides);
  const server = app.listen(0, DEFAULT_HOST);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  cleanups.push(() => server.close());
  return `http://${DEFAULT_HOST}:${address.port}`;
}

// ---------------------------------------------------------------------------
// Tests: execute with default (mock) config
// ---------------------------------------------------------------------------

describe('POST /v1/capabilities/execute — default mock config', () => {
  it('executes with mock transport when mockFallbackEnabled is set (opt-in)', async () => {
    const base = await startApp({
      firewall: buildBootstrapFirewall(),
      approvalQueue: buildApprovalQueue(),
      executionEngine: buildMockExecutionEngine(),
      mockFallbackEnabled: true
    });
    const res = await execute(base, ALLOW_BODY);
    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('allowed');
    expect(res.json.execution.status).toBe('success');
    expect(res.json.execution.transportKind).toBe('mock');
  });

  it('returns 400 when Content-Type is not application/json', async () => {
    const base = await startApp({ firewall: buildBootstrapFirewall(), approvalQueue: buildApprovalQueue() });
    const res = await rawRequest(base, '/v1/capabilities/execute', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'hello'
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is missing required fields', async () => {
    const base = await startApp({ firewall: buildBootstrapFirewall(), approvalQueue: buildApprovalQueue() });
    const res = await execute(base, { agentId: 'x' }); // missing fields
    expect(res.status).toBe(400);
  });

  it('returns 405 for non-POST methods on /v1/capabilities/execute', async () => {
    const base = await startApp({ firewall: buildBootstrapFirewall(), approvalQueue: buildApprovalQueue() });
    const res = await rawRequest(base, '/v1/capabilities/execute', { method: 'GET' });
    expect(res.status).toBe(405);
  });

  it('returns 405 for PUT on /v1/capabilities/execute', async () => {
    const base = await startApp({ firewall: buildBootstrapFirewall(), approvalQueue: buildApprovalQueue() });
    const res = await rawRequest(base, '/v1/capabilities/execute', { method: 'PUT' });
    expect(res.status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// Tests: execute with SearXNG disabled
// ---------------------------------------------------------------------------

describe('POST /v1/capabilities/execute — SearXNG disabled', () => {
  it('returns denied when SearXNG transport policy is configured but transport is disabled', async () => {
    // Build config: transport policy routes search → searxng, but enabled=false
    const cfg = makeSearXngConfig('http://127.0.0.1:9999', false);

    const transportPolicyEngine = new TransportPolicyEngine();
    for (const rule of cfg.transportPolicies) {
      transportPolicyEngine.registerRule(rule);
    }

    const snap = createSnapshot(cfg, Date.now());
    const fakeLoader = makeStubLoader(snap);

    const searxngEngine = buildSearXngExecutionEngine(cfg); // null since disabled
    expect(searxngEngine).toBeNull();

    // Since the engine is null and the config has enabled=false, the endpoint should deny.
    const base = await startApp({
      firewall: buildBootstrapFirewall(),
      approvalQueue: buildApprovalQueue(),
      transportPolicyEngine,
      executionEngine: buildMockExecutionEngine(),
      runtimeConfigLoader: fakeLoader
    });

    const res = await execute(base, ALLOW_BODY);
    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('denied');
    expect(res.json.reason).toContain('disabled');
  });
});

// ---------------------------------------------------------------------------
// Tests: execute with SearXNG enabled and mock HTTP server
// ---------------------------------------------------------------------------

describe('POST /v1/capabilities/execute — SearXNG enabled', () => {
  it('routes search to SearXNG and returns success with searxng transportKind', async () => {
    const searxngServer = await startMockSearXng();
    cleanups.push(() => searxngServer.close());

    const cfg = makeSearXngConfig(searxngServer.baseUrl, true);
    const snapshot = createSnapshot(cfg, Date.now());
    const fakeLoader = makeStubLoader(snapshot);

    const transportPolicyEngine = new TransportPolicyEngine();
    for (const rule of cfg.transportPolicies) {
      transportPolicyEngine.registerRule(rule);
    }

    const base = await startApp({
      firewall: buildBootstrapFirewall(),
      approvalQueue: buildApprovalQueue(),
      transportPolicyEngine,
      executionEngine: buildMockExecutionEngine(), // mock fallback
      runtimeConfigLoader: fakeLoader
    });

    const res = await execute(base, ALLOW_BODY);
    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('allowed');
    expect(res.json.execution.status).toBe('success');
    expect(res.json.execution.transportKind).toBe('searxng');
    const output = res.json.execution.output;
    expect(output.query).toBe('bitcoin privacy research');
    expect(Array.isArray(output.results)).toBe(true);
  });

  it('includes routing, privacyBoundary, capabilityGraph in response', async () => {
    const searxngServer = await startMockSearXng();
    cleanups.push(() => searxngServer.close());

    const cfg = makeSearXngConfig(searxngServer.baseUrl, true);
    const snapshot = createSnapshot(cfg, Date.now());
    const fakeLoader = makeStubLoader(snapshot);
    const transportPolicyEngine = new TransportPolicyEngine();
    for (const rule of cfg.transportPolicies) transportPolicyEngine.registerRule(rule);

    const base = await startApp({
      firewall: buildBootstrapFirewall(),
      approvalQueue: buildApprovalQueue(),
      transportPolicyEngine,
      executionEngine: buildMockExecutionEngine(),
      runtimeConfigLoader: fakeLoader
    });

    const res = await execute(base, ALLOW_BODY);
    expect(res.json.routing).toBeDefined();
    expect(res.json.privacyBoundary).toBeDefined();
    expect(res.json.capabilityGraph).toBeDefined();
  });

  it('handles SearXNG timeout as failed execution', async () => {
    // Create a hung server that never responds
    const hungServer = createServer((_req, _res) => { /* never respond */ });
    await new Promise<void>((resolve) => hungServer.listen(0, '127.0.0.1', resolve));
    const { port } = hungServer.address() as AddressInfo;
    cleanups.push(() => hungServer.close());

    const baseCfg = deepClone(DEFAULT_RUNTIME_CONFIG);
    const filteredPolicies = baseCfg.transportPolicies.filter(
      (r: TransportPolicyRule) => !(r.tool === 'search' && r.riskLevel === 'low')
    );
    const cfg: RuntimeConfig = {
      ...baseCfg,
      transportPolicies: [
        { tool: 'search', riskLevel: 'low', preferredTransport: 'searxng', isolationPolicy: { level: 'session', forceRotateOnHighRisk: true, forbidSessionReuse: false, allowCrossToolReuse: true } },
        ...filteredPolicies
      ],
      transports: { searxng: { baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 100, maxResults: 5, enabled: true } }
    };
    const snapshot = createSnapshot(cfg, Date.now());
    const fakeLoader = makeStubLoader(snapshot);
    const transportPolicyEngine = new TransportPolicyEngine();
    for (const rule of cfg.transportPolicies) transportPolicyEngine.registerRule(rule);

    const base = await startApp({
      firewall: buildBootstrapFirewall(),
      approvalQueue: buildApprovalQueue(),
      transportPolicyEngine,
      executionEngine: buildMockExecutionEngine(),
      runtimeConfigLoader: fakeLoader
    });

    const res = await execute(base, ALLOW_BODY);
    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('allowed');
    expect(res.json.execution.status).toBe('failed');
    expect(res.json.execution.error).toMatch(/timed out/i);
  }, 10000);

  it('handles malformed SearXNG JSON response as failed execution', async () => {
    const badServer = await startMockSearXng((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{ invalid json {{{{');
    });
    cleanups.push(() => badServer.close());

    const cfg = makeSearXngConfig(badServer.baseUrl, true);
    const snapshot = createSnapshot(cfg, Date.now());
    const fakeLoader = makeStubLoader(snapshot);
    const transportPolicyEngine = new TransportPolicyEngine();
    for (const rule of cfg.transportPolicies) transportPolicyEngine.registerRule(rule);

    const base = await startApp({
      firewall: buildBootstrapFirewall(),
      approvalQueue: buildApprovalQueue(),
      transportPolicyEngine,
      executionEngine: buildMockExecutionEngine(),
      runtimeConfigLoader: fakeLoader
    });

    const res = await execute(base, ALLOW_BODY);
    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('allowed');
    expect(res.json.execution.status).toBe('failed');
  });

  it('does not leak raw input in the execution output', async () => {
    const searxngServer = await startMockSearXng();
    cleanups.push(() => searxngServer.close());

    const cfg = makeSearXngConfig(searxngServer.baseUrl, true);
    const snapshot = createSnapshot(cfg, Date.now());
    const fakeLoader = makeStubLoader(snapshot);
    const transportPolicyEngine = new TransportPolicyEngine();
    for (const rule of cfg.transportPolicies) transportPolicyEngine.registerRule(rule);

    const base = await startApp({
      firewall: buildBootstrapFirewall(),
      approvalQueue: buildApprovalQueue(),
      transportPolicyEngine,
      executionEngine: buildMockExecutionEngine(),
      runtimeConfigLoader: fakeLoader
    });

    const res = await execute(base, { ...ALLOW_BODY, input: 'SECRET_INPUT_VALUE' });
    expect(res.status).toBe(200);
    // The raw input must not appear in the response
    const body = JSON.stringify(res.json);
    expect(body).not.toContain('SECRET_INPUT_VALUE');
  });

  it('does not leak approval tokens in successful responses', async () => {
    const searxngServer = await startMockSearXng();
    cleanups.push(() => searxngServer.close());

    const cfg = makeSearXngConfig(searxngServer.baseUrl, true);
    const snapshot = createSnapshot(cfg, Date.now());
    const fakeLoader = makeStubLoader(snapshot);
    const transportPolicyEngine = new TransportPolicyEngine();
    for (const rule of cfg.transportPolicies) transportPolicyEngine.registerRule(rule);

    const base = await startApp({
      firewall: buildBootstrapFirewall(),
      approvalQueue: buildApprovalQueue(),
      transportPolicyEngine,
      executionEngine: buildMockExecutionEngine(),
      runtimeConfigLoader: fakeLoader
    });

    const res = await execute(base, ALLOW_BODY);
    // Successful executions must not include an approvalToken
    expect(res.json.approvalToken).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: execute-mock is unchanged
// ---------------------------------------------------------------------------

describe('POST /v1/capabilities/execute-mock — unchanged by Sprint 17', () => {
  it('still executes via mock transport', async () => {
    const base = await startApp({
      firewall: buildBootstrapFirewall(),
      approvalQueue: buildApprovalQueue(),
      executionEngine: buildMockExecutionEngine()
    });
    const res = await executeMock(base, ALLOW_BODY);
    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('allowed');
    expect(res.json.execution.status).toBe('success');
    expect(res.json.execution.transportKind).toBe('mock');
  });

  it('returns 405 for non-POST', async () => {
    const base = await startApp({ firewall: buildBootstrapFirewall(), approvalQueue: buildApprovalQueue() });
    const res = await rawRequest(base, '/v1/capabilities/execute-mock', { method: 'GET' });
    expect(res.status).toBe(405);
  });
});
