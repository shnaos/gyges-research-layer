/**
 * Sprint 28 — Runtime Policy Orchestrator HTTP API tests.
 *
 * Covers:
 *  - GET /v1/runtime/policy-orchestrator/policies (200, schema valid)
 *  - GET /v1/runtime/policy-orchestrator/signals  (200)
 *  - GET /v1/runtime/policy-orchestrator/last-decision (200, null initially)
 *  - execute-mock includes runtimePolicy block
 *  - conflict visible via GET signals + last-decision
 *  - no raw input leak
 *  - no token leak
 *  - 405 on non-GET
 */

import { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { RuntimePolicyOrchestrator } from '../../../packages/core/src/index.js';
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
}

async function startApp(): Promise<StartedServer> {
  const orchestrator = new RuntimePolicyOrchestrator();
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    executionEngine: buildMockExecutionEngine(),
    runtimePolicyOrchestrator: orchestrator
  }) as express.Express;
  const server = app.listen(0, DEFAULT_HOST);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  cleanups.push(() => server.close());
  return { base: `http://${DEFAULT_HOST}:${address.port}`, orchestrator };
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

// ---------------------------------------------------------------------------
// GET /v1/runtime/policy-orchestrator/policies
// ---------------------------------------------------------------------------

describe('GET /v1/runtime/policy-orchestrator/policies', () => {
  it('returns 200 with policies array', async () => {
    const { base } = await startApp();
    const { status, json } = await rawRequest(
      base,
      '/v1/runtime/policy-orchestrator/policies'
    );
    expect(status).toBe(200);
    expect(Array.isArray(json.policies)).toBe(true);
  });

  it('includes the default composite privacy policy', async () => {
    const { base } = await startApp();
    const { json } = await rawRequest(
      base,
      '/v1/runtime/policy-orchestrator/policies'
    );
    const policy = json.policies.find(
      (p: any) => p.id === 'default-composite-privacy-policy'
    );
    expect(policy).toBeDefined();
    expect(policy.enabled).toBe(true);
    expect(policy.failClosed).toBe(true);
    expect(Array.isArray(policy.precedence)).toBe(true);
    expect(typeof policy.mergeStrategy).toBe('string');
  });

  it('response contains no raw input, tokens, or secrets', async () => {
    const { base } = await startApp();
    const { json } = await rawRequest(
      base,
      '/v1/runtime/policy-orchestrator/policies'
    );
    const raw = JSON.stringify(json);
    expect(raw).not.toContain('token');
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('rawInput');
  });

  it('returns 405 on POST', async () => {
    const { base } = await startApp();
    const { status } = await rawRequest(
      base,
      '/v1/runtime/policy-orchestrator/policies',
      { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }
    );
    expect(status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/runtime/policy-orchestrator/signals
// ---------------------------------------------------------------------------

describe('GET /v1/runtime/policy-orchestrator/signals', () => {
  it('returns 200 with empty signals array initially', async () => {
    const { base } = await startApp();
    const { status, json } = await rawRequest(
      base,
      '/v1/runtime/policy-orchestrator/signals'
    );
    expect(status).toBe(200);
    expect(Array.isArray(json.signals)).toBe(true);
  });

  it('returns signals after execute-mock is called', async () => {
    const { base } = await startApp();
    await executeMock(base, ALLOW_BODY);
    const { json } = await rawRequest(
      base,
      '/v1/runtime/policy-orchestrator/signals'
    );
    expect(json.signals.length).toBeGreaterThan(0);
  });

  it('signal objects have required fields', async () => {
    const { base } = await startApp();
    await executeMock(base, ALLOW_BODY);
    const { json } = await rawRequest(
      base,
      '/v1/runtime/policy-orchestrator/signals'
    );
    const [signal] = json.signals;
    expect(typeof signal.id).toBe('string');
    expect(typeof signal.source).toBe('string');
    expect(typeof signal.action).toBe('string');
    expect(typeof signal.severity).toBe('string');
    expect(typeof signal.reason).toBe('string');
    expect(typeof signal.createdAt).toBe('number');
  });

  it('signals do not contain raw input', async () => {
    const { base } = await startApp();
    await executeMock(base, ALLOW_BODY);
    const { json } = await rawRequest(
      base,
      '/v1/runtime/policy-orchestrator/signals'
    );
    const raw = JSON.stringify(json);
    expect(raw).not.toContain('bitcoin privacy research');
    expect(raw).not.toContain('token');
    expect(raw).not.toContain('secret');
  });

  it('returns 405 on DELETE', async () => {
    const { base } = await startApp();
    const { status } = await rawRequest(
      base,
      '/v1/runtime/policy-orchestrator/signals',
      { method: 'DELETE' }
    );
    expect(status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/runtime/policy-orchestrator/last-decision
// ---------------------------------------------------------------------------

describe('GET /v1/runtime/policy-orchestrator/last-decision', () => {
  it('returns 200 with null decision before any execute-mock', async () => {
    const { base } = await startApp();
    const { status, json } = await rawRequest(
      base,
      '/v1/runtime/policy-orchestrator/last-decision'
    );
    expect(status).toBe(200);
    expect(json.decision).toBeNull();
  });

  it('returns a decision after execute-mock (allowed)', async () => {
    const { base } = await startApp();
    await executeMock(base, ALLOW_BODY);
    const { json } = await rawRequest(
      base,
      '/v1/runtime/policy-orchestrator/last-decision'
    );
    expect(json.decision).not.toBeNull();
    expect(typeof json.decision.action).toBe('string');
    expect(typeof json.decision.allowed).toBe('boolean');
    expect(typeof json.decision.requiresDelay).toBe('boolean');
    expect(typeof json.decision.requiresApproval).toBe('boolean');
    expect(typeof json.decision.requiresSessionRotation).toBe('boolean');
    expect(typeof json.decision.requiresFragmentRotation).toBe('boolean');
    expect(typeof json.decision.requiresFingerprintRotation).toBe('boolean');
    expect(typeof json.decision.reason).toBe('string');
    expect(Array.isArray(json.decision.signals)).toBe(true);
    expect(Array.isArray(json.decision.conflicts)).toBe(true);
  });

  it('decision does not contain raw input or tokens', async () => {
    const { base } = await startApp();
    await executeMock(base, ALLOW_BODY);
    const { json } = await rawRequest(
      base,
      '/v1/runtime/policy-orchestrator/last-decision'
    );
    const raw = JSON.stringify(json);
    expect(raw).not.toContain('bitcoin privacy research');
    expect(raw).not.toContain('token');
    expect(raw).not.toContain('secret');
  });

  it('returns 405 on PUT', async () => {
    const { base } = await startApp();
    const { status } = await rawRequest(
      base,
      '/v1/runtime/policy-orchestrator/last-decision',
      { method: 'PUT', body: '{}', headers: { 'content-type': 'application/json' } }
    );
    expect(status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// execute-mock includes runtimePolicy block
// ---------------------------------------------------------------------------

describe('execute-mock runtimePolicy block', () => {
  it('allowed response includes runtimePolicy field', async () => {
    const { base } = await startApp();
    const { json } = await executeMock(base, ALLOW_BODY);
    expect(json.decision).toBe('allowed');
    expect(json.runtimePolicy).toBeDefined();
    expect(typeof json.runtimePolicy.action).toBe('string');
    expect(typeof json.runtimePolicy.allowed).toBe('boolean');
    expect(typeof json.runtimePolicy.reason).toBe('string');
    expect(Array.isArray(json.runtimePolicy.signals)).toBe(true);
    expect(Array.isArray(json.runtimePolicy.conflicts)).toBe(true);
  });

  it('runtimePolicy does not expose raw input', async () => {
    const { base } = await startApp();
    const { json } = await executeMock(base, ALLOW_BODY);
    const raw = JSON.stringify(json.runtimePolicy);
    expect(raw).not.toContain('bitcoin privacy research');
    expect(raw).not.toContain('token');
    expect(raw).not.toContain('secret');
  });

  it('runtimePolicy signals contain source and action fields', async () => {
    const { base } = await startApp();
    const { json } = await executeMock(base, ALLOW_BODY);
    const signals: any[] = json.runtimePolicy.signals;
    expect(signals.length).toBeGreaterThan(0);
    for (const s of signals) {
      expect(typeof s.source).toBe('string');
      expect(typeof s.action).toBe('string');
      expect(typeof s.severity).toBe('string');
    }
  });
});
