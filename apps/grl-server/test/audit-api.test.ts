import { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ExecutionEngine,
  MockTransportAdapter,
  PrivacyBoundaryEngine,
  STRICT_SANDBOX_POLICY,
  TransportCapabilityRegistry,
  TransportManifest
} from '../../../packages/core/src/index.js';
import {
  buildApprovalQueue,
  buildBootstrapFirewall,
  buildSecurityEventEngine,
  createLocalApiApp,
  DEFAULT_HOST,
  LocalApiOptions
} from '../src/local-api.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

async function startApp(
  extra: Partial<LocalApiOptions> = {}
): Promise<{ base: string }> {
  const app: express.Express = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    approvalQueue: buildApprovalQueue(),
    securityEventEngine: buildSecurityEventEngine(),
    ...extra
  });
  const server = app.listen(0, DEFAULT_HOST);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  cleanups.push(() => server.close());
  return { base: `http://${DEFAULT_HOST}:${address.port}` };
}

async function rawRequest(
  base: string,
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

function executeMock(
  base: string,
  body: unknown
): Promise<{ status: number; json: any; text: string }> {
  return rawRequest(base, '/v1/capabilities/execute-mock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function listEvents(
  base: string,
  query = ''
): Promise<{ status: number; json: any; text: string }> {
  return rawRequest(base, `/v1/audit/events${query}`);
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

/** A `mock` manifest that requires network access, so STRICT policy blocks it. */
const NETWORK_MANIFEST: TransportManifest = {
  kind: 'mock',
  name: 'Network-requiring mock',
  version: '0.0.0',
  supportedTools: ['search', 'fetch_html', 'fetch_json'],
  declaredPermissions: ['execute_mock'],
  networkAccess: true,
  browserAccess: false,
  filesystemAccess: false,
  processSpawnAccess: false,
  envAccess: false
};

/** Build an execution engine whose sandbox always blocks the mock transport. */
function buildSandboxBlockingEngine(): ExecutionEngine {
  const registry = new TransportCapabilityRegistry();
  registry.registerManifest(NETWORK_MANIFEST);
  return new ExecutionEngine({
    adapters: [new MockTransportAdapter()],
    registry,
    sandboxPolicy: STRICT_SANDBOX_POLICY
  });
}

describe('GRL Local API — audit: execute-mock success lifecycle', () => {
  it('records the expected event types for a successful execution', async () => {
    const { base } = await startApp();
    await executeMock(base, ALLOW_BODY);

    const res = await listEvents(base);
    expect(res.status).toBe(200);
    const types = res.json.events.map((e: any) => e.type);
    expect(types).toContain('capability_allowed');
    expect(types).toContain('routing_resolved');
    expect(types).toContain('sandbox_allowed');
    expect(types).toContain('execution_started');
    expect(types).toContain('execution_succeeded');
    expect(types).not.toContain('capability_denied');
    expect(types).not.toContain('execution_blocked');
  });
});

describe('GRL Local API — audit: firewall deny', () => {
  it('records capability_denied only, with no routing/execution events', async () => {
    const { base } = await startApp();
    await executeMock(base, DENY_BODY);

    const res = await listEvents(base);
    const types = res.json.events.map((e: any) => e.type);
    expect(types).toEqual(['capability_denied']);
  });
});

describe('GRL Local API — audit: firewall pending', () => {
  it('records approval_pending without any execution event', async () => {
    const { base } = await startApp();
    await executeMock(base, PENDING_BODY);

    const res = await listEvents(base);
    const types = res.json.events.map((e: any) => e.type);
    expect(types).toContain('approval_pending');
    expect(types).not.toContain('execution_started');
    expect(types).not.toContain('execution_succeeded');
    expect(types).not.toContain('routing_resolved');
  });
});

describe('GRL Local API — audit: privacy boundary block', () => {
  it('records privacy_boundary_blocked without any execution event', async () => {
    // An empty privacy engine is fail-closed: research->research has no rule.
    const { base } = await startApp({
      privacyBoundaryEngine: new PrivacyBoundaryEngine()
    });
    const exec = await executeMock(base, ALLOW_BODY);
    expect(exec.json.decision).toBe('denied');

    const res = await listEvents(base);
    const types = res.json.events.map((e: any) => e.type);
    expect(types).toContain('privacy_boundary_blocked');
    expect(types).not.toContain('execution_started');
    expect(types).not.toContain('execution_succeeded');
    expect(types).not.toContain('session_created');
  });
});

describe('GRL Local API — audit: sandbox block', () => {
  it('records sandbox_blocked and execution_blocked', async () => {
    const { base } = await startApp({
      executionEngine: buildSandboxBlockingEngine()
    });
    const exec = await executeMock(base, ALLOW_BODY);
    expect(exec.json.execution.status).toBe('blocked');

    const res = await listEvents(base);
    const types = res.json.events.map((e: any) => e.type);
    expect(types).toContain('sandbox_blocked');
    expect(types).toContain('execution_blocked');
    expect(types).not.toContain('execution_succeeded');
    expect(types).not.toContain('sandbox_allowed');
  });
});

describe('GRL Local API — audit: approval approve/reject', () => {
  it('records approval_approved without exposing a token', async () => {
    const { base } = await startApp();
    const pending = await executeMock(base, PENDING_BODY);
    const id = pending.json.approvalRequestId;
    const token = pending.json.approvalToken;

    const decided = await rawRequest(base, `/v1/approvals/${id}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token })
    });
    expect(decided.status).toBe(200);

    const res = await listEvents(base, '?type=approval_approved');
    expect(res.json.events).toHaveLength(1);
    expect(res.json.events[0].approvalRequestId).toBe(id);
    // The whole audit payload must never carry the token.
    expect(res.text).not.toContain(token);
  });

  it('records approval_rejected without exposing a token', async () => {
    const { base } = await startApp();
    const pending = await executeMock(base, PENDING_BODY);
    const id = pending.json.approvalRequestId;
    const token = pending.json.approvalToken;

    await rawRequest(base, `/v1/approvals/${id}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token })
    });

    const res = await listEvents(base, '?type=approval_rejected');
    expect(res.json.events).toHaveLength(1);
    expect(res.text).not.toContain(token);
  });
});

