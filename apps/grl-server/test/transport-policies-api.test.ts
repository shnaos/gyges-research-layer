import { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CapabilityFirewall,
  PrivacyBoundaryEngine,
  SessionManager,
  TransportPolicyEngine,
  BOOTSTRAP_FETCH_HTML_RULE,
  BOOTSTRAP_SEARCH_RULE
} from '../../../packages/core/src/index.js';
import { PolicyDocument, YamlPolicyEngine } from '../../../packages/policy-engine/src/index.js';
import {
  buildApprovalQueue,
  buildBootstrapFirewall,
  buildBootstrapPrivacyBoundaryEngine,
  buildBootstrapSessionManager,
  buildBootstrapTransportPolicyEngine,
  buildMockExecutionEngine,
  createLocalApiApp,
  DEFAULT_HOST,
  DEFAULT_SESSION_MAX_REQUESTS,
  DEFAULT_SESSION_TTL_MS
} from '../src/local-api.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

interface StartedServer {
  base: string;
  sessionManager: SessionManager;
}

interface StartOptions {
  firewall?: CapabilityFirewall;
  sessionManager?: SessionManager;
  transportPolicyEngine?: TransportPolicyEngine;
  privacyBoundaryEngine?: PrivacyBoundaryEngine;
}

async function startApp(options: StartOptions = {}): Promise<StartedServer> {
  const sessionManager =
    options.sessionManager ??
    buildBootstrapSessionManager({
      ttlMs: DEFAULT_SESSION_TTL_MS,
      maxRequests: DEFAULT_SESSION_MAX_REQUESTS,
      reusePolicy: 'reuse_active'
    });
  const app: express.Express = createLocalApiApp({
    firewall: options.firewall ?? buildBootstrapFirewall(),
    approvalQueue: buildApprovalQueue(),
    executionEngine: buildMockExecutionEngine(),
    sessionManager,
    transportPolicyEngine:
      options.transportPolicyEngine ?? buildBootstrapTransportPolicyEngine(),
    privacyBoundaryEngine:
      options.privacyBoundaryEngine ?? buildBootstrapPrivacyBoundaryEngine()
  });
  const server = app.listen(0, DEFAULT_HOST);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  cleanups.push(() => server.close());
  return { base: `http://${DEFAULT_HOST}:${address.port}`, sessionManager };
}

async function rawRequest(
  base: string,
  path: string,
  init: RequestInit
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

/**
 * Firewall that allows fetch_html at medium risk WITHOUT confirmation, so the
 * routing/rotation path is reachable over HTTP (the bootstrap firewall would
 * route medium fetch_html into the approval queue instead).
 */
function fetchHtmlNoConfirmFirewall(): CapabilityFirewall {
  const policy: PolicyDocument = {
    defaultDeny: true,
    rules: [
      {
        effect: 'allow',
        agentId: 'local-agent',
        compartment: 'research',
        tool: 'fetch_html',
        maxRiskLevel: 'medium',
        transport: 'direct',
        requiresConfirmation: false
      }
    ]
  };
  return new CapabilityFirewall(new YamlPolicyEngine(policy));
}

/**
 * Privacy boundary engine that allows `research` self-access up to MEDIUM risk,
 * so the routing/rotation path stays observable for medium fetch_html without
 * the bootstrap boundary (which caps at low) escalating it to approval.
 */
function mediumAllowedPrivacyEngine(): PrivacyBoundaryEngine {
  const engine = new PrivacyBoundaryEngine();
  engine.registerRule({
    id: 'research-self-medium',
    sourceCompartmentId: 'research',
    targetCompartmentId: 'research',
    maxAllowedRisk: 'medium',
    actionOnViolation: 'require_approval'
  });
  return engine;
}

const ALLOW_BODY = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'low',
  input: 'bitcoin privacy research'
};

const DENY_BODY = {
  agentId: 'rogue-agent',
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'low',
  input: 'x'
};

const PENDING_BODY = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'fetch_html',
  riskLevel: 'medium',
  input: 'sensitive lookup'
};

const FETCH_HTML_MEDIUM_BODY = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'fetch_html',
  riskLevel: 'medium',
  input: 'sensitive lookup'
};

