import { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CapabilityFirewall,
  CapabilityGraphEngine
} from '../../../packages/core/src/index.js';
import { YamlPolicyEngine } from '../../../packages/policy-engine/src/index.js';
import {
  buildApprovalQueue,
  buildBootstrapFirewall,
  buildCapabilityGraphEngine,
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
    capabilityGraphEngine: buildCapabilityGraphEngine(),
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

const RAW_MARKER = 'raw-input-secret-marker';

/** A low-risk search that the bootstrap firewall + graph both allow. */
const ALLOW_BODY = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'low',
  input: { q: RAW_MARKER }
};

describe('GET /v1/capability-graph/transition-rules', () => {
  it('lists the bootstrap transition rules', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/capability-graph/transition-rules');
    expect(res.status).toBe(200);
    const ids = res.json.transitionRules.map((r: any) => r.id);
    expect(ids).toContain('search-to-fetch-html');
    expect(ids).toContain('fetch-html-to-fetch-json');
  });

  it('rejects a non-GET method with 405', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/capability-graph/transition-rules', {
      method: 'POST'
    });
    expect(res.status).toBe(405);
  });
});

describe('GET /v1/capability-graph/isolation-policies', () => {
  it('lists the bootstrap dependency-isolation policy', async () => {
    const { base } = await startApp();
    const res = await rawRequest(
      base,
      '/v1/capability-graph/isolation-policies'
    );
    expect(res.status).toBe(200);
    expect(res.json.isolationPolicies).toHaveLength(1);
    const policy = res.json.isolationPolicies[0];
    expect(policy.id).toBe('research-default-dependency-isolation');
    expect(policy.compartmentId).toBe('research');
    expect(policy.maxPathLength).toBe(5);
  });

  it('rejects a non-GET method with 405', async () => {
    const { base } = await startApp();
    const res = await rawRequest(
      base,
      '/v1/capability-graph/isolation-policies',
      { method: 'DELETE' }
    );
    expect(res.status).toBe(405);
  });
});

describe('GET /v1/capability-graph/nodes & /edges', () => {
  it('starts empty and grows after a successful execution', async () => {
    const { base } = await startApp();
    const before = await rawRequest(base, '/v1/capability-graph/nodes');
    expect(before.status).toBe(200);
    expect(before.json.nodes).toEqual([]);

    await executeMock(base, ALLOW_BODY);

    const after = await rawRequest(base, '/v1/capability-graph/nodes');
    expect(after.json.nodes.length).toBeGreaterThanOrEqual(1);
    // A capability node plus an execution node are recorded on success.
    const kinds = after.json.nodes.map((n: any) => n.kind);
    expect(kinds).toContain('capability');
    expect(kinds).toContain('execution');

    const edges = await rawRequest(base, '/v1/capability-graph/edges');
    expect(edges.status).toBe(200);
    expect(edges.json.edges.some((e: any) => e.relation === 'executed')).toBe(
      true
    );
  });

  it('filters nodes by compartmentId', async () => {
    const { base } = await startApp();
    await executeMock(base, ALLOW_BODY);
    const res = await rawRequest(
      base,
      '/v1/capability-graph/nodes?compartmentId=research'
    );
    expect(res.status).toBe(200);
    expect(res.json.nodes.length).toBeGreaterThanOrEqual(1);
    const none = await rawRequest(
      base,
      '/v1/capability-graph/nodes?compartmentId=nope'
    );
    expect(none.json.nodes).toEqual([]);
  });

  it('rejects a repeated query param with 400', async () => {
    const { base } = await startApp();
    const res = await rawRequest(
      base,
      '/v1/capability-graph/nodes?compartmentId=a&compartmentId=b'
    );
    expect(res.status).toBe(400);
  });

  it('rejects a non-GET method with 405', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/capability-graph/edges', {
      method: 'PUT'
    });
    expect(res.status).toBe(405);
  });

  it('never leaks a raw input marker in nodes or edges', async () => {
    const { base } = await startApp();
    await executeMock(base, ALLOW_BODY);
    const nodes = await rawRequest(base, '/v1/capability-graph/nodes');
    const edges = await rawRequest(base, '/v1/capability-graph/edges');
    expect(nodes.text).not.toContain(RAW_MARKER);
    expect(edges.text).not.toContain(RAW_MARKER);
  });
});

