/**
 * Sprint 32 — Real runtime convergence tests.
 *
 * These verify REAL runtime effects on the `execute` path (not just runtimePolicy
 * metadata): the behavioral/persona/temporal gates run, the temporal delay is
 * actually awaited (bounded, opt-in), and persona/route changes really rotate the
 * session and fingerprint.
 *
 * Sprint integrity update: execute now requires a real configured transport.
 * Tests that need execution to complete (temporal delay, session rotation) use a
 * local in-process mock SearXNG HTTP server so the transport check passes.
 * Tests that verify pre-routing gate effects (behavioral, persona) still work
 * without SearXNG because those gates run before transport selection.
 */

import { AddressInfo, createServer, IncomingMessage, ServerResponse } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TemporalObfuscationEngine,
  NetworkIsolationEngine,
  BehavioralPrivacyEngine,
  DEFAULT_RUNTIME_CONFIG
} from '../../../packages/core/src/index.js';
import { deepClone, createSnapshot } from '../../../packages/core/src/runtime-config/snapshot.js';
import { RuntimeConfigLoader } from '../../../packages/core/src/runtime-config/loader.js';
import { RuntimeConfig, RuntimeConfigSnapshot, RuntimeConfigEvent, TransportPolicyRule } from '../../../packages/core/src/index.js';
import { TransportPolicyEngine } from '../../../packages/core/src/transport-policy/engine.js';
import {
  buildBootstrapFirewall,
  buildMockExecutionEngine,
  createLocalApiApp,
  DEFAULT_HOST
} from '../src/local-api.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

// ---------------------------------------------------------------------------
// Minimal mock SearXNG server
// ---------------------------------------------------------------------------

interface MockSearXngServer {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startMockSearXng(): Promise<MockSearXngServer> {
  const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ query: 'convergence probe', results: [{ title: 'T', url: 'https://example.com', content: 'C' }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  cleanups.push(() => server.close());
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  };
}

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

function makeSearXngConfig(searxngBaseUrl: string): RuntimeConfig {
  const base = deepClone(DEFAULT_RUNTIME_CONFIG);
  const searxngRule: TransportPolicyRule = {
    tool: 'search',
    riskLevel: 'low',
    preferredTransport: 'searxng',
    isolationPolicy: { level: 'session', forceRotateOnHighRisk: true, forbidSessionReuse: false, allowCrossToolReuse: true }
  };
  const filteredPolicies = base.transportPolicies.filter(
    (r: TransportPolicyRule) => !(r.tool === 'search' && r.riskLevel === 'low')
  );
  return {
    ...base,
    transportPolicies: [searxngRule, ...filteredPolicies],
    transports: { searxng: { baseUrl: searxngBaseUrl, timeoutMs: 2000, maxResults: 5, enabled: true } }
  };
}

// ---------------------------------------------------------------------------
// App helpers
// ---------------------------------------------------------------------------

async function startApp(opts: Record<string, unknown> = {}): Promise<{ base: string }> {
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    executionEngine: buildMockExecutionEngine(),
    ...opts
  }) as express.Express;
  const server = app.listen(0, DEFAULT_HOST);
  await new Promise<void>((r) => server.once('listening', r));
  const address = server.address() as AddressInfo;
  cleanups.push(() => server.close());
  return { base: `http://${DEFAULT_HOST}:${address.port}` };
}

/** Start an app wired with a real (in-process mock) SearXNG transport. */
async function startAppWithSearXng(
  searxngBaseUrl: string,
  opts: Record<string, unknown> = {}
): Promise<{ base: string }> {
  const cfg = makeSearXngConfig(searxngBaseUrl);
  const snapshot = createSnapshot(cfg, Date.now());
  const fakeLoader = makeStubLoader(snapshot);
  const transportPolicyEngine = new TransportPolicyEngine();
  for (const rule of cfg.transportPolicies) transportPolicyEngine.registerRule(rule);

  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    executionEngine: buildMockExecutionEngine(),
    transportPolicyEngine,
    runtimeConfigLoader: fakeLoader,
    ...opts
  }) as express.Express;
  const server = app.listen(0, DEFAULT_HOST);
  await new Promise<void>((r) => server.once('listening', r));
  const address = server.address() as AddressInfo;
  cleanups.push(() => server.close());
  return { base: `http://${DEFAULT_HOST}:${address.port}` };
}

