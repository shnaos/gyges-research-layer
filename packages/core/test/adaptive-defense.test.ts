import { beforeEach, describe, expect, it } from 'vitest';
import {
  AdaptiveDefenseEngine,
  AdaptiveDefensePolicy,
  BOOTSTRAP_ADAPTIVE_DEFENSE_POLICIES,
  BOOTSTRAP_RATE_LIMIT_POLICIES,
  CapabilityRateLimiter,
  RateLimitEvaluationInput,
  RateLimitPolicy,
  RuntimeAnomaly,
  RuntimeIncident,
  TemporaryCapabilityBlock,
  escalateRisk
} from '../src/index.js';

/** Build a rate-limit evaluation input with sensible defaults. */
function input(
  overrides: Partial<RateLimitEvaluationInput> = {}
): RateLimitEvaluationInput {
  return {
    agentId: 'agent-1',
    compartmentId: 'research',
    tool: 'search',
    timestamp: 1000,
    ...overrides
  };
}

const AGENT_POLICY: RateLimitPolicy = {
  id: 'agent-rate',
  scope: 'agent',
  maxRequests: 2,
  windowMs: 1000,
  action: 'cooldown',
  enabled: true
};

/** Minimal anomaly factory for adaptive-defense tests. */
function anomaly(
  type: RuntimeAnomaly['type'],
  overrides: Partial<RuntimeAnomaly> = {}
): RuntimeAnomaly {
  return {
    id: overrides.id ?? `an-${type}`,
    createdAt: overrides.createdAt ?? 1000,
    type,
    score: overrides.score ?? 'high',
    relatedEventIds: overrides.relatedEventIds ?? ['e1'],
    summary: overrides.summary ?? `anomaly ${type}`,
    ...overrides
  };
}

/** Minimal incident factory for adaptive-defense tests. */
function incident(
  severity: RuntimeIncident['severity'],
  overrides: Partial<RuntimeIncident> = {}
): RuntimeIncident {
  return {
    id: overrides.id ?? `in-${severity}`,
    createdAt: overrides.createdAt ?? 1000,
    updatedAt: overrides.updatedAt ?? 1000,
    severity,
    status: overrides.status ?? 'open',
    anomalyIds: overrides.anomalyIds ?? ['an-1'],
    relatedEventIds: overrides.relatedEventIds ?? ['e1'],
    summary: overrides.summary ?? `incident ${severity}`
  };
}

describe('CapabilityRateLimiter — policies', () => {
  let limiter: CapabilityRateLimiter;
  beforeEach(() => {
    limiter = new CapabilityRateLimiter();
  });

  it('registers a rate policy and lists it', () => {
    limiter.registerPolicy(AGENT_POLICY);
    expect(limiter.listPolicies()).toHaveLength(1);
    expect(limiter.listPolicies()[0].id).toBe('agent-rate');
  });

  it('rejects a duplicate rate policy id', () => {
    limiter.registerPolicy(AGENT_POLICY);
    expect(() => limiter.registerPolicy(AGENT_POLICY)).toThrow();
  });

  it('clears policies', () => {
    limiter.registerPolicy(AGENT_POLICY);
    limiter.clearPolicies();
    expect(limiter.listPolicies()).toHaveLength(0);
  });

  it('returns defensive copies from listPolicies', () => {
    limiter.registerPolicy(AGENT_POLICY);
    const listed = limiter.listPolicies();
    listed[0].maxRequests = 999;
    expect(limiter.listPolicies()[0].maxRequests).toBe(2);
  });
});

