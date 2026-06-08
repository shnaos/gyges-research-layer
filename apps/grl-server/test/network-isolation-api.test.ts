/**
 * Sprint 30 — Privacy Transport Relay & Network Isolation HTTP API tests.
 *
 * Covers:
 *  - execute / execute-mock include a networkIsolation block
 *  - route rotation visible (shouldRotate)
 *  - fail-closed when no relay is available; quarantined compartment denied
 *  - network_isolation runtime signal present + queryable
 *  - GET /v1/network/{relays,routes,bindings,isolation} return metadata only
 *  - no token / host / IP / raw-input leak
 *  - 405 coherence; invalid limit → 400
 */

import { AddressInfo } from 'node:net';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NetworkIsolationEngine,
  CompartmentTrustEngine,
  DEFAULT_RUNTIME_CONFIG,
  type RuntimeConfig,
  type RuntimeConfigSnapshot,
  type RuntimeConfigEvent,
  type TransportPolicyRule
} from '../../../packages/core/src/index.js';
import { deepClone, createSnapshot } from '../../../packages/core/src/runtime-config/snapshot.js';
import type { RuntimeConfigLoader } from '../../../packages/core/src/runtime-config/loader.js';
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

async function startApp(
  opts: {
    networkIsolationEngine?: NetworkIsolationEngine;
    trustEngine?: CompartmentTrustEngine;
  } = {}
): Promise<{ base: string }> {
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    executionEngine: buildMockExecutionEngine(),
    mockFallbackEnabled: true,
    ...(opts.networkIsolationEngine ? { networkIsolationEngine: opts.networkIsolationEngine } : {}),
    ...(opts.trustEngine ? { trustEngine: opts.trustEngine } : {})
  }) as express.Express;
  const server = app.listen(0, DEFAULT_HOST);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  cleanups.push(() => server.close());
  return { base: `http://${DEFAULT_HOST}:${address.port}` };
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
    }
  } as unknown as RuntimeConfigLoader;
}

async function startAppWithSearXng(
  opts: { networkIsolationEngine?: NetworkIsolationEngine; trustEngine?: CompartmentTrustEngine } = {}
): Promise<{ base: string }> {
  const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ query: 'probe', results: [{ title: 'T', url: 'https://example.com', content: 'C' }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  cleanups.push(() => server.close());
  const searxngBaseUrl = `http://127.0.0.1:${port}`;
  const cfg: RuntimeConfig = { ...deepClone(DEFAULT_RUNTIME_CONFIG), transports: { searxng: { baseUrl: searxngBaseUrl, timeoutMs: 2000, maxResults: 5, enabled: true } } };
  const snapshot = createSnapshot(cfg, Date.now());
  const transportPolicyEngine = new TransportPolicyEngine();
  for (const rule of cfg.transportPolicies as TransportPolicyRule[]) transportPolicyEngine.registerRule(rule);
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    executionEngine: buildMockExecutionEngine(),
    transportPolicyEngine,
    runtimeConfigLoader: makeStubLoader(snapshot),
    ...(opts.networkIsolationEngine ? { networkIsolationEngine: opts.networkIsolationEngine } : {}),
    ...(opts.trustEngine ? { trustEngine: opts.trustEngine } : {})
  }) as express.Express;
  const srv = app.listen(0, DEFAULT_HOST);
  await new Promise<void>((resolve) => srv.once('listening', resolve));
  const address = srv.address() as AddressInfo;
  cleanups.push(() => srv.close());
  return { base: `http://${DEFAULT_HOST}:${address.port}` };
}

