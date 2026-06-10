import { describe, expect, it } from 'vitest';
import {
  ExecutionRequest,
  IsolationPolicy,
  TransportPolicyEngine,
  TransportPolicyError,
  TransportPolicyRule,
  BOOTSTRAP_TRANSPORT_POLICY_RULES
} from '../src/index.js';

/** Build an isolation policy with sensible defaults that tests override. */
function isolation(overrides: Partial<IsolationPolicy> = {}): IsolationPolicy {
  return {
    level: 'session',
    forceRotateOnHighRisk: false,
    forbidSessionReuse: false,
    allowCrossToolReuse: true,
    ...overrides
  };
}

/** Build a routing rule with sensible defaults that tests override. */
function rule(overrides: Partial<TransportPolicyRule> = {}): TransportPolicyRule {
  return {
    tool: 'search',
    riskLevel: 'low',
    preferredTransport: 'mock',
    isolationPolicy: isolation(),
    ...overrides
  };
}

/** Build an ExecutionRequest; only `tool`/`riskLevel` matter for resolution. */
function request(
  overrides: Partial<ExecutionRequest> = {}
): ExecutionRequest {
  return {
    id: 'req-1',
    agentId: 'local-agent',
    compartmentId: 'research',
    tool: 'search',
    riskLevel: 'low',
    input: 'x',
    session: {
      sessionId: 'sess-1',
      compartmentId: 'research',
      transportKind: 'mock',
      createdAt: 0
    },
    ...overrides
  };
}

describe('TransportPolicyEngine — registration', () => {
  it('registers a rule and lists it', () => {
    const engine = new TransportPolicyEngine();
    engine.registerRule(rule());
    expect(engine.size()).toBe(1);
    expect(engine.listRules()).toHaveLength(1);
    expect(engine.listRules()[0].tool).toBe('search');
  });

  it('throws on a duplicate (tool, riskLevel) — no silent overwrite', () => {
    const engine = new TransportPolicyEngine();
    engine.registerRule(rule({ preferredTransport: 'mock' }));
    expect(() => engine.registerRule(rule({ preferredTransport: 'direct' }))).toThrow(
      TransportPolicyError
    );
    // The original rule survives unchanged.
    expect(engine.listRules()[0].preferredTransport).toBe('mock');
  });

  it('allows the same tool at a different risk level', () => {
    const engine = new TransportPolicyEngine();
    engine.registerRule(rule({ riskLevel: 'low' }));
    engine.registerRule(rule({ riskLevel: 'high' }));
    expect(engine.size()).toBe(2);
  });

  it('clears all rules', () => {
    const engine = new TransportPolicyEngine();
    engine.registerRule(rule());
    engine.clearRules();
    expect(engine.size()).toBe(0);
    expect(engine.listRules()).toEqual([]);
  });
});

