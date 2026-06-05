import { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PrivacyBoundaryEngine,
  TransportCapabilityRegistry
} from '../../../packages/core/src/index.js';
import {
  buildApprovalQueue,
  buildBootstrapFirewall,
  buildIncidentDetector,
  buildRuntimeSecurityHeuristicsEngine,
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
    heuristicsEngine: buildRuntimeSecurityHeuristicsEngine(),
    incidentDetector: buildIncidentDetector(),
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

const DENIED_REQUEST = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'high',
  input: { q: 'denied-secret-marker' }
};

const ALLOWED_REQUEST = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'low',
  input: { q: 'allowed' }
};

/** Build a privacy engine that BLOCKS any research self-access (for testing). */
function blockingPrivacyEngine(): PrivacyBoundaryEngine {
  const engine = new PrivacyBoundaryEngine();
  engine.registerRule({
    id: 'research-block',
    sourceCompartmentId: 'research',
    targetCompartmentId: 'research',
    maxAllowedRisk: 'none',
    actionOnViolation: 'block'
  });
  return engine;
}

describe('GET /v1/security/anomalies', () => {
  it('returns an empty list initially', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/security/anomalies');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ anomalies: [] });
  });

  it('lists a repeated-denied anomaly after the threshold is crossed', async () => {
    const { base } = await startApp();
    for (let i = 0; i < 3; i++) await executeMock(base, DENIED_REQUEST);
    const res = await rawRequest(base, '/v1/security/anomalies');
    expect(res.status).toBe(200);
    expect(res.json.anomalies).toHaveLength(1);
    expect(res.json.anomalies[0].type).toBe('repeated_denied_capabilities');
    expect(res.json.anomalies[0].relatedEventIds).toHaveLength(3);
  });

  it('rejects a non-GET method with 405', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/security/anomalies', {
      method: 'POST'
    });
    expect(res.status).toBe(405);
  });
});

describe('GET /v1/security/incidents', () => {
  it('opens an incident from the repeated-denied flow', async () => {
    const { base } = await startApp();
    for (let i = 0; i < 3; i++) await executeMock(base, DENIED_REQUEST);
    const res = await rawRequest(base, '/v1/security/incidents');
    expect(res.status).toBe(200);
    expect(res.json.incidents).toHaveLength(1);
    expect(res.json.incidents[0].status).toBe('open');
    expect(res.json.incidents[0].severity).toBe('warning');
  });

  it('opens an incident from the sandbox-blocked flow', async () => {
    // An empty registry makes the execution sandbox block every execution,
    // emitting sandbox_blocked events (threshold 2).
    const { base } = await startApp({
      transportRegistry: new TransportCapabilityRegistry()
    });
    for (let i = 0; i < 2; i++) await executeMock(base, ALLOWED_REQUEST);
    const anomalies = await rawRequest(base, '/v1/security/anomalies');
    expect(
      anomalies.json.anomalies.some(
        (a: any) => a.type === 'sandbox_violation_attempts'
      )
    ).toBe(true);
    const res = await rawRequest(base, '/v1/security/incidents?status=open');
    expect(
      res.json.incidents.some((i: any) => i.severity === 'critical')
    ).toBe(true);
  });

  it('opens an incident from the privacy-boundary flow', async () => {
    const { base } = await startApp({
      privacyBoundaryEngine: blockingPrivacyEngine()
    });
    for (let i = 0; i < 2; i++) await executeMock(base, ALLOWED_REQUEST);
    const anomalies = await rawRequest(base, '/v1/security/anomalies');
    expect(
      anomalies.json.anomalies.some(
        (a: any) => a.type === 'privacy_boundary_violations'
      )
    ).toBe(true);
    const res = await rawRequest(base, '/v1/security/incidents');
    expect(res.json.incidents).toHaveLength(1);
  });

  it('filters incidents by status', async () => {
    const { base } = await startApp();
    for (let i = 0; i < 3; i++) await executeMock(base, DENIED_REQUEST);
    const open = await rawRequest(base, '/v1/security/incidents?status=open');
    expect(open.json.incidents).toHaveLength(1);
    const closed = await rawRequest(
      base,
      '/v1/security/incidents?status=closed'
    );
    expect(closed.json.incidents).toHaveLength(0);
  });

  it('rejects an invalid status with 400', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/security/incidents?status=bogus');
    expect(res.status).toBe(400);
  });

  it('rejects a non-GET method with 405', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/security/incidents', {
      method: 'DELETE'
    });
    expect(res.status).toBe(405);
  });
});

describe('GET /v1/security/incidents/:id', () => {
  it('fetches an incident by id', async () => {
    const { base } = await startApp();
    for (let i = 0; i < 3; i++) await executeMock(base, DENIED_REQUEST);
    const list = await rawRequest(base, '/v1/security/incidents');
    const id = list.json.incidents[0].id;
    const res = await rawRequest(base, `/v1/security/incidents/${id}`);
    expect(res.status).toBe(200);
    expect(res.json.incident.id).toBe(id);
  });

  it('returns 404 for an unknown incident', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/security/incidents/nope');
    expect(res.status).toBe(404);
  });
});

describe('POST /v1/security/incidents/:id/close', () => {
  it('closes an open incident', async () => {
    const { base } = await startApp();
    for (let i = 0; i < 3; i++) await executeMock(base, DENIED_REQUEST);
    const list = await rawRequest(base, '/v1/security/incidents');
    const id = list.json.incidents[0].id;
    const res = await rawRequest(
      base,
      `/v1/security/incidents/${id}/close`,
      { method: 'POST' }
    );
    expect(res.status).toBe(200);
    expect(res.json.incident.status).toBe('closed');
    const open = await rawRequest(base, '/v1/security/incidents?status=open');
    expect(open.json.incidents).toHaveLength(0);
  });

  it('returns 404 when closing an unknown incident', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/security/incidents/nope/close', {
      method: 'POST'
    });
    expect(res.status).toBe(404);
  });

  it('rejects a non-POST method with 405', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/security/incidents/x/close', {
      method: 'GET'
    });
    expect(res.status).toBe(405);
  });
});

describe('runtime-security privacy guarantees', () => {
  it('never leaks an approval token through anomalies/incidents', async () => {
    const { base } = await startApp();
    // Drive a pending approval to obtain a real token, plus denied events.
    const pending = await executeMock(base, {
      agentId: 'local-agent',
      compartmentId: 'research',
      tool: 'fetch_html',
      riskLevel: 'medium',
      input: { q: 'approve-me' }
    });
    const token: string = pending.json.approvalToken;
    expect(typeof token).toBe('string');
    for (let i = 0; i < 3; i++) await executeMock(base, DENIED_REQUEST);

    const anomalies = await rawRequest(base, '/v1/security/anomalies');
    const incidents = await rawRequest(base, '/v1/security/incidents');
    expect(anomalies.text).not.toContain(token);
    expect(incidents.text).not.toContain(token);
  });

  it('never leaks raw request input through anomalies/incidents', async () => {
    const { base } = await startApp();
    for (let i = 0; i < 3; i++) await executeMock(base, DENIED_REQUEST);
    const anomalies = await rawRequest(base, '/v1/security/anomalies');
    const incidents = await rawRequest(base, '/v1/security/incidents');
    expect(anomalies.text).not.toContain('denied-secret-marker');
    expect(incidents.text).not.toContain('denied-secret-marker');
  });

  it('keeps execute-mock working even though heuristics observe it', async () => {
    const { base } = await startApp();
    const res = await executeMock(base, ALLOWED_REQUEST);
    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('allowed');
    expect(res.json.execution.status).toBe('success');
  });
});