describe('execute-mock capability graph integration', () => {
  it('includes a capabilityGraph block on a successful execution', async () => {
    const { base } = await startApp();
    const res = await executeMock(base, ALLOW_BODY);
    expect(res.json.decision).toBe('allowed');
    expect(res.json.capabilityGraph).toBeDefined();
    expect(res.json.capabilityGraph.action).toBe('allow');
    expect(res.json.capabilityGraph.risk).toBe('low');
    expect(res.json.capabilityGraph.relatedNodeIds.length).toBeGreaterThanOrEqual(
      1
    );
  });

  it('blocks a disallowed tool transition (graph block → denied)', async () => {
    const { base } = await startApp();
    // First admit a `search` onto the path.
    await executeMock(base, ALLOW_BODY);
    // `search -> fetch_json` has no transition rule → graph block.
    const res = await executeMock(base, {
      agentId: 'local-agent',
      compartmentId: 'research',
      tool: 'fetch_json',
      riskLevel: 'low',
      input: { q: RAW_MARKER }
    });
    expect(res.json.decision).toBe('denied');
    expect(res.json.capabilityGraph.action).toBe('block');
    expect(res.json.capabilityGraph.risk).toBe('blocked');
    expect(res.json.execution).toBeUndefined();
  });

  it('requires approval on a permitted tool change (graph require_approval → pending)', async () => {
    const { base } = await startApp();
    await executeMock(base, ALLOW_BODY);
    // `search -> fetch_html` at low risk → require_approval by the policy.
    const res = await executeMock(base, {
      agentId: 'local-agent',
      compartmentId: 'research',
      tool: 'fetch_html',
      riskLevel: 'low',
      input: { q: RAW_MARKER }
    });
    expect(res.json.decision).toBe('pending');
    expect(res.json.capabilityGraph.action).toBe('require_approval');
    expect(res.json.approvalRequestId).toBeDefined();
    expect(res.json.approvalToken).toBeDefined();
    expect(res.json.execution).toBeUndefined();
  });

  it('forces a rotation on a cross-tool escalation (graph force_rotation observable)', async () => {
    // Custom firewall that allows fetch_html at medium risk WITHOUT confirmation
    // so the force_rotation branch can reach a real execution.
    const firewall = new CapabilityFirewall(
      new YamlPolicyEngine({
        defaultDeny: true,
        rules: [
          {
            effect: 'allow',
            agentId: 'local-agent',
            compartment: 'research',
            tool: 'search',
            maxRiskLevel: 'low',
            transport: 'direct',
            requiresConfirmation: false
          },
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
      })
    );
    // Custom graph engine: forbid cross-tool escalation, never require approval.
    const capabilityGraphEngine = new CapabilityGraphEngine();
    capabilityGraphEngine.registerTransitionRule({
      id: 'search-to-fetch-html',
      fromTool: 'search',
      toTool: 'fetch_html',
      maxAllowedRisk: 'high',
      actionOnViolation: 'block',
      enabled: true
    });
    capabilityGraphEngine.registerIsolationPolicy({
      id: 'research-rotation',
      compartmentId: 'research',
      maxPathLength: 5,
      forbidCrossToolEscalation: true,
      requireApprovalOnToolChange: false,
      blockOnHighRiskPath: false,
      enabled: true
    });
    const { base } = await startApp({ firewall, capabilityGraphEngine });

    await executeMock(base, ALLOW_BODY);
    const res = await executeMock(base, {
      agentId: 'local-agent',
      compartmentId: 'research',
      tool: 'fetch_html',
      riskLevel: 'medium',
      input: { q: RAW_MARKER }
    });
    expect(res.json.capabilityGraph.action).toBe('force_rotation');
    // The graph-forced rotation is observable in the routing decision even when a
    // downstream gate (privacy boundary) ultimately defers the request.
    expect(res.json.routing.shouldRotateSession).toBe(true);
    expect(res.json.routing.reason).toBe('forced_rotation');

    const audit = await rawRequest(
      base,
      '/v1/audit/events?type=capability_graph_rotation_required'
    );
    expect(audit.json.events.length).toBeGreaterThanOrEqual(1);
  });

  it('emits a capability_graph_blocked audit event on a block', async () => {
    const { base } = await startApp();
    await executeMock(base, ALLOW_BODY);
    await executeMock(base, {
      agentId: 'local-agent',
      compartmentId: 'research',
      tool: 'fetch_json',
      riskLevel: 'low',
      input: { q: RAW_MARKER }
    });
    const audit = await rawRequest(
      base,
      '/v1/audit/events?type=capability_graph_blocked'
    );
    expect(audit.status).toBe(200);
    expect(audit.json.events.length).toBeGreaterThanOrEqual(1);
    expect(audit.text).not.toContain(RAW_MARKER);
  });

  it('never leaks the approval token into the graph endpoints', async () => {
    const { base } = await startApp();
    await executeMock(base, ALLOW_BODY);
    const pending = await executeMock(base, {
      agentId: 'local-agent',
      compartmentId: 'research',
      tool: 'fetch_html',
      riskLevel: 'low',
      input: { q: RAW_MARKER }
    });
    const token = pending.json.approvalToken as string;
    expect(token).toBeDefined();
    const nodes = await rawRequest(base, '/v1/capability-graph/nodes');
    const edges = await rawRequest(base, '/v1/capability-graph/edges');
    expect(nodes.text).not.toContain(token);
    expect(edges.text).not.toContain(token);
  });
});
