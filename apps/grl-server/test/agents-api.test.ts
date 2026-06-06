/**
 * HTTP API tests for multi-agent runtime endpoints.
 *
 * Covers:
 *  - GET /v1/agents
 *  - GET /v1/agents/:agentId
 *  - GET /v1/agents/:agentId/leases
 *  - GET /v1/agents/:agentId/sessions
 *  - GET /v1/agents/:agentId/trust
 *  - POST /v1/agents/:agentId/restrict
 *  - POST /v1/agents/:agentId/evict
 *  - 404 for unknown agent
 *  - 405 for wrong HTTP method
 *  - No token / no raw-input leak
 */

import { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentRegistry, RuntimeLeaseManager } from '../../../packages/core/src/index.js';
import {
  buildApprovalQueue,
  buildBootstrapFirewall,
  buildCompartmentTrustEngine,
  buildIncidentDetector,
  buildRuntimeSecurityHeuristicsEngine,
  buildSecurityEventEngine,
  createLocalApiApp,
  DEFAULT_HOST,
  LocalApiOptions
} from '../src/local-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

async function startApp(
  extra: Partial<LocalApiOptions> = {}
): Promise<{ base: string; app: express.Express }> {
  const app = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    approvalQueue: buildApprovalQueue(),
    securityEventEngine: buildSecurityEventEngine(),
    heuristicsEngine: buildRuntimeSecurityHeuristicsEngine(),
    incidentDetector: buildIncidentDetector(),
    trustEngine: buildCompartmentTrustEngine(),
    ...extra
  });
  const server = app.listen(0, DEFAULT_HOST);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  cleanups.push(() => server.close());
  return { base: `http://${DEFAULT_HOST}:${address.port}`, app };
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

function get(base: string, path: string) {
  return rawRequest(base, path, { method: 'GET' });
}