function post(base: string, p: string, body: unknown) {
  return fetch(`${base}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));
}
function get(base: string, p: string) {
  return fetch(`${base}${p}`).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));
}

const BODY = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'low',
  input: 'convergence probe'
};

function delayingTemporalEngine(): TemporalObfuscationEngine {
  return new TemporalObfuscationEngine({
    now: Date.now,
    cadencePolicy: { enabled: true, minSpacingMs: 500, burstPenaltyMs: 100, maxDelayMs: 1000 }
  });
}

// ---------------------------------------------------------------------------
// Gate convergence: behavioral/persona/temporal really run on execute
// (privacy pipeline runs before routing — signals appear even in denied responses)
// ---------------------------------------------------------------------------

describe('privacy gates run on the real execute path', () => {
  it('emits behavioral/persona/temporal signals on execute', async () => {
    const { base } = await startApp();
    const { json } = await post(base, '/v1/capabilities/execute', BODY);
    const sources = new Set((json.runtimePolicy?.signals ?? []).map((s: any) => s.source));
    expect(sources.has('behavioral_privacy')).toBe(true);
    expect(sources.has('persona_isolation')).toBe(true);
    expect(sources.has('temporal_obfuscation')).toBe(true);
  });

  it('really mutates persona/behavioral state on execute (audit-observable)', async () => {
    const { base } = await startApp();
    await post(base, '/v1/capabilities/execute', BODY);
    const personaEvents = await get(base, '/v1/audit/events?type=persona_created');
    expect(personaEvents.json.events.length).toBeGreaterThan(0);
    const fragmentEvents = await get(base, '/v1/audit/events?type=behavior_fragment_created');
    expect(fragmentEvents.json.events.length).toBeGreaterThan(0);
  });
});

it('behavioral critical correlation now DENIES on the real execute path', async () => {
  let current = 1000;
  const engine = new BehavioralPrivacyEngine({ now: () => current });
  for (let i = 0; i < 16; i++) {
    engine.evaluateRequest({ agentId: 'local-agent' });
    engine.recordBehavior({ agentId: 'local-agent' });
    current += 1000;
  }
  const { base } = await startApp({ behavioralPrivacyEngine: engine });
  const { json } = await post(base, '/v1/capabilities/execute', BODY);
  expect(json.decision).toBe('denied');
  expect(json.reason).toBe('critical_correlation_risk');
  expect(json.runtimePolicy.allowed).toBe(false);
});

// ---------------------------------------------------------------------------
// execute fails closed when no real transport is configured
// ---------------------------------------------------------------------------

describe('transport integrity', () => {
  it('denies with NO_REAL_TRANSPORT_AVAILABLE when no real transport is configured', async () => {
    const { base } = await startApp();
    const { json } = await post(base, '/v1/capabilities/execute', BODY);
    expect(json.decision).toBe('denied');
    expect(json.reason).toContain('NO_REAL_TRANSPORT_AVAILABLE');
    expect(json.execution).toBeUndefined();
  });

  it('succeeds with real SearXNG transport configured', async () => {
    const searxng = await startMockSearXng();
    const { base } = await startAppWithSearXng(searxng.baseUrl);
    const { json } = await post(base, '/v1/capabilities/execute', BODY);
    expect(json.decision).toBe('allowed');
    expect(json.execution.transportKind).toBe('searxng');
  });
});

// ---------------------------------------------------------------------------
// Real (not advisory) delay — requires SearXNG to reach applyExecutionDelay
// ---------------------------------------------------------------------------

describe('temporal delay is a real, bounded, opt-in effect', () => {
  it('is OFF by default — no sleep, appliedDelayMs 0 even when a delay is computed', async () => {
    const slept: number[] = [];
    const searxng = await startMockSearXng();
    const { base } = await startAppWithSearXng(searxng.baseUrl, {
      temporalObfuscationEngine: delayingTemporalEngine(),
      sleep: async (ms: number) => { slept.push(ms); }
    });
    await post(base, '/v1/capabilities/execute', BODY);
    const second = await post(base, '/v1/capabilities/execute', BODY);
    expect(slept).toEqual([]);
    expect(second.json.appliedDelayMs).toBe(0);
  });

  it('when enabled, the computed delay is actually awaited (spy), deterministic and capped', async () => {
    const slept: number[] = [];
    const searxng = await startMockSearXng();
    const { base } = await startAppWithSearXng(searxng.baseUrl, {
      temporalObfuscationEngine: delayingTemporalEngine(),
      executionDelayEnabled: true,
      maxExecutionDelayMs: 250,
      sleep: async (ms: number) => { slept.push(ms); }
    });
    await post(base, '/v1/capabilities/execute', BODY);
    const second = await post(base, '/v1/capabilities/execute', BODY);
    const positive = slept.filter((ms) => ms > 0);
    expect(positive.length).toBeGreaterThan(0);
    for (const ms of slept) expect(ms).toBeLessThanOrEqual(250);
    expect(second.json.appliedDelayMs).toBeGreaterThan(0);
    expect(second.json.appliedDelayMs).toBeLessThanOrEqual(250);
  });

  it('the computed delay is deterministic (no uncontrolled randomness)', () => {
    const run = (): number => {
      const e = new TemporalObfuscationEngine({
        now: () => 10_000,
        cadencePolicy: { enabled: true, minSpacingMs: 500, burstPenaltyMs: 100, maxDelayMs: 1000 }
      });
      e.evaluateTemporalRisk('a');
      e.recordExecution({ agentId: 'a' });
      return e.evaluateTemporalRisk('a').delayMs;
    };
    const first = run();
    expect(run()).toBe(first);
  });

  it('really waits on the wall clock (one real-timing test, small cap)', async () => {
    const searxng = await startMockSearXng();
    const { base } = await startAppWithSearXng(searxng.baseUrl, {
      temporalObfuscationEngine: delayingTemporalEngine(),
      executionDelayEnabled: true,
      maxExecutionDelayMs: 40
    });
    await post(base, '/v1/capabilities/execute', BODY);
    const start = Date.now();
    const second = await post(base, '/v1/capabilities/execute', BODY);
    const elapsed = Date.now() - start;
    expect(second.json.appliedDelayMs).toBeGreaterThan(0);
    expect(elapsed).toBeGreaterThanOrEqual(second.json.appliedDelayMs - 5);
  });
});

// ---------------------------------------------------------------------------
// Persona / route changes drive REAL session + fingerprint rotation
// ---------------------------------------------------------------------------

describe('persona / route changes produce real rotations on execute', () => {
  it('a relay-route rotation really rotates the session (audit-observable)', async () => {
    const networkIsolationEngine = new NetworkIsolationEngine({
      rotationPolicy: {
        enabled: true, rotateOnPersonaChange: false, rotateOnCategoryChange: false,
        rotateOnCriticalRisk: false, maxAssignmentsPerRoute: 1
      }
    });
    const searxng = await startMockSearXng();
    const { base } = await startAppWithSearXng(searxng.baseUrl, { networkIsolationEngine });
    await post(base, '/v1/capabilities/execute', BODY);
    const second = await post(base, '/v1/capabilities/execute', BODY);
    expect(second.json.networkIsolation.shouldRotate).toBe(true);
    const rotations = await get(base, '/v1/audit/events?type=session_rotated&compartmentId=research');
    expect(rotations.json.events.length).toBeGreaterThan(0);
  });

  it('a category change rotates the route AND the fingerprint on execute', async () => {
    const searxng = await startMockSearXng();
    const { base } = await startAppWithSearXng(searxng.baseUrl);
    const a = await post(base, '/v1/capabilities/execute', { ...BODY, input: { query: 'q', categoryHint: 'crypto' } });
    const b = await post(base, '/v1/capabilities/execute', { ...BODY, input: { query: 'q2', categoryHint: 'health' } });
    expect(a.json.networkIsolation.shouldRotate).toBe(false);
    expect(b.json.networkIsolation.shouldRotate).toBe(true);
    expect(b.json.fingerprint.rotated).toBe(true);
  });
});
