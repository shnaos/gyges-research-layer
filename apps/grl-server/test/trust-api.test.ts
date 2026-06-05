import { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { CompartmentTrustEngine } from '../../../packages/core/src/index.js';
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
    trustEngine: buildCompartmentTrustEngine(),
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

const ALLOW_BODY = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'low',
  input: { q: 'raw-input-secret-marker' }
};

/** A high-risk request that the bootstrap firewall denies. */
const DENY_BODY = {
  agentId: 'rogue-agent',
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'high',
  input: { q: 'raw-input-secret-marker' }
};

/** Seed a trust engine and drive its score down with critical incidents. */
function seededTrustEngine(criticalIncidents: number): CompartmentTrustEngine {
  const engine = new CompartmentTrustEngine();
  for (let i = 0; i < criticalIncidents; i++) {
    engine.recordEvent({
      compartmentId: 'research',
      type: 'incident_opened',
      incidentSeverity: 'critical',
      reason: 'seed'
    });
  }
  return engine;
}

describe('GET /v1/trust/profiles', () => {
  it('lists compartment reputation profiles as metadata', async () => {
    const { base } = await startApp();
    await executeMock(base, ALLOW_BODY);

    const res = await rawRequest(base, '/v1/trust/profiles');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.profiles)).toBe(true);
    const research = res.json.profiles.find(
      (p: any) => p.compartmentId === 'research'
    );
    expect(research).toBeDefined();
    expect(research).toHaveProperty('score');
    expect(research).toHaveProperty('level');
    expect(Array.isArray(research.events)).toBe(true);
  });

  it('returns 405 for non-GET methods', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/trust/profiles', { method: 'POST' });
    expect(res.status).toBe(405);
    expect(res.json.error).toMatch(/Method not allowed/);
  });
});

describe('GET /v1/trust/profiles/:compartmentId', () => {
  it('returns the profile for a known compartment', async () => {
    const { base } = await startApp();
    await executeMock(base, ALLOW_BODY);

    const res = await rawRequest(base, '/v1/trust/profiles/research');
    expect(res.status).toBe(200);
    expect(res.json.profile.compartmentId).toBe('research');
    expect(typeof res.json.profile.score).toBe('number');
    expect(res.json.profile.level).toBe('neutral');
  });

  it('returns 404 for an unknown compartment', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/trust/profiles/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns 405 for non-GET methods', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/trust/profiles/research', {
      method: 'DELETE'
    });
    expect(res.status).toBe(405);
  });
});

describe('GET /v1/trust/events', () => {
  it('lists reputation events and filters by compartmentId', async () => {
    const { base } = await startApp();
    await executeMock(base, ALLOW_BODY);

    const all = await rawRequest(base, '/v1/trust/events');
    expect(all.status).toBe(200);
    expect(Array.isArray(all.json.events)).toBe(true);
    expect(all.json.events.length).toBeGreaterThan(0);

    const filtered = await rawRequest(
      base,
      '/v1/trust/events?compartmentId=research'
    );
    expect(filtered.status).toBe(200);
    expect(
      filtered.json.events.every((e: any) => e.compartmentId === 'research')
    ).toBe(true);

    const none = await rawRequest(
      base,
      '/v1/trust/events?compartmentId=unknown'
    );
    expect(none.json.events).toEqual([]);
  });

  it('returns 405 for non-GET methods', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/trust/events', { method: 'PUT' });
    expect(res.status).toBe(405);
  });
});