describe('CapabilityRateLimiter — evaluation', () => {
  let limiter: CapabilityRateLimiter;
  beforeEach(() => {
    limiter = new CapabilityRateLimiter();
  });

  it('fail-safe allows when no policy applies', () => {
    const decision = limiter.evaluate(input());
    expect(decision.action).toBe('allow');
  });

  it('allows while under the limit', () => {
    limiter.registerPolicy(AGENT_POLICY);
    expect(limiter.evaluate(input({ timestamp: 1000 })).action).toBe('allow');
    expect(limiter.evaluate(input({ timestamp: 1001 })).action).toBe('allow');
  });

  it('triggers the policy action once over the limit (cooldown)', () => {
    limiter.registerPolicy(AGENT_POLICY);
    limiter.evaluate(input({ timestamp: 1000 }));
    limiter.evaluate(input({ timestamp: 1001 }));
    const decision = limiter.evaluate(input({ timestamp: 1002 }));
    expect(decision.action).toBe('cooldown');
  });

  it('sets retryAfterMs on a cooldown decision', () => {
    limiter.registerPolicy(AGENT_POLICY);
    limiter.evaluate(input({ timestamp: 1000 }));
    limiter.evaluate(input({ timestamp: 1000 }));
    const decision = limiter.evaluate(input({ timestamp: 1000 }));
    expect(decision.action).toBe('cooldown');
    // Oldest in-window entry is at 1000; window 1000ms → resets at 2000.
    expect(decision.retryAfterMs).toBe(1000);
    expect(decision.resetAt).toBe(2000);
  });

  it('ignores a disabled policy', () => {
    limiter.registerPolicy({ ...AGENT_POLICY, enabled: false });
    limiter.evaluate(input({ timestamp: 1000 }));
    limiter.evaluate(input({ timestamp: 1000 }));
    const decision = limiter.evaluate(input({ timestamp: 1000 }));
    expect(decision.action).toBe('allow');
  });

  it('respects a deterministic sliding window (old requests fall out)', () => {
    limiter.registerPolicy(AGENT_POLICY);
    limiter.evaluate(input({ timestamp: 1000 }));
    limiter.evaluate(input({ timestamp: 1500 }));
    // At t=2600 the entries at 1000 and 1500 are outside [1600, 2600].
    const decision = limiter.evaluate(input({ timestamp: 2600 }));
    expect(decision.action).toBe('allow');
  });

  it('produces deterministic decisions for identical sequences', () => {
    const run = (): string[] => {
      const lim = new CapabilityRateLimiter();
      lim.registerPolicy(AGENT_POLICY);
      return [1000, 1001, 1002, 1003].map(
        (t) => lim.evaluate(input({ timestamp: t })).action
      );
    };
    expect(run()).toEqual(run());
  });

  it('does not mutate the caller input', () => {
    limiter.registerPolicy(AGENT_POLICY);
    const original = input({ timestamp: 1000 });
    const snapshot = JSON.stringify(original);
    limiter.evaluate(original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('isolates counters per scope key', () => {
    limiter.registerPolicy({ ...AGENT_POLICY, scope: 'tool' });
    limiter.evaluate(input({ tool: 'search', timestamp: 1000 }));
    limiter.evaluate(input({ tool: 'search', timestamp: 1000 }));
    // A different tool has its own window and is still under the limit.
    expect(
      limiter.evaluate(input({ tool: 'fetch_html', timestamp: 1000 })).action
    ).toBe('allow');
    // The original tool is now over the limit.
    expect(
      limiter.evaluate(input({ tool: 'search', timestamp: 1000 })).action
    ).toBe('cooldown');
  });

  it('skips a session-scoped policy when no session is present', () => {
    limiter.registerPolicy({ ...AGENT_POLICY, scope: 'session' });
    for (let i = 0; i < 5; i++) limiter.evaluate(input({ timestamp: 1000 }));
    expect(limiter.evaluate(input({ timestamp: 1000 })).action).toBe('allow');
  });
});

describe('CapabilityRateLimiter — temporary blocks', () => {
  let limiter: CapabilityRateLimiter;
  beforeEach(() => {
    limiter = new CapabilityRateLimiter();
  });

  const block = (
    overrides: Partial<TemporaryCapabilityBlock> = {}
  ): TemporaryCapabilityBlock => ({
    id: overrides.id ?? 'blk-1',
    createdAt: overrides.createdAt ?? 1000,
    expiresAt: overrides.expiresAt ?? 5000,
    reason: overrides.reason ?? 'sandbox defense',
    ...overrides
  });

  it('denies a request matched by a live temporary block', () => {
    limiter.registerTemporaryBlock(block({ agentId: 'agent-1' }));
    const decision = limiter.evaluate(input({ timestamp: 2000 }));
    expect(decision.action).toBe('temporary_block');
    expect(decision.retryAfterMs).toBe(3000);
  });

  it('does not match a block for a different agent', () => {
    limiter.registerTemporaryBlock(block({ agentId: 'other' }));
    expect(limiter.evaluate(input({ timestamp: 2000 })).action).toBe('allow');
  });

  it('treats a fully-unscoped block as global', () => {
    limiter.registerTemporaryBlock(block());
    expect(limiter.evaluate(input({ timestamp: 2000 })).action).toBe(
      'temporary_block'
    );
  });

  it('ignores an expired block (expiration)', () => {
    limiter.registerTemporaryBlock(block({ expiresAt: 1500 }));
    expect(limiter.evaluate(input({ timestamp: 2000 })).action).toBe('allow');
  });

  it('clears expired blocks and reports the count', () => {
    limiter.registerTemporaryBlock(block({ id: 'a', expiresAt: 1500 }));
    limiter.registerTemporaryBlock(block({ id: 'b', expiresAt: 9000 }));
    const removed = limiter.clearExpiredBlocks(2000);
    expect(removed).toBe(1);
    expect(limiter.listTemporaryBlocks().map((b) => b.id)).toEqual(['b']);
  });

  it('returns defensive copies from listTemporaryBlocks', () => {
    limiter.registerTemporaryBlock(block());
    const listed = limiter.listTemporaryBlocks();
    listed[0].reason = 'mutated';
    expect(limiter.listTemporaryBlocks()[0].reason).toBe('sandbox defense');
  });
});

describe('AdaptiveDefenseEngine', () => {
  let engine: AdaptiveDefenseEngine;
  beforeEach(() => {
    engine = new AdaptiveDefenseEngine();
  });

  const COOLDOWN_POLICY: AdaptiveDefensePolicy = {
    id: 'denied-cooldown',
    triggerAnomalyTypes: ['repeated_denied_capabilities'],
    triggerIncidentSeverities: [],
    resultingAction: 'cooldown',
    cooldownMs: 60_000,
    enabled: true
  };

  it('registers and lists policies', () => {
    engine.registerPolicy(COOLDOWN_POLICY);
    expect(engine.listPolicies()).toHaveLength(1);
  });

  it('rejects a duplicate policy id', () => {
    engine.registerPolicy(COOLDOWN_POLICY);
    expect(() => engine.registerPolicy(COOLDOWN_POLICY)).toThrow();
  });

  it('clears policies', () => {
    engine.registerPolicy(COOLDOWN_POLICY);
    engine.clearPolicies();
    expect(engine.listPolicies()).toHaveLength(0);
  });

  it('returns a cooldown decision for repeated denied capabilities', () => {
    engine.registerPolicy(COOLDOWN_POLICY);
    const decisions = engine.evaluate({
      anomalies: [anomaly('repeated_denied_capabilities')],
      incidents: []
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe('cooldown');
    expect(decisions[0].cooldownMs).toBe(60_000);
  });

  it('returns a temporary_block decision for sandbox violations', () => {
    engine.registerPolicy({
      id: 'sandbox',
      triggerAnomalyTypes: ['sandbox_violation_attempts'],
      triggerIncidentSeverities: ['critical'],
      resultingAction: 'temporary_block',
      enabled: true
    });
    const decisions = engine.evaluate({
      anomalies: [anomaly('sandbox_violation_attempts')],
      incidents: []
    });
    expect(decisions[0].action).toBe('temporary_block');
  });

  it('returns a require_approval decision for privacy violations', () => {
    engine.registerPolicy({
      id: 'privacy',
      triggerAnomalyTypes: ['privacy_boundary_violations'],
      triggerIncidentSeverities: [],
      resultingAction: 'require_approval',
      enabled: true
    });
    const decisions = engine.evaluate({
      anomalies: [anomaly('privacy_boundary_violations')],
      incidents: []
    });
    expect(decisions[0].action).toBe('require_approval');
  });

  it('returns an escalate_risk decision with an escalation for a critical incident', () => {
    engine.registerPolicy({
      id: 'escalate',
      triggerAnomalyTypes: [],
      triggerIncidentSeverities: ['critical'],
      resultingAction: 'escalate_risk',
      escalationRiskLevel: 'high',
      enabled: true
    });
    const decisions = engine.evaluate({
      anomalies: [],
      incidents: [incident('critical')]
    });
    expect(decisions[0].action).toBe('escalate_risk');
    expect(decisions[0].escalation?.escalatedRisk).toBe('high');
  });

  it('ignores a disabled adaptive policy', () => {
    engine.registerPolicy({ ...COOLDOWN_POLICY, enabled: false });
    const decisions = engine.evaluate({
      anomalies: [anomaly('repeated_denied_capabilities')],
      incidents: []
    });
    expect(decisions).toHaveLength(0);
  });

  it('produces deterministic, ordered decisions', () => {
    engine.registerPolicy(COOLDOWN_POLICY);
    engine.registerPolicy({
      id: 'sandbox',
      triggerAnomalyTypes: ['sandbox_violation_attempts'],
      triggerIncidentSeverities: [],
      resultingAction: 'temporary_block',
      enabled: true
    });
    const evalOnce = () =>
      engine
        .evaluate({
          anomalies: [
            anomaly('sandbox_violation_attempts'),
            anomaly('repeated_denied_capabilities')
          ],
          incidents: []
        })
        .map((d) => d.action);
    // Registration order, not anomaly order: cooldown then temporary_block.
    expect(evalOnce()).toEqual(['cooldown', 'temporary_block']);
    expect(evalOnce()).toEqual(['cooldown', 'temporary_block']);
  });

  it('does not mutate the input anomalies/incidents', () => {
    engine.registerPolicy(COOLDOWN_POLICY);
    const anomalies = [anomaly('repeated_denied_capabilities')];
    const snapshot = JSON.stringify(anomalies);
    engine.evaluate({ anomalies, incidents: [] });
    expect(JSON.stringify(anomalies)).toBe(snapshot);
  });
});

describe('escalateRisk helper', () => {
  it('escalates upward only', () => {
    expect(escalateRisk('low', 'high', 'r')?.escalatedRisk).toBe('high');
    expect(escalateRisk('high', 'low', 'r')).toBeUndefined();
    expect(escalateRisk('medium', 'medium', 'r')).toBeUndefined();
  });
});

describe('bootstrap defense policies', () => {
  it('registers all bootstrap rate-limit policies', () => {
    const limiter = new CapabilityRateLimiter();
    for (const policy of BOOTSTRAP_RATE_LIMIT_POLICIES) {
      limiter.registerPolicy(policy);
    }
    expect(limiter.listPolicies()).toHaveLength(
      BOOTSTRAP_RATE_LIMIT_POLICIES.length
    );
  });

  it('registers all bootstrap adaptive policies', () => {
    const engine = new AdaptiveDefenseEngine();
    for (const policy of BOOTSTRAP_ADAPTIVE_DEFENSE_POLICIES) {
      engine.registerPolicy(policy);
    }
    expect(engine.listPolicies()).toHaveLength(
      BOOTSTRAP_ADAPTIVE_DEFENSE_POLICIES.length
    );
  });
});
