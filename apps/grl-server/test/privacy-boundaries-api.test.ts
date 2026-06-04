import { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ApprovalQueue,
  CapabilityFirewall,
  PrivacyBoundaryEngine,
  SessionManager,
  TransportPolicyEngine
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
  approvalQueue: ApprovalQueue;
  sessionManager: SessionManager;
}

interface StartOptions {
  firewall?: CapabilityFirewall;
  privacyBoundaryEngine?: PrivacyBoundaryEngine;
}

async function startApp(options: StartOptions = {}): Promise<StartedServer> {
  const approvalQueue = buildApprovalQueue();
  const sessionManager = buildBootstrapSessionManager({
    ttlMs: DEFAULT_SESSION_TTL_MS,
    maxRequests: DEFAULT_SESSION_MAX_REQUESTS,
    reusePolicy: 'reuse_active'
  });
  const app: express.Express = createLocalApiApp({
    firewall: options.firewall ?? buildBootstrapFirewall(),
    approvalQueue,
    executionEngine: buildMockExecutionEngine(),
    sessionManager,
    transportPolicyEngine: buildBootstrapTransportPolicyEngine(),
    privacyBoundaryEngine:
      options.privacyBoundaryEngine ?? buildBootstrapPrivacyBoundaryEngine()
  });
  const server = app.listen(0, DEFAULT_HOST);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  cleanups.push(() => server.close());
  return {
    base: `http://${DEFAULT_HOST}:${address.port}`,
    approvalQueue,
    sessionManager
  };
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
 * Firewall allowing `fetch_html` at medium risk WITHOUT confirmation, so the
 * privacy boundary (not the approval queue) is the layer under test for medium.
 */
function mediumNoConfirmFirewall(): CapabilityFirewall {
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

/** Firewall pending body — fetch_html medium under the bootstrap firewall. */
const FIREWALL_PENDING_BODY = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'fetch_html',
  riskLevel: 'medium',
  input: 'sensitive lookup'
};

describe('GRL Local API — GET /v1/privacy-boundaries', () => {
  it('lists the bootstrap privacy boundary rules', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/privacy-boundaries', { method: 'GET' });
    expect(res.status).toBe(200);
    expect(res.json.rules).toHaveLength(1);
    expect(res.json.rules[0]).toEqual({
      id: 'research-self',
      sourceCompartmentId: 'research',
      targetCompartmentId: 'research',
      maxAllowedRisk: 'low',
      actionOnViolation: 'require_approval'
    });
  });

  it('returns 405 for a wrong method', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/privacy-boundaries', { method: 'POST' });
    expect(res.status).toBe(405);
  });
});

describe('GRL Local API — execute-mock privacy boundary (allowed)', () => {
  it('includes a privacyBoundary block on an allowed execution', async () => {
    const { base } = await startApp();
    const res = await executeMock(base, ALLOW_BODY);
    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('allowed');
    expect(res.json.privacyBoundary.action).toBe('allow');
    expect(res.json.privacyBoundary.riskLevel).toBe('low');
    expect(res.json.privacyBoundary.signals).toContain('same_compartment');
    expect(res.json.execution.status).toBe('success');
  });
});

describe('GRL Local API — execute-mock privacy boundary (block)', () => {
  it('denies via privacy boundary and creates no session', async () => {
    const { base, sessionManager } = await startApp({
      firewall: mediumNoConfirmFirewall(),
      // Empty engine → unknown target compartment → fail-closed block.
      privacyBoundaryEngine: new PrivacyBoundaryEngine()
    });
    const res = await executeMock(base, FIREWALL_PENDING_BODY);
    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('denied');
    expect(res.json.reason).toBe('Privacy boundary blocked execution.');
    expect(res.json.privacyBoundary.action).toBe('block');
    expect(res.json.privacyBoundary.riskLevel).toBe('high');
    expect(res.json.execution).toBeUndefined();
    expect(sessionManager.size()).toBe(0);
  });
});