async function req(base: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${base}${path}`, init);
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}
function post(base: string, path: string, body: unknown) {
  return req(base, path, {
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

function quarantinedTrustEngine(): CompartmentTrustEngine {
  const engine = new CompartmentTrustEngine();
  for (let i = 0; i < 3; i++) {
    engine.recordEvent({
      compartmentId: 'research',
      type: 'incident_opened',
      incidentSeverity: 'critical',
      reason: 'seed'
    });
  }
  return engine;
}

// ---------------------------------------------------------------------------
// networkIsolation on execute responses
// ---------------------------------------------------------------------------

describe('execute networkIsolation block', () => {
  it('execute allowed response includes a networkIsolation block', async () => {
    const { base } = await startAppWithSearXng();
    const { status, json } = await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    expect(status).toBe(200);
    expect(json.decision).toBe('allowed');
    expect(json.networkIsolation).toBeDefined();
    expect(json.networkIsolation.allowed).toBe(true);
    expect(json.networkIsolation.relayProfileId).toBe('local-default');
    expect(json.networkIsolation.relayRouteId).toMatch(/^route-\d{3}$/);
    expect(json.networkIsolation.isolationLevel).toBe('isolated');
    expect(json.networkIsolation.shouldRotate).toBe(false);
  });

  it('execute-mock also includes a networkIsolation block (parity)', async () => {
    const { base } = await startApp();
    const { json } = await post(base, '/v1/capabilities/execute-mock', ALLOW_BODY);
    expect(json.networkIsolation).toBeDefined();
    expect(json.networkIsolation.isolationLevel).toBe('isolated');
  });

  it('emits a network_isolation runtime signal', async () => {
    const { base } = await startApp();
    const { json } = await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    const sig = json.runtimePolicy.signals.find((s: any) => s.source === 'network_isolation');
    expect(sig).toBeDefined();
    expect(sig.action).toBe('allow');
  });

  it('rotates the route when the research category (persona scope) changes', async () => {
    const { base } = await startApp();
    const crypto = await post(base, '/v1/capabilities/execute', {
      ...ALLOW_BODY,
      input: { query: 'q', categoryHint: 'crypto' }
    });
    expect(crypto.json.networkIsolation.shouldRotate).toBe(false);
    // Same category → stable route.
    const cryptoAgain = await post(base, '/v1/capabilities/execute', {
      ...ALLOW_BODY,
      input: { query: 'q2', categoryHint: 'crypto' }
    });
    expect(cryptoAgain.json.networkIsolation.shouldRotate).toBe(false);
    expect(cryptoAgain.json.networkIsolation.relayRouteId).toBe(crypto.json.networkIsolation.relayRouteId);
    // Switch category → rotation.
    const health = await post(base, '/v1/capabilities/execute', {
      ...ALLOW_BODY,
      input: { query: 'q3', categoryHint: 'health' }
    });
    expect(health.json.networkIsolation.shouldRotate).toBe(true);
    expect(health.json.networkIsolation.relayRouteId).not.toBe(crypto.json.networkIsolation.relayRouteId);
  });

  it('route rotation is visible (shouldRotate true) when the assignment ceiling is hit', async () => {
    const engine = new NetworkIsolationEngine({
      rotationPolicy: {
        enabled: true, rotateOnPersonaChange: false, rotateOnCategoryChange: false,
        rotateOnCriticalRisk: false, maxAssignmentsPerRoute: 1
      }
    });
    const { base } = await startApp({ networkIsolationEngine: engine });
    const first = await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    expect(first.json.networkIsolation.shouldRotate).toBe(false);
    const second = await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    expect(second.json.networkIsolation.shouldRotate).toBe(true);
    expect(second.json.networkIsolation.relayRouteId).not.toBe(first.json.networkIsolation.relayRouteId);
  });
});

// ---------------------------------------------------------------------------
// fail-closed
// ---------------------------------------------------------------------------

describe('network isolation fail-closed', () => {
  it('denies the request when no relay is available', async () => {
    const engine = new NetworkIsolationEngine({ seedDefaultProfile: false });
    const { base } = await startApp({ networkIsolationEngine: engine });
    const { json } = await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    expect(json.decision).toBe('denied');
    expect(json.networkIsolation.allowed).toBe(false);
    expect(json.reason).toMatch(/relay/i);
    const sig = json.runtimePolicy.signals.find((s: any) => s.source === 'network_isolation');
    expect(sig.action).toBe('deny');
    expect(sig.severity).toBe('critical');
  });

  it('denies a quarantined compartment', async () => {
    const { base } = await startApp({ trustEngine: quarantinedTrustEngine() });
    const { json } = await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    expect(json.decision).toBe('denied');
    expect(json.reason).toMatch(/quarantined/i);
  });
});

// ---------------------------------------------------------------------------
// read endpoints
// ---------------------------------------------------------------------------

describe('GET /v1/network/* endpoints', () => {
  it('lists relay profiles (metadata only, includes local-default)', async () => {
    const { base } = await startApp();
    const { status, json } = await req(base, '/v1/network/relays');
    expect(status).toBe(200);
    expect(Array.isArray(json.relays)).toBe(true);
    const def = json.relays.find((r: any) => r.id === 'local-default');
    expect(def).toBeDefined();
    expect(def.isolationLevel).toBe('isolated');
  });

  it('lists routes after an execute', async () => {
    const { base } = await startApp();
    await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    const { json } = await req(base, '/v1/network/routes');
    expect(json.routes.length).toBeGreaterThan(0);
    expect(json.routes[0].id).toMatch(/^route-\d{3}$/);
  });

  it('lists compartment bindings after an execute', async () => {
    const { base } = await startApp();
    await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    const { json } = await req(base, '/v1/network/bindings');
    const binding = json.bindings.find((b: any) => b.compartmentId === 'research');
    expect(binding).toBeDefined();
    expect(binding.isolationLevel).toBe('isolated');
  });

  it('returns DNS + rotation isolation policies', async () => {
    const { base } = await startApp();
    const { status, json } = await req(base, '/v1/network/isolation');
    expect(status).toBe(200);
    expect(json.dnsPolicy.enabled).toBe(true);
    expect(json.dnsPolicy.isolatePerCompartment).toBe(true);
    expect(typeof json.rotationPolicy.maxAssignmentsPerRoute).toBe('number');
  });

  it('honours the limit query param and rejects an invalid limit with 400', async () => {
    const { base } = await startApp();
    await post(base, '/v1/capabilities/execute', { ...ALLOW_BODY, compartmentId: 'a' });
    await post(base, '/v1/capabilities/execute', { ...ALLOW_BODY, compartmentId: 'b' });
    const ok = await req(base, '/v1/network/routes?limit=1');
    expect(ok.json.routes.length).toBeLessThanOrEqual(1);
    expect((await req(base, '/v1/network/routes?limit=0')).status).toBe(400);
    expect((await req(base, '/v1/network/relays?limit=abc')).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// privacy: no leaks
// ---------------------------------------------------------------------------

describe('network isolation privacy guarantees', () => {
  it('never leaks raw input, hosts, IPs, or tokens across network metadata', async () => {
    const { base } = await startApp();
    const exec = await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    const relays = await req(base, '/v1/network/relays');
    const routes = await req(base, '/v1/network/routes');
    const bindings = await req(base, '/v1/network/bindings');
    const isolation = await req(base, '/v1/network/isolation');
    const blob = JSON.stringify([
      exec.json.networkIsolation,
      relays.json,
      routes.json,
      bindings.json,
      isolation.json
    ]);
    expect(blob).not.toContain('bitcoin privacy research'); // raw input
    expect(blob.toLowerCase()).not.toContain('token');
    expect(blob.toLowerCase()).not.toContain('secret');
    expect(blob).not.toMatch(/\bhttps?:\/\//); // no URLs
    expect(blob).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/); // no IPv4
  });
});

// ---------------------------------------------------------------------------
// 405 coherence
// ---------------------------------------------------------------------------

describe('405 coherence', () => {
  it('returns 405 for non-GET on network endpoints', async () => {
    const { base } = await startApp();
    for (const path of ['/v1/network/relays', '/v1/network/routes', '/v1/network/bindings', '/v1/network/isolation']) {
      const { status } = await req(base, path, { method: 'POST' });
      expect(status).toBe(405);
    }
  });
});
