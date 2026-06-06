/**
 * Sprint 28 — Agent SDK: Runtime Policy Orchestrator methods.
 *
 * Covers:
 *  - listRuntimePolicyOrchestratorPolicies()
 *  - listRuntimePolicySignals()
 *  - getLastRuntimePolicyDecision()
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { GrlAgentClient } from '../src/client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockFetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(handler: MockFetchHandler): void {
  vi.stubGlobal('fetch', vi.fn(handler));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const client = new GrlAgentClient({ baseUrl: 'http://127.0.0.1:8787', timeoutMs: 100 });

// ---------------------------------------------------------------------------
// listRuntimePolicyOrchestratorPolicies
// ---------------------------------------------------------------------------

describe('GrlAgentClient.listRuntimePolicyOrchestratorPolicies()', () => {
  it('GET /v1/runtime/policy-orchestrator/policies and returns policies array', async () => {
    const mockPolicies = [
      {
        id: 'default-composite-privacy-policy',
        enabled: true,
        precedence: ['capability_firewall', 'sandbox'],
        defaultAction: 'allow',
        failClosed: true,
        mergeStrategy: 'most_restrictive'
      }
    ];
    mockFetch(() => jsonResponse({ policies: mockPolicies }));
    const result = await client.listRuntimePolicyOrchestratorPolicies();
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].id).toBe('default-composite-privacy-policy');
    expect(result[0].failClosed).toBe(true);
    expect(result[0].mergeStrategy).toBe('most_restrictive');
  });

  it('returns empty array when policies is empty', async () => {
    mockFetch(() => jsonResponse({ policies: [] }));
    const result = await client.listRuntimePolicyOrchestratorPolicies();
    expect(result).toHaveLength(0);
  });

  it('calls the correct URL', async () => {
    let capturedUrl = '';
    mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse({ policies: [] });
    });
    await client.listRuntimePolicyOrchestratorPolicies();
    expect(capturedUrl).toContain('/v1/runtime/policy-orchestrator/policies');
  });

  it('uses GET method', async () => {
    let capturedMethod = '';
    mockFetch((_url, init) => {
      capturedMethod = init?.method ?? 'GET';
      return jsonResponse({ policies: [] });
    });
    await client.listRuntimePolicyOrchestratorPolicies();
    expect(capturedMethod).toBe('GET');
  });
});

// ---------------------------------------------------------------------------
// listRuntimePolicySignals
// ---------------------------------------------------------------------------

describe('GrlAgentClient.listRuntimePolicySignals()', () => {
  it('GET /v1/runtime/policy-orchestrator/signals and returns signals array', async () => {
    const mockSignals = [
      {
        id: 'sig-001',
        source: 'capability_firewall',
        action: 'deny',
        severity: 'critical',
        reason: 'firewall rejected',
        createdAt: Date.now()
      }
    ];
    mockFetch(() => jsonResponse({ signals: mockSignals }));
    const result = await client.listRuntimePolicySignals();
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].id).toBe('sig-001');
    expect(result[0].source).toBe('capability_firewall');
    expect(result[0].action).toBe('deny');
    expect(result[0].severity).toBe('critical');
  });

  it('returns empty array when signals is empty', async () => {
    mockFetch(() => jsonResponse({ signals: [] }));
    const result = await client.listRuntimePolicySignals();
    expect(result).toHaveLength(0);
  });

  it('calls the correct URL', async () => {
    let capturedUrl = '';
    mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse({ signals: [] });
    });
    await client.listRuntimePolicySignals();
    expect(capturedUrl).toContain('/v1/runtime/policy-orchestrator/signals');
  });

  it('uses GET method', async () => {
    let capturedMethod = '';
    mockFetch((_url, init) => {
      capturedMethod = init?.method ?? 'GET';
      return jsonResponse({ signals: [] });
    });
    await client.listRuntimePolicySignals();
    expect(capturedMethod).toBe('GET');
  });
});

// ---------------------------------------------------------------------------
// getLastRuntimePolicyDecision
// ---------------------------------------------------------------------------

describe('GrlAgentClient.getLastRuntimePolicyDecision()', () => {
  it('returns null when no decision has been produced', async () => {
    mockFetch(() => jsonResponse({ decision: null }));
    const result = await client.getLastRuntimePolicyDecision();
    expect(result).toBeNull();
  });

  it('returns a decision object when available', async () => {
    const mockDecision = {
      action: 'allow',
      allowed: true,
      requiresDelay: false,
      requiresApproval: false,
      requiresSessionRotation: false,
      requiresFragmentRotation: false,
      requiresFingerprintRotation: false,
      reason: 'No restrictive signals detected.',
      signals: [],
      conflicts: []
    };
    mockFetch(() => jsonResponse({ decision: mockDecision }));
    const result = await client.getLastRuntimePolicyDecision();
    expect(result).not.toBeNull();
    expect(result!.action).toBe('allow');
    expect(result!.allowed).toBe(true);
    expect(result!.requiresApproval).toBe(false);
    expect(Array.isArray(result!.signals)).toBe(true);
    expect(Array.isArray(result!.conflicts)).toBe(true);
  });

  it('returns decision with delayMs when set', async () => {
    const mockDecision = {
      action: 'delay',
      allowed: false,
      requiresDelay: true,
      delayMs: 2000,
      requiresApproval: false,
      requiresSessionRotation: false,
      requiresFragmentRotation: false,
      requiresFingerprintRotation: false,
      reason: 'Delay applied by temporal_obfuscation.',
      signals: [],
      conflicts: []
    };
    mockFetch(() => jsonResponse({ decision: mockDecision }));
    const result = await client.getLastRuntimePolicyDecision();
    expect(result!.requiresDelay).toBe(true);
    expect(result!.delayMs).toBe(2000);
  });

  it('calls the correct URL', async () => {
    let capturedUrl = '';
    mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse({ decision: null });
    });
    await client.getLastRuntimePolicyDecision();
    expect(capturedUrl).toContain('/v1/runtime/policy-orchestrator/last-decision');
  });

  it('uses GET method', async () => {
    let capturedMethod = '';
    mockFetch((_url, init) => {
      capturedMethod = init?.method ?? 'GET';
      return jsonResponse({ decision: null });
    });
    await client.getLastRuntimePolicyDecision();
    expect(capturedMethod).toBe('GET');
  });
});
