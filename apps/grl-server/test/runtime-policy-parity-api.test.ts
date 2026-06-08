/**
 * Sprint 29 — Execute / execute-mock orchestration parity, multi-agent signals,
 * and signal-endpoint filter HTTP tests.
 *
 * Covers:
 *  - execute includes a runtimePolicy block (allowed + short-circuit paths)
 *  - parity: common signal sources present in both execute and execute-mock
 *  - multi_agent signal emitted (allow / quota-exceeded / restricted / evicted)
 *  - signals endpoint filters by source / severity / limit
 *  - invalid filter values rejected fail-closed (HTTP 400)
 *  - no token / raw-input leak in execute runtimePolicy
 *  - 405 coherence
 */

import { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RuntimePolicyOrchestrator,
  AgentRegistry
} from '../../../packages/core/src/index.js';
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

interface StartedServer {
  base: string;
  orchestrator: RuntimePolicyOrchestrator;
  registry: AgentRegistry;
}

async function startApp(
  opts: { orchestrator?: RuntimePolicyOrchestrator; registry?: AgentRegistry } = {}
): Promise<StartedServer> {
  const orchestrator = opts.orchestrator ?? new RuntimePolicyOrchestrator();
  const registry = opts.registry ?? new AgentRegistry();
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    executionEngine: buildMockExecutionEngine(),
    mockFallbackEnabled: true,
    runtimePolicyOrchestrator: orchestrator,
    agentRegistry: registry
  }) as express.Express;
  const server = app.listen(0, DEFAULT_HOST);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  cleanups.push(() => server.close());
  return { base: `http://${DEFAULT_HOST}:${address.port}`, orchestrator, registry };
}