describe('GRL Local API — execute-mock privacy boundary (require_approval)', () => {
  it('returns pending and never executes when privacy requires approval', async () => {
    const { base, approvalQueue, sessionManager } = await startApp({
      // Allow medium at the firewall so the privacy boundary is the gate.
      firewall: mediumNoConfirmFirewall()
    });
    const res = await executeMock(base, FIREWALL_PENDING_BODY);
    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('pending');
    expect(res.json.privacyBoundary.action).toBe('require_approval');
    expect(res.json.privacyBoundary.signals).toContain('risk_escalation');
    expect(res.json.execution).toBeUndefined();
    expect(typeof res.json.approvalRequestId).toBe('string');
    expect(typeof res.json.approvalToken).toBe('string');
    expect(approvalQueue.size()).toBe(1);
    // No execution → no session minted.
    expect(sessionManager.size()).toBe(0);
  });
});

describe('GRL Local API — execute-mock privacy boundary (rotate_session)', () => {
  it('forces a fresh session when privacy demands rotation', async () => {
    // Bootstrap routing makes low search reuse-allowed (no routing rotation), so
    // any rotation observed comes from the privacy boundary. A strict-isolation
    // boundary rule forces rotation while still allowing the flow.
    const engine = new PrivacyBoundaryEngine();
    engine.registerRule({
      id: 'research-self',
      sourceCompartmentId: 'research',
      targetCompartmentId: 'research',
      maxAllowedRisk: 'low',
      actionOnViolation: 'rotate_session'
    });
    // Use a transport policy that reports strict isolation for low search.
    const { base } = await startAppWithStrictLowSearch(engine);
    const first = await executeMock(base, ALLOW_BODY);
    const second = await executeMock(base, ALLOW_BODY);
    expect(first.json.decision).toBe('allowed');
    expect(first.json.privacyBoundary.action).toBe('rotate_session');
    expect(first.json.privacyBoundary.signals).toContain('strict_isolation_required');
    expect(first.json.execution.output.sessionId).not.toBe(
      second.json.execution.output.sessionId
    );
  });
});

describe('GRL Local API — execute-mock firewall short-circuits privacy', () => {
  it('firewall deny short-circuits before privacy boundary', async () => {
    const { base } = await startApp();
    const res = await executeMock(base, DENY_BODY);
    expect(res.json.decision).toBe('denied');
    // Firewall deny never reaches routing/privacy.
    expect(res.json.privacyBoundary).toBeUndefined();
    expect(res.json.routing).toBeUndefined();
  });

  it('firewall pending short-circuits before privacy boundary', async () => {
    const { base } = await startApp();
    const res = await executeMock(base, FIREWALL_PENDING_BODY);
    expect(res.json.decision).toBe('pending');
    // The firewall confirmation path never reaches routing/privacy.
    expect(res.json.privacyBoundary).toBeUndefined();
    expect(res.json.routing).toBeUndefined();
  });
});

/**
 * Build a server whose transport policy reports STRICT isolation for low-risk
 * search so the privacy boundary observes `strict_isolation_required`.
 */
async function startAppWithStrictLowSearch(
  privacyBoundaryEngine: PrivacyBoundaryEngine
): Promise<StartedServer> {
  const approvalQueue = buildApprovalQueue();
  const sessionManager = buildBootstrapSessionManager({
    ttlMs: DEFAULT_SESSION_TTL_MS,
    maxRequests: DEFAULT_SESSION_MAX_REQUESTS,
    reusePolicy: 'reuse_active'
  });
  const transportPolicyEngine = new TransportPolicyEngine();
  transportPolicyEngine.registerRule({
    tool: 'search',
    riskLevel: 'low',
    preferredTransport: 'mock',
    isolationPolicy: {
      level: 'strict',
      forceRotateOnHighRisk: true,
      forbidSessionReuse: false,
      allowCrossToolReuse: true
    }
  });
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    approvalQueue,
    executionEngine: buildMockExecutionEngine(),
    sessionManager,
    transportPolicyEngine,
    privacyBoundaryEngine
  });
  const server = app.listen(0, DEFAULT_HOST);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  cleanups.push(() => server.close());
  return {
    base: `http://${DEFAULT_HOST}:${address.port}`,
    approvalQueue,
    sessionManager
  };
}