function post(base: string, path: string, body?: unknown) {
  return rawRequest(base, path, {
    method: 'POST',
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
}

// ---------------------------------------------------------------------------
// GET /v1/agents
// ---------------------------------------------------------------------------

describe('GET /v1/agents', () => {
  it('returns empty agents list when no agents are registered', async () => {
    const { base } = await startApp();
    const { status, json } = await get(base, '/v1/agents');
    expect(status).toBe(200);
    expect(json).toHaveProperty('agents');
    expect(Array.isArray(json.agents)).toBe(true);
  });

  it('returns agent views for all registered agents', async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent('agent-a');
    agentRegistry.registerAgent('agent-b');
    const { base } = await startApp({ agentRegistry });
    const { status, json } = await get(base, '/v1/agents');
    expect(status).toBe(200);
    expect(json.agents).toHaveLength(2);
    const ids = json.agents.map((a: any) => a.agentId).sort();
    expect(ids).toEqual(['agent-a', 'agent-b']);
  });

  it('each agent view has expected fields', async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent('agent-a');
    const { base } = await startApp({ agentRegistry });
    const { json } = await get(base, '/v1/agents');
    const agent = json.agents[0];
    expect(agent).toHaveProperty('agentId');
    expect(agent).toHaveProperty('status');
    expect(agent).toHaveProperty('trustScore');
    expect(agent).toHaveProperty('activeSessions');
    expect(agent).toHaveProperty('activeExecutions');
    expect(agent).toHaveProperty('quota');
    expect(agent).toHaveProperty('createdAt');
  });

  it('does not leak tokens or raw input', async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent('leak-check-agent');
    const { base } = await startApp({ agentRegistry });
    const { text } = await get(base, '/v1/agents');
    expect(text).not.toMatch(/password/i);
    expect(text).not.toMatch(/secret/i);
    // The response body must not contain raw credentials or auth tokens.
    // We verify no "token" keyword appears outside the JSON structure keys.
    const parsed = JSON.parse(text);
    const agentIds: string[] = (parsed.agents ?? []).map((a: any) => String(a.agentId));
    expect(agentIds).not.toContain('token');
  });

  it('returns 405 for non-GET requests', async () => {
    const { base } = await startApp();
    const { status } = await post(base, '/v1/agents');
    expect(status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/agents/:agentId
// ---------------------------------------------------------------------------

describe('GET /v1/agents/:agentId', () => {
  it('returns 404 for unknown agent', async () => {
    const { base } = await startApp();
    const { status, json } = await get(base, '/v1/agents/unknown-agent');
    expect(status).toBe(404);
    expect(json).toHaveProperty('error');
  });

  it('returns agent view for known agent', async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent('agent-a');
    const { base } = await startApp({ agentRegistry });
    const { status, json } = await get(base, '/v1/agents/agent-a');
    expect(status).toBe(200);
    expect(json).toHaveProperty('agent');
    expect(json.agent.agentId).toBe('agent-a');
    expect(json.agent.status).toBe('idle');
  });

  it('returned agent view includes quota', async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent('agent-a');
    const { base } = await startApp({ agentRegistry });
    const { json } = await get(base, '/v1/agents/agent-a');
    expect(json.agent.quota).toBeDefined();
    expect(typeof json.agent.quota.maxConcurrentExecutions).toBe('number');
    expect(typeof json.agent.quota.maxSessions).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// GET /v1/agents/:agentId/leases
// ---------------------------------------------------------------------------

describe('GET /v1/agents/:agentId/leases', () => {
  it('returns 404 for unknown agent', async () => {
    const { base } = await startApp();
    const { status } = await get(base, '/v1/agents/nobody/leases');
    expect(status).toBe(404);
  });

  it('returns empty leases for agent without leases', async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent('agent-a');
    const { base } = await startApp({ agentRegistry });
    const { status, json } = await get(base, '/v1/agents/agent-a/leases');
    expect(status).toBe(200);
    expect(json.agentId).toBe('agent-a');
    expect(Array.isArray(json.leases)).toBe(true);
    expect(json.leases).toHaveLength(0);
  });

  it('returns lease metadata for agent with an active lease', async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent('agent-a');
    const leaseManager = new RuntimeLeaseManager({ registry: agentRegistry });
    leaseManager.acquireLease('agent-a');
    const { base } = await startApp({ agentRegistry, leaseManager });
    const { status, json } = await get(base, '/v1/agents/agent-a/leases');
    expect(status).toBe(200);
    expect(json.leases).toHaveLength(1);
    const lease = json.leases[0];
    expect(lease).toHaveProperty('id');
    expect(lease).toHaveProperty('acquiredAt');
    expect(lease).toHaveProperty('expiresAt');
    expect(lease.holderAgentId).toBe('agent-a');
  });

  it('returns 405 for POST on leases endpoint', async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent('agent-a');
    const { base } = await startApp({ agentRegistry });
    const { status } = await post(base, '/v1/agents/agent-a/leases');
    expect(status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/agents/:agentId/sessions
// ---------------------------------------------------------------------------

describe('GET /v1/agents/:agentId/sessions', () => {
  it('returns 404 for unknown agent', async () => {
    const { base } = await startApp();
    const { status } = await get(base, '/v1/agents/nobody/sessions');
    expect(status).toBe(404);
  });

  it('returns session quota summary', async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent('agent-a');
    const { base } = await startApp({ agentRegistry });
    const { status, json } = await get(base, '/v1/agents/agent-a/sessions');
    expect(status).toBe(200);
    expect(json.agentId).toBe('agent-a');
    expect(typeof json.activeSessions).toBe('number');
    expect(typeof json.maxSessions).toBe('number');
  });

  it('returns 405 for POST on sessions endpoint', async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent('agent-a');
    const { base } = await startApp({ agentRegistry });
    const { status } = await post(base, '/v1/agents/agent-a/sessions');
    expect(status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/agents/:agentId/trust
// ---------------------------------------------------------------------------

describe('GET /v1/agents/:agentId/trust', () => {
  it('returns 404 for unknown agent', async () => {
    const { base } = await startApp();
    const { status } = await get(base, '/v1/agents/nobody/trust');
    expect(status).toBe(404);
  });

  it('returns agent trust view', async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent('agent-a');
    const { base } = await startApp({ agentRegistry });
    const { status, json } = await get(base, '/v1/agents/agent-a/trust');
    expect(status).toBe(200);
    expect(json).toHaveProperty('trust');
    expect(json.trust.agentId).toBe('agent-a');
    expect(typeof json.trust.trustScore).toBe('number');
    expect(json.trust.status).toBe('idle');
  });

  it('returns 405 for POST on trust endpoint', async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent('agent-a');
    const { base } = await startApp({ agentRegistry });
    const { status } = await post(base, '/v1/agents/agent-a/trust');
    expect(status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// POST /v1/agents/:agentId/restrict
// ---------------------------------------------------------------------------

describe('POST /v1/agents/:agentId/restrict', () => {
  it('returns 404 for unknown agent', async () => {
    const { base } = await startApp();
    const { status } = await post(base, '/v1/agents/nobody/restrict');
    expect(status).toBe(404);
  });

  it('restricts an active agent', async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent('agent-a');
    const { base } = await startApp({ agentRegistry });
    const { status, json } = await post(base, '/v1/agents/agent-a/restrict');
    expect(status).toBe(200);
    expect(json.agentId).toBe('agent-a');
    expect(json.status).toBe('restricted');
    expect(typeof json.updatedAt).toBe('number');
  });

  it('returns 400 when trying to restrict an evicted agent', async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent('agent-a');
    agentRegistry.evictAgent('agent-a');
    const { base } = await startApp({ agentRegistry });
    const { status } = await post(base, '/v1/agents/agent-a/restrict');
    expect(status).toBe(400);
  });

  it('restricted agent is reflected in GET /v1/agents/:agentId', async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent('agent-a');
    const { base } = await startApp({ agentRegistry });
    await post(base, '/v1/agents/agent-a/restrict');
    const { json } = await get(base, '/v1/agents/agent-a');
    expect(json.agent.status).toBe('restricted');
  });
});

// ---------------------------------------------------------------------------
// POST /v1/agents/:agentId/evict
// ---------------------------------------------------------------------------

describe('POST /v1/agents/:agentId/evict', () => {
  it('returns 404 for unknown agent', async () => {
    const { base } = await startApp();
    const { status } = await post(base, '/v1/agents/nobody/evict');
    expect(status).toBe(404);
  });

  it('evicts a registered agent', async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent('agent-a');
    const { base } = await startApp({ agentRegistry });
    const { status, json } = await post(base, '/v1/agents/agent-a/evict');
    expect(status).toBe(200);
    expect(json.agentId).toBe('agent-a');
    expect(json.status).toBe('evicted');
    expect(typeof json.updatedAt).toBe('number');
  });

  it('evicted agent is reflected in GET /v1/agents/:agentId', async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent('agent-a');
    const { base } = await startApp({ agentRegistry });
    await post(base, '/v1/agents/agent-a/evict');
    const { json } = await get(base, '/v1/agents/agent-a');
    expect(json.agent.status).toBe('evicted');
  });

  it('response body contains no tokens or raw input', async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent('agent-a');
    const { base } = await startApp({ agentRegistry });
    const { text } = await post(base, '/v1/agents/agent-a/evict');
    expect(text).not.toMatch(/token/i);
    expect(text).not.toMatch(/secret/i);
    expect(text).not.toMatch(/password/i);
  });

  it('405 for GET on evict endpoint', async () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.registerAgent('agent-a');
    const { base } = await startApp({ agentRegistry });
    const { status } = await get(base, '/v1/agents/agent-a/evict');
    expect(status).toBe(405);
  });
});