describe('execute-mock trust integration', () => {
  it('includes the trust block on a successful execution', async () => {
    const { base } = await startApp();
    const res = await executeMock(base, ALLOW_BODY);
    expect(res.json.decision).toBe('allowed');
    expect(res.json.trust).toBeDefined();
    expect(res.json.trust.compartmentId).toBe('research');
    expect(res.json.trust.level).toBe('neutral');
    // A clean execution nudges the neutral baseline up by 1.
    expect(res.json.trust.score).toBe(71);
  });

  it('repeated denials reduce the compartment trust score', async () => {
    const { base } = await startApp();
    await executeMock(base, DENY_BODY);
    await executeMock(base, DENY_BODY);

    const res = await rawRequest(base, '/v1/trust/profiles/research');
    // Two denials at -2 each: 70 -> 66 (no incident yet at threshold 3).
    expect(res.json.profile.score).toBe(66);
    expect(res.json.profile.score).toBeLessThan(70);
  });

  it('forces approval for a restricted compartment', async () => {
    const { base } = await startApp({
      // One critical incident: 70 -> 45 (restricted).
      trustEngine: seededTrustEngine(1)
    });
    const res = await executeMock(base, ALLOW_BODY);
    expect(res.json.decision).toBe('pending');
    expect(res.json.trust.level).toBe('restricted');
    expect(res.json.approvalRequestId).toBeDefined();
    expect(res.json.approvalToken).toBeDefined();
    // The restricted gate must short-circuit before any execution.
    expect(res.json.execution).toBeUndefined();
  });

  it('denies a quarantined compartment', async () => {
    const { base } = await startApp({
      // Three critical incidents: 70 -> 45 -> 20 -> 0 (quarantined).
      trustEngine: seededTrustEngine(3)
    });
    const res = await executeMock(base, ALLOW_BODY);
    expect(res.json.decision).toBe('denied');
    expect(res.json.reason).toMatch(/quarantined/i);
    expect(res.json.trust.level).toBe('quarantined');
    expect(res.json.execution).toBeUndefined();
  });
});

describe('execute-mock trust — incident lifecycle', () => {
  it('lowers trust when an incident opens and restores it when closed', async () => {
    const { base } = await startApp();
    // Three high-risk denials cross the repeated-denied heuristic threshold,
    // opening a warning incident which costs an extra -12.
    await executeMock(base, DENY_BODY);
    await executeMock(base, DENY_BODY);
    await executeMock(base, DENY_BODY);

    const afterOpen = await rawRequest(base, '/v1/trust/profiles/research');
    // 70 - (3 * 2) - 12 (incident) = 52.
    expect(afterOpen.json.profile.score).toBe(52);

    const incidents = await rawRequest(base, '/v1/security/incidents?status=open');
    const incidentId = incidents.json.incidents[0].id;
    expect(incidentId).toBeDefined();

    const closed = await rawRequest(
      base,
      `/v1/security/incidents/${incidentId}/close`,
      { method: 'POST' }
    );
    expect(closed.status).toBe(200);

    const afterClose = await rawRequest(base, '/v1/trust/profiles/research');
    // incident_closed restores +5: 52 -> 57.
    expect(afterClose.json.profile.score).toBe(57);
  });
});

describe('execute-mock trust — audit events', () => {
  it('emits a trust_score_changed audit event when the score changes', async () => {
    const { base } = await startApp();
    await executeMock(base, ALLOW_BODY);

    const res = await rawRequest(
      base,
      '/v1/audit/events?type=trust_score_changed'
    );
    expect(res.status).toBe(200);
    expect(res.json.events.length).toBeGreaterThan(0);
    expect(
      res.json.events.every((e: any) => e.type === 'trust_score_changed')
    ).toBe(true);
  });
});

describe('execute-mock trust — privacy', () => {
  it('never leaks raw input or tokens through trust endpoints', async () => {
    const { base } = await startApp();
    await executeMock(base, ALLOW_BODY);

    const profiles = await rawRequest(base, '/v1/trust/profiles');
    const events = await rawRequest(base, '/v1/trust/events');
    expect(profiles.text).not.toContain('raw-input-secret-marker');
    expect(events.text).not.toContain('raw-input-secret-marker');
    // Restricted gating mints an approval token; it must never reach trust data.
    const { base: base2 } = await startApp({
      trustEngine: seededTrustEngine(1)
    });
    const pending = await executeMock(base2, ALLOW_BODY);
    const token = pending.json.approvalToken;
    const trust = await rawRequest(base2, '/v1/trust/events');
    expect(trust.text).not.toContain(token);
  });
});