describe('GRL Local API — audit: read endpoints', () => {
  it('lists events and filters by type and severity', async () => {
    const { base } = await startApp();
    await executeMock(base, ALLOW_BODY);

    const all = await listEvents(base);
    expect(all.status).toBe(200);
    expect(all.json.events.length).toBeGreaterThan(0);

    const byType = await listEvents(base, '?type=capability_allowed');
    expect(byType.json.events.every((e: any) => e.type === 'capability_allowed')).toBe(
      true
    );

    const bySeverity = await listEvents(base, '?severity=info');
    expect(bySeverity.json.events.every((e: any) => e.severity === 'info')).toBe(true);
  });

  it('fetches a single event by id', async () => {
    const { base } = await startApp();
    await executeMock(base, ALLOW_BODY);
    const all = await listEvents(base);
    const target = all.json.events[0];

    const res = await rawRequest(base, `/v1/audit/events/${target.id}`);
    expect(res.status).toBe(200);
    expect(res.json.event.id).toBe(target.id);
  });

  it('returns 404 for an unknown event id', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/audit/events/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid query parameter', async () => {
    const { base } = await startApp();
    const badType = await listEvents(base, '?type=not_a_type');
    expect(badType.status).toBe(400);
    const badLimit = await listEvents(base, '?limit=-3');
    expect(badLimit.status).toBe(400);
    const badSince = await listEvents(base, '?since=abc');
    expect(badSince.status).toBe(400);
  });

  it('returns 405 for a wrong method on the audit endpoints', async () => {
    const { base } = await startApp();
    const events = await rawRequest(base, '/v1/audit/events', { method: 'POST' });
    expect(events.status).toBe(405);
    const single = await rawRequest(base, '/v1/audit/events/x', { method: 'POST' });
    expect(single.status).toBe(405);
  });

  it('never stores a raw input or token in the audit JSON', async () => {
    const { base } = await startApp();
    await executeMock(base, ALLOW_BODY);
    const res = await listEvents(base);
    // The raw input string must never appear anywhere in the audit payload.
    expect(res.text).not.toContain('bitcoin privacy research');
    expect(res.text).not.toContain('approvalToken');
  });
});