describe('TransportPolicyEngine — resolution', () => {
  it('is fail-closed on a missing rule', () => {
    const engine = new TransportPolicyEngine();
    expect(() => engine.resolve(request())).toThrow(TransportPolicyError);
    try {
      engine.resolve(request());
    } catch (err) {
      expect((err as TransportPolicyError).kind).toBe('no_rule');
    }
  });

  it('low risk + reuse allowed → reuse_allowed, no rotation', () => {
    const engine = new TransportPolicyEngine();
    engine.registerRule(rule({ isolationPolicy: isolation({ level: 'session' }) }));
    const decision = engine.resolve(request({ riskLevel: 'low' }));
    expect(decision.shouldRotateSession).toBe(false);
    expect(decision.reason).toBe('reuse_allowed');
    expect(decision.isolationLevel).toBe('session');
  });

  it('high risk + forceRotateOnHighRisk → forced_rotation', () => {
    const engine = new TransportPolicyEngine();
    engine.registerRule(
      rule({
        riskLevel: 'high',
        isolationPolicy: isolation({ level: 'session', forceRotateOnHighRisk: true })
      })
    );
    const decision = engine.resolve(request({ riskLevel: 'high' }));
    expect(decision.shouldRotateSession).toBe(true);
    expect(decision.reason).toBe('forced_rotation');
  });

  it('forbidSessionReuse → forced rotation regardless of risk', () => {
    const engine = new TransportPolicyEngine();
    engine.registerRule(
      rule({ isolationPolicy: isolation({ level: 'session', forbidSessionReuse: true }) })
    );
    const decision = engine.resolve(request({ riskLevel: 'low' }));
    expect(decision.shouldRotateSession).toBe(true);
    expect(decision.reason).toBe('forced_rotation');
  });

  it('strict isolation → strict_isolation + rotation', () => {
    const engine = new TransportPolicyEngine();
    engine.registerRule(
      rule({ isolationPolicy: isolation({ level: 'strict', forbidSessionReuse: false }) })
    );
    const decision = engine.resolve(request({ riskLevel: 'low' }));
    expect(decision.isolationLevel).toBe('strict');
    expect(decision.reason).toBe('strict_isolation');
    expect(decision.shouldRotateSession).toBe(true);
  });

  it('high risk without forced rotation → risk_escalation, no rotation', () => {
    const engine = new TransportPolicyEngine();
    engine.registerRule(
      rule({
        riskLevel: 'high',
        isolationPolicy: isolation({ level: 'session', forceRotateOnHighRisk: false })
      })
    );
    const decision = engine.resolve(request({ riskLevel: 'high' }));
    expect(decision.shouldRotateSession).toBe(false);
    expect(decision.reason).toBe('risk_escalation');
  });

  it('isolation level none → default_transport', () => {
    const engine = new TransportPolicyEngine();
    engine.registerRule(rule({ isolationPolicy: isolation({ level: 'none' }) }));
    const decision = engine.resolve(request({ riskLevel: 'low' }));
    expect(decision.reason).toBe('default_transport');
    expect(decision.shouldRotateSession).toBe(false);
  });

  it('propagates the preferred transport', () => {
    const engine = new TransportPolicyEngine();
    engine.registerRule(rule({ preferredTransport: 'tor' }));
    expect(engine.resolve(request()).transportKind).toBe('tor');
  });

  it('is deterministic: identical inputs yield identical decisions', () => {
    const engine = new TransportPolicyEngine();
    engine.registerRule(rule());
    const a = engine.resolve(request());
    const b = engine.resolve(request());
    expect(a).toEqual(b);
  });

  it('does not mutate the request or the stored rules', () => {
    const engine = new TransportPolicyEngine();
    const original = rule();
    engine.registerRule(original);
    const req = request();
    const reqSnapshot = JSON.parse(JSON.stringify(req));

    engine.resolve(req);
    // Mutating the caller's rule object never affects the engine.
    original.preferredTransport = 'browser';
    original.isolationPolicy.level = 'none';

    expect(req).toEqual(reqSnapshot);
    expect(engine.listRules()[0].preferredTransport).toBe('mock');
    expect(engine.listRules()[0].isolationPolicy.level).toBe('session');
  });

  it('listRules returns copies that cannot mutate internal state', () => {
    const engine = new TransportPolicyEngine();
    engine.registerRule(rule());
    const listed = engine.listRules();
    listed[0].preferredTransport = 'proxy';
    listed[0].isolationPolicy.forbidSessionReuse = true;
    expect(engine.listRules()[0].preferredTransport).toBe('mock');
    expect(engine.listRules()[0].isolationPolicy.forbidSessionReuse).toBe(false);
  });
});

describe('TransportPolicyEngine — bootstrap rules', () => {
  it('registers both bootstrap rules and resolves them deterministically', () => {
    const engine = new TransportPolicyEngine();
    for (const r of BOOTSTRAP_TRANSPORT_POLICY_RULES) {
      engine.registerRule(r);
    }
    expect(engine.size()).toBe(2);

    const searchDecision = engine.resolve(request({ tool: 'search', riskLevel: 'low' }));
    expect(searchDecision).toEqual({
      transportKind: 'searxng',
      shouldRotateSession: false,
      isolationLevel: 'session',
      reason: 'reuse_allowed'
    });

    const fetchDecision = engine.resolve(
      request({ tool: 'fetch_html', riskLevel: 'medium' })
    );
    expect(fetchDecision).toEqual({
      transportKind: 'searxng',
      shouldRotateSession: true,
      isolationLevel: 'strict',
      reason: 'forced_rotation'
    });
  });
});
