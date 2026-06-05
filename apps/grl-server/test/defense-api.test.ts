import { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AdaptiveDefenseEngine,
  CapabilityRateLimiter
} from '../../../packages/core/src/index.js';
import {
  buildAdaptiveDefenseEngine,
  buildApprovalQueue,
  buildBootstrapFirewall,
  buildCapabilityRateLimiter,
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

const ALLOWED_REQUEST = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'low',
  input: { q: 'raw-input-secret-marker' }
};

/** A rate limiter forced to always return a single deterministic decision. */
function forcedRateLimiter(
  decision: ReturnType<CapabilityRateLimiter['evaluate']>
): CapabilityRateLimiter {
  const limiter = new CapabilityRateLimiter();
  limiter.evaluate = () => ({ ...decision });
  return limiter;
}

/** An adaptive engine forced to always return a fixed list of decisions. */
function forcedAdaptiveEngine(
  decisions: ReturnType<AdaptiveDefenseEngine['evaluate']>
): AdaptiveDefenseEngine {
  const engine = new AdaptiveDefenseEngine();
  engine.evaluate = () => decisions.map((d) => ({ ...d }));
  return engine;
}

describe('GET /v1/defense/rate-limits', () => {
  it('lists the bootstrap rate-limit policies as metadata', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/defense/rate-limits');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.policies)).toBe(true);
    const ids = res.json.policies.map((p: any) => p.id);
    expect(ids).toContain('agent-search-rate');
    expect(ids).toContain('tool-fetch-html-rate');
    // Metadata only: shape is policy config, never tokens or raw input.
    for (const policy of res.json.policies) {
      expect(policy).toHaveProperty('scope');
      expect(policy).toHaveProperty('maxRequests');
      expect(policy).toHaveProperty('windowMs');
      expect(policy).toHaveProperty('action');
      expect(policy).toHaveProperty('enabled');
    }
  });

  it('returns 405 for non-GET methods', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/defense/rate-limits', {
      method: 'POST'
    });
    expect(res.status).toBe(405);
    expect(res.json.error).toMatch(/Method not allowed/);
  });
});

describe('GET /v1/defense/adaptive-policies', () => {
  it('lists the bootstrap adaptive defense policies as metadata', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/defense/adaptive-policies');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.policies)).toBe(true);
    const ids = res.json.policies.map((p: any) => p.id);
    expect(ids).toContain('sandbox-defense');
    expect(ids).toContain('risk-escalation-defense');
    for (const policy of res.json.policies) {
      expect(policy).toHaveProperty('triggerAnomalyTypes');
      expect(policy).toHaveProperty('triggerIncidentSeverities');
      expect(policy).toHaveProperty('resultingAction');
      expect(policy).toHaveProperty('enabled');
    }
  });

  it('returns 405 for non-GET methods', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/defense/adaptive-policies', {
      method: 'DELETE'
    });
    expect(res.status).toBe(405);
  });
});

describe('GET /v1/defense/temporary-blocks', () => {
  it('returns an empty list initially', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/defense/temporary-blocks');
    expect(res.status).toBe(200);
    expect(res.json.blocks).toEqual([]);
  });

  it('lists registered temporary blocks as metadata', async () => {
    const rateLimiter = buildCapabilityRateLimiter();
    rateLimiter.registerTemporaryBlock({
      id: 'block-1',
      createdAt: 1000,
      expiresAt: 9_999_999_999_999,
      agentId: 'local-agent',
      tool: 'search',
      reason: 'sandbox violation'
    });
    const { base } = await startApp({ rateLimiter });
    const res = await rawRequest(base, '/v1/defense/temporary-blocks');
    expect(res.status).toBe(200);
    expect(res.json.blocks).toHaveLength(1);
    expect(res.json.blocks[0].id).toBe('block-1');
    expect(res.json.blocks[0].reason).toBe('sandbox violation');
  });

  it('returns 405 for non-GET methods', async () => {
    const { base } = await startApp();
    const res = await rawRequest(base, '/v1/defense/temporary-blocks', {
      method: 'PUT'
    });
    expect(res.status).toBe(405);
  });
});

describe('execute-mock rate limiter defense', () => {
  it('denies with a cooldown defense and retryAfterMs', async () => {
    const rateLimiter = forcedRateLimiter({
      action: 'cooldown',
      remaining: 0,
      resetAt: 60_000,
      retryAfterMs: 1234,
      reason: 'rate exceeded'
    });
    const { base } = await startApp({ rateLimiter });
    const res = await executeMock(base, ALLOWED_REQUEST);
    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('denied');
    expect(res.json.defense.action).toBe('cooldown');
    expect(res.json.defense.source).toBe('rate_limit');
    expect(res.json.defense.retryAfterMs).toBe(1234);
  });

  it('denies with a temporary_block defense', async () => {
    const rateLimiter = forcedRateLimiter({
      action: 'temporary_block',
      remaining: 0,
      resetAt: 60_000,
      reason: 'temporary block active'
    });
    const { base } = await startApp({ rateLimiter });
    const res = await executeMock(base, ALLOWED_REQUEST);
    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('denied');
    expect(res.json.defense.action).toBe('temporary_block');
    expect(res.json.defense.source).toBe('rate_limit');
  });

  it('emits a rate_limit_triggered audit event', async () => {
    const rateLimiter = forcedRateLimiter({
      action: 'cooldown',
      remaining: 0,
      resetAt: 60_000,
      retryAfterMs: 1234,
      reason: 'rate exceeded'
    });
    const { base } = await startApp({ rateLimiter });
    await executeMock(base, ALLOWED_REQUEST);
    const events = await rawRequest(
      base,
      '/v1/audit/events?type=rate_limit_triggered'
    );
    expect(events.status).toBe(200);
    expect(events.json.events.length).toBeGreaterThanOrEqual(1);
    const cooldown = await rawRequest(
      base,
      '/v1/audit/events?type=cooldown_applied'
    );
    expect(cooldown.json.events.length).toBeGreaterThanOrEqual(1);
  });
});