async function req(
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

const sources = (json: any): string[] =>
  (json.runtimePolicy?.signals ?? []).map((s: any) => s.source);

// ---------------------------------------------------------------------------
// runtimePolicy presence + parity
// ---------------------------------------------------------------------------

describe('execute / execute-mock runtimePolicy parity', () => {
  it('execute allowed response includes a runtimePolicy block', async () => {
    const { base } = await startApp();
    const { status, json } = await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    expect(status).toBe(200);
    expect(json.decision).toBe('allowed');
    expect(json.runtimePolicy).toBeDefined();
    expect(typeof json.runtimePolicy.action).toBe('string');
    expect(typeof json.runtimePolicy.allowed).toBe('boolean');
    expect(Array.isArray(json.runtimePolicy.signals)).toBe(true);
    expect(Array.isArray(json.runtimePolicy.conflicts)).toBe(true);
  });

  it('execute short-circuit (denied) path still includes runtimePolicy', async () => {
    const registry = new AgentRegistry();
    registry.registerAgent('evicted-agent');
    registry.evictAgent('evicted-agent');
    const { base } = await startApp({ registry });
    const { status, json } = await post(base, '/v1/capabilities/execute', {
      ...ALLOW_BODY,
      agentId: 'evicted-agent'
    });
    expect(status).toBe(200);
    expect(json.decision).toBe('denied');
    expect(json.runtimePolicy).toBeDefined();
    expect(json.runtimePolicy.allowed).toBe(false);
  });

  it('execute and execute-mock share their common signal sources on the allowed path', async () => {
    const { base } = await startApp();
    const mock = await post(base, '/v1/capabilities/execute-mock', ALLOW_BODY);
    const real = await post(base, '/v1/capabilities/execute', ALLOW_BODY);

    const mockSources = new Set(sources(mock.json));
    const realSources = sources(real.json);

    // Every source the real endpoint emitted must also be emitted by the mock
    // endpoint — the transport difference is allowed, the gate vocabulary is not.
    for (const s of realSources) {
      expect(mockSources.has(s)).toBe(true);
    }
    // The key common gates appear in both.
    for (const s of [
      'capability_graph',
      'multi_agent',
      'trust_reputation',
      'capability_firewall',
      'transport_policy',
      'privacy_boundary',
      'transport_fingerprint'
    ]) {
      expect(realSources).toContain(s);
      expect(mockSources.has(s)).toBe(true);
    }
  });

  it('execute runtimePolicy never leaks raw input or tokens', async () => {
    const { base } = await startApp();
    const { json } = await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    const raw = JSON.stringify(json.runtimePolicy);
    expect(raw).not.toContain('bitcoin privacy research');
    expect(raw.toLowerCase()).not.toContain('token');
    expect(raw.toLowerCase()).not.toContain('secret');
  });
});

// ---------------------------------------------------------------------------
// multi_agent signals
// ---------------------------------------------------------------------------

describe('multi_agent runtime signals', () => {
  const multiAgentSignal = (json: any) =>
    (json.runtimePolicy?.signals ?? []).find((s: any) => s.source === 'multi_agent');

  it('emits a multi_agent allow signal for a healthy agent', async () => {
    const { base } = await startApp();
    const { json } = await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    const s = multiAgentSignal(json);
    expect(s).toBeDefined();
    expect(s.action).toBe('allow');
    expect(s.severity).toBe('info');
  });

  it('emits a multi_agent temporary_block signal when the quota is exceeded', async () => {
    const registry = new AgentRegistry();
    registry.registerAgent('busy-agent');
    // Drive activeExecutions to the concurrency ceiling (default 5).
    registry.updateAgent('busy-agent', { activeExecutions: 5 });
    const { base } = await startApp({ registry });
    const { json } = await post(base, '/v1/capabilities/execute', {
      ...ALLOW_BODY,
      agentId: 'busy-agent'
    });
    expect(json.decision).toBe('denied');
    const s = multiAgentSignal(json);
    expect(s).toBeDefined();
    expect(s.action).toBe('temporary_block');
    expect(s.severity).toBe('high');
  });

  it('emits a multi_agent require_approval signal for a restricted agent', async () => {
    const registry = new AgentRegistry();
    registry.registerAgent('restricted-agent');
    registry.restrictAgent('restricted-agent');
    const { base } = await startApp({ registry });
    const { json } = await post(base, '/v1/capabilities/execute', {
      ...ALLOW_BODY,
      agentId: 'restricted-agent'
    });
    expect(json.decision).toBe('pending');
    const s = multiAgentSignal(json);
    expect(s).toBeDefined();
    expect(s.action).toBe('require_approval');
    expect(s.severity).toBe('high');
  });

  it('emits a critical multi_agent deny signal for an evicted agent', async () => {
    const registry = new AgentRegistry();
    registry.registerAgent('gone-agent');
    registry.evictAgent('gone-agent');
    const { base } = await startApp({ registry });
    const { json } = await post(base, '/v1/capabilities/execute', {
      ...ALLOW_BODY,
      agentId: 'gone-agent'
    });
    expect(json.decision).toBe('denied');
    const s = multiAgentSignal(json);
    expect(s).toBeDefined();
    expect(s.action).toBe('deny');
    expect(s.severity).toBe('critical');
  });

  it('surfaces multi_agent signals on the /signals endpoint filtered by source', async () => {
    const { base } = await startApp();
    await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    const { status, json } = await req(
      base,
      '/v1/runtime/policy-orchestrator/signals?source=multi_agent'
    );
    expect(status).toBe(200);
    expect(json.signals.length).toBeGreaterThan(0);
    expect(json.signals.every((s: any) => s.source === 'multi_agent')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// signals endpoint filters
// ---------------------------------------------------------------------------

describe('GET /v1/runtime/policy-orchestrator/signals filters', () => {
  it('filters by severity', async () => {
    const { base } = await startApp();
    await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    const { status, json } = await req(
      base,
      '/v1/runtime/policy-orchestrator/signals?severity=info'
    );
    expect(status).toBe(200);
    expect(json.signals.every((s: any) => s.severity === 'info')).toBe(true);
  });

  it('filters by action', async () => {
    const { base } = await startApp();
    await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    const { status, json } = await req(
      base,
      '/v1/runtime/policy-orchestrator/signals?action=allow'
    );
    expect(status).toBe(200);
    expect(json.signals.every((s: any) => s.action === 'allow')).toBe(true);
  });

  it('honours limit (keeps most recent matching signals)', async () => {
    const { base } = await startApp();
    await post(base, '/v1/capabilities/execute', ALLOW_BODY);
    const { status, json } = await req(
      base,
      '/v1/runtime/policy-orchestrator/signals?limit=2'
    );
    expect(status).toBe(200);
    expect(json.signals.length).toBeLessThanOrEqual(2);
  });

  it('rejects an invalid source with 400', async () => {
    const { base } = await startApp();
    const { status } = await req(
      base,
      '/v1/runtime/policy-orchestrator/signals?source=not_a_source'
    );
    expect(status).toBe(400);
  });

  it('rejects an invalid action with 400', async () => {
    const { base } = await startApp();
    const { status } = await req(
      base,
      '/v1/runtime/policy-orchestrator/signals?action=explode'
    );
    expect(status).toBe(400);
  });

  it('rejects an invalid severity with 400', async () => {
    const { base } = await startApp();
    const { status } = await req(
      base,
      '/v1/runtime/policy-orchestrator/signals?severity=apocalyptic'
    );
    expect(status).toBe(400);
  });

  it('rejects a non-positive / non-integer limit with 400', async () => {
    const { base } = await startApp();
    expect((await req(base, '/v1/runtime/policy-orchestrator/signals?limit=0')).status).toBe(400);
    expect((await req(base, '/v1/runtime/policy-orchestrator/signals?limit=-3')).status).toBe(400);
    expect((await req(base, '/v1/runtime/policy-orchestrator/signals?limit=abc')).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 405 coherence
// ---------------------------------------------------------------------------

describe('405 coherence', () => {
  it('returns 405 for non-GET on the signals endpoint', async () => {
    const { base } = await startApp();
    const { status } = await req(base, '/v1/runtime/policy-orchestrator/signals', {
      method: 'DELETE'
    });
    expect(status).toBe(405);
  });

  it('returns 405 for non-POST on execute', async () => {
    const { base } = await startApp();
    const { status } = await req(base, '/v1/capabilities/execute', { method: 'GET' });
    expect(status).toBe(405);
  });
});