describe('GRL Local API — GET /v1/transport-policies', () => {
  it('returns the bootstrap rules as pure metadata', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/transport-policies', { method: 'GET' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.rules)).toBe(true);
    expect(res.json.rules).toHaveLength(2);

    const search = res.json.rules.find((r: any) => r.tool === 'search');
    expect(search).toEqual({
      tool: 'search',
      riskLevel: BOOTSTRAP_SEARCH_RULE.riskLevel,
      preferredTransport: 'searxng',
      isolationPolicy: BOOTSTRAP_SEARCH_RULE.isolationPolicy
    });

    const fetchHtml = res.json.rules.find((r: any) => r.tool === 'fetch_html');
    expect(fetchHtml).toEqual({
      tool: 'fetch_html',
      riskLevel: BOOTSTRAP_FETCH_HTML_RULE.riskLevel,
      preferredTransport: 'searxng',
      isolationPolicy: BOOTSTRAP_FETCH_HTML_RULE.isolationPolicy
    });
  });

  it('exposes no secret/token fields', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/transport-policies', { method: 'GET' });
    const serialized = JSON.stringify(res.json);
    expect(serialized).not.toMatch(/token/i);
    expect(serialized).not.toMatch(/secret/i);
  });

  it('returns 405 for a wrong method', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/transport-policies', { method: 'POST' });
    expect(res.status).toBe(405);
  });
});

describe('GRL Local API — execute-mock routing', () => {
  it('returns a routing block on an allowed execution', async () => {
    const { base } = await startApp();
    const res = await executeMock(base, ALLOW_BODY);

    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('allowed');
    expect(res.json.routing).toEqual({
      transportKind: 'searxng',
      shouldRotateSession: false,
      isolationLevel: 'session',
      reason: 'reuse_allowed'
    });
    // routing resolves to 'searxng'; execution always runs via the mock adapter.
    expect(res.json.execution.transportKind).toBe('mock');
  });

  it('low-risk search reuses the same session across calls', async () => {
    const { base } = await startApp();
    const first = await executeMock(base, ALLOW_BODY);
    const second = await executeMock(base, ALLOW_BODY);

    expect(first.json.routing.shouldRotateSession).toBe(false);
    expect(second.json.routing.shouldRotateSession).toBe(false);
    expect(first.json.execution.output.sessionId).toBe(
      second.json.execution.output.sessionId
    );
  });

  it('medium fetch_html forces a session rotation (strict isolation)', async () => {
    const { base } = await startApp({
      firewall: fetchHtmlNoConfirmFirewall(),
      privacyBoundaryEngine: mediumAllowedPrivacyEngine()
    });
    const first = await executeMock(base, FETCH_HTML_MEDIUM_BODY);
    const second = await executeMock(base, FETCH_HTML_MEDIUM_BODY);

    expect(first.status).toBe(200);
    expect(first.json.decision).toBe('allowed');
    expect(first.json.routing).toEqual({
      transportKind: 'searxng',
      shouldRotateSession: true,
      isolationLevel: 'strict',
      reason: 'forced_rotation'
    });
    // A forced rotation yields a fresh session identity on each call.
    expect(first.json.execution.output.sessionId).not.toBe(
      second.json.execution.output.sessionId
    );
  });

  it('strict isolation level is visible in the response', async () => {
    const { base } = await startApp({
      firewall: fetchHtmlNoConfirmFirewall(),
      privacyBoundaryEngine: mediumAllowedPrivacyEngine()
    });
    const res = await executeMock(base, FETCH_HTML_MEDIUM_BODY);
    expect(res.json.routing.isolationLevel).toBe('strict');
  });

  it('denied requests never route and never create a session', async () => {
    const { base, sessionManager } = await startApp();
    const res = await executeMock(base, DENY_BODY);

    expect(res.json.decision).toBe('denied');
    expect(res.json.routing).toBeUndefined();
    expect(res.json.execution).toBeUndefined();
    expect(sessionManager.size()).toBe(0);
  });

  it('pending requests never route and never create a session', async () => {
    const { base, sessionManager } = await startApp();
    const res = await executeMock(base, PENDING_BODY);

    expect(res.json.decision).toBe('pending');
    expect(res.json.routing).toBeUndefined();
    expect(res.json.execution).toBeUndefined();
    expect(sessionManager.size()).toBe(0);
  });

  it('is fail-closed when no routing rule matches an allowed request', async () => {
    // Empty engine: the firewall allows search/low, but no routing rule exists.
    const { base, sessionManager } = await startApp({
      transportPolicyEngine: new TransportPolicyEngine()
    });
    const res = await executeMock(base, ALLOW_BODY);

    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('denied');
    expect(res.json.execution).toBeUndefined();
    // Fail-closed: no session was minted.
    expect(sessionManager.size()).toBe(0);
  });
});