describe('execute-mock adaptive defense', () => {
  it('denies with a temporary_block from adaptive defense', async () => {
    const adaptiveDefenseEngine = forcedAdaptiveEngine([
      { action: 'temporary_block', reason: 'sandbox defense' }
    ]);
    const { base } = await startApp({ adaptiveDefenseEngine });
    const res = await executeMock(base, ALLOWED_REQUEST);
    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('denied');
    expect(res.json.defense.action).toBe('temporary_block');
    expect(res.json.defense.source).toBe('adaptive_defense');
  });

  it('escalates risk before the firewall (low → high gets denied)', async () => {
    const adaptiveDefenseEngine = forcedAdaptiveEngine([
      {
        action: 'escalate_risk',
        reason: 'risk escalation defense',
        escalation: {
          originalRisk: 'low',
          escalatedRisk: 'high',
          reason: 'risk escalation defense'
        }
      }
    ]);
    const { base } = await startApp({ adaptiveDefenseEngine });
    const res = await executeMock(base, ALLOWED_REQUEST);
    expect(res.status).toBe(200);
    // low risk would normally be allowed; escalation to high makes the firewall deny.
    expect(res.json.decision).toBe('denied');
    expect(res.json.defense.action).toBe('escalate_risk');
    expect(res.json.defense.escalation.originalRisk).toBe('low');
    expect(res.json.defense.escalation.escalatedRisk).toBe('high');
  });

  it('routes a require_approval adaptive decision into a pending flow', async () => {
    const adaptiveDefenseEngine = forcedAdaptiveEngine([
      { action: 'require_approval', reason: 'privacy boundary defense' }
    ]);
    const { base } = await startApp({ adaptiveDefenseEngine });
    const res = await executeMock(base, ALLOWED_REQUEST);
    expect(res.status).toBe(200);
    expect(res.json.decision).toBe('pending');
    expect(res.json.defense.action).toBe('require_approval');
    expect(typeof res.json.approvalRequestId).toBe('string');
    expect(typeof res.json.approvalToken).toBe('string');
  });

  it('emits an adaptive_defense_triggered audit event', async () => {
    const adaptiveDefenseEngine = forcedAdaptiveEngine([
      { action: 'temporary_block', reason: 'sandbox defense' }
    ]);
    const { base } = await startApp({ adaptiveDefenseEngine });
    await executeMock(base, ALLOWED_REQUEST);
    const events = await rawRequest(
      base,
      '/v1/audit/events?type=adaptive_defense_triggered'
    );
    expect(events.status).toBe(200);
    expect(events.json.events.length).toBeGreaterThanOrEqual(1);
  });

  it('emits a risk_escalated audit event when escalating', async () => {
    const adaptiveDefenseEngine = forcedAdaptiveEngine([
      {
        action: 'escalate_risk',
        reason: 'risk escalation defense',
        escalation: {
          originalRisk: 'low',
          escalatedRisk: 'high',
          reason: 'risk escalation defense'
        }
      }
    ]);
    const { base } = await startApp({ adaptiveDefenseEngine });
    await executeMock(base, ALLOWED_REQUEST);
    const events = await rawRequest(
      base,
      '/v1/audit/events?type=risk_escalated'
    );
    expect(events.status).toBe(200);
    expect(events.json.events.length).toBeGreaterThanOrEqual(1);
  });
});

describe('defense never leaks tokens or raw input', () => {
  it('defense endpoints expose no token and no raw input', async () => {
    const rateLimiter = buildCapabilityRateLimiter();
    rateLimiter.registerTemporaryBlock({
      id: 'block-1',
      createdAt: 1000,
      expiresAt: 9_999_999_999_999,
      reason: 'sandbox violation'
    });
    const { base } = await startApp({ rateLimiter });
    for (const path of [
      '/v1/defense/rate-limits',
      '/v1/defense/temporary-blocks',
      '/v1/defense/adaptive-policies'
    ]) {
      const res = await rawRequest(base, path);
      expect(res.text).not.toMatch(/token/i);
      expect(res.text).not.toContain('raw-input-secret-marker');
    }
  });

  it('rate-limit audit events store no raw input marker', async () => {
    const rateLimiter = forcedRateLimiter({
      action: 'cooldown',
      remaining: 0,
      resetAt: 60_000,
      retryAfterMs: 1234,
      reason: 'rate exceeded'
    });
    const { base } = await startApp({ rateLimiter });
    await executeMock(base, ALLOWED_REQUEST);
    const events = await rawRequest(base, '/v1/audit/events');
    expect(events.text).not.toContain('raw-input-secret-marker');
  });
});
