import { describe, expect, it } from 'vitest';
import {
  PrivacyBoundaryEngine,
  PrivacyBoundaryError,
  PrivacyBoundaryEvaluationInput,
  PrivacyBoundaryRule,
  BOOTSTRAP_PRIVACY_BOUNDARY_RULES,
  BOOTSTRAP_RESEARCH_SELF_RULE
} from '../src/index.js';

/** Build a privacy boundary rule with sensible defaults that tests override. */
function rule(overrides: Partial<PrivacyBoundaryRule> = {}): PrivacyBoundaryRule {
  return {
    id: 'research-self',
    sourceCompartmentId: 'research',
    targetCompartmentId: 'research',
    maxAllowedRisk: 'low',
    actionOnViolation: 'require_approval',
    ...overrides
  };
}

/** Build an evaluation input; only the boundary-relevant fields matter. */
function input(
  overrides: Partial<PrivacyBoundaryEvaluationInput> = {}
): PrivacyBoundaryEvaluationInput {
  return {
    agentId: 'local-agent',
    sourceCompartmentId: 'research',
    targetCompartmentId: 'research',
    tool: 'search',
    riskLevel: 'low',
    ...overrides
  };
}

/** A bootstrap-seeded engine, as the local server starts. */
function bootstrapEngine(): PrivacyBoundaryEngine {
  const engine = new PrivacyBoundaryEngine();
  for (const r of BOOTSTRAP_PRIVACY_BOUNDARY_RULES) engine.registerRule(r);
  return engine;
}

describe('PrivacyBoundaryEngine — registration', () => {
  it('registers a rule and lists it', () => {
    const engine = new PrivacyBoundaryEngine();
    engine.registerRule(rule());
    expect(engine.size()).toBe(1);
    expect(engine.listRules()).toHaveLength(1);
    expect(engine.listRules()[0].id).toBe('research-self');
  });

  it('rejects a duplicate (source, target) rule', () => {
    const engine = new PrivacyBoundaryEngine();
    engine.registerRule(rule());
    expect(() => engine.registerRule(rule({ id: 'other-id' }))).toThrow(
      PrivacyBoundaryError
    );
    expect(engine.size()).toBe(1);
  });

  it('rejects a duplicate rule id', () => {
    const engine = new PrivacyBoundaryEngine();
    engine.registerRule(rule());
    expect(() =>
      engine.registerRule(
        rule({ sourceCompartmentId: 'marketing', targetCompartmentId: 'research' })
      )
    ).toThrow(PrivacyBoundaryError);
    expect(engine.size()).toBe(1);
  });

  it('clearRules removes every rule and forgets compartments', () => {
    const engine = bootstrapEngine();
    expect(engine.size()).toBe(1);
    engine.clearRules();
    expect(engine.size()).toBe(0);
    // After clearing, even the previously-known target is unknown → block.
    const decision = engine.evaluate(input());
    expect(decision.action).toBe('block');
    expect(decision.signals).toContain('unknown_compartment');
  });

  it('listRules returns deep copies that cannot mutate engine state', () => {
    const engine = bootstrapEngine();
    const rules = engine.listRules();
    rules[0].maxAllowedRisk = 'high';
    rules[0].actionOnViolation = 'block';
    expect(engine.listRules()[0].maxAllowedRisk).toBe('low');
    expect(engine.listRules()[0].actionOnViolation).toBe('require_approval');
  });
});

describe('PrivacyBoundaryEngine — fail-closed', () => {
  it('blocks an unknown target compartment with high risk', () => {
    const engine = bootstrapEngine();
    const decision = engine.evaluate(
      input({ sourceCompartmentId: 'research', targetCompartmentId: 'unknown' })
    );
    expect(decision.action).toBe('block');
    expect(decision.riskLevel).toBe('high');
    expect(decision.signals).toEqual(['unknown_compartment']);
  });

  it('blocks (fail-closed) when no (source, target) rule matches', () => {
    const engine = bootstrapEngine();
    const decision = engine.evaluate(
      input({ sourceCompartmentId: 'unknown', targetCompartmentId: 'research' })
    );
    expect(decision.action).toBe('block');
    expect(decision.riskLevel).toBe('high');
    expect(decision.signals).toContain('cross_compartment');
  });

  it('blocks an empty engine fail-closed', () => {
    const engine = new PrivacyBoundaryEngine();
    const decision = engine.evaluate(input());
    expect(decision.action).toBe('block');
    expect(decision.signals).toContain('unknown_compartment');
  });
});

describe('PrivacyBoundaryEngine — same compartment', () => {
  it('allows same compartment, same tool, low risk', () => {
    const engine = bootstrapEngine();
    const decision = engine.evaluate(input());
    expect(decision.action).toBe('allow');
    expect(decision.riskLevel).toBe('low');
    expect(decision.signals).toEqual(['same_compartment']);
  });

  it('treats a missing source as self-access into the target', () => {
    const engine = bootstrapEngine();
    const decision = engine.evaluate(
      input({ sourceCompartmentId: undefined })
    );
    expect(decision.action).toBe('allow');
    expect(decision.signals).toContain('same_compartment');
  });
});

describe('PrivacyBoundaryEngine — correlation signals', () => {
  it('escalates risk above the ceiling to require_approval', () => {
    const engine = bootstrapEngine();
    const decision = engine.evaluate(input({ riskLevel: 'medium' }));
    expect(decision.action).toBe('require_approval');
    expect(decision.riskLevel).toBe('medium');
    expect(decision.signals).toContain('risk_escalation');
    expect(decision.signals).toContain('same_compartment');
  });

  it('rotates the session when routing demands strict isolation', () => {
    const engine = bootstrapEngine();
    const decision = engine.evaluate(
      input({ routingIsolationLevel: 'strict' })
    );
    expect(decision.action).toBe('rotate_session');
    expect(decision.signals).toContain('strict_isolation_required');
  });

  it('rotates the session on forbidden cross-tool reuse', () => {
    const engine = bootstrapEngine();
    const decision = engine.evaluate(
      input({ tool: 'fetch_html', previousTool: 'search', allowCrossToolReuse: false })
    );
    expect(decision.action).toBe('rotate_session');
    expect(decision.signals).toContain('cross_tool_reuse');
  });

  it('blocks cross-tool reuse when the rule mandates block on violation', () => {
    const engine = new PrivacyBoundaryEngine();
    engine.registerRule(rule({ actionOnViolation: 'block' }));
    const decision = engine.evaluate(
      input({ tool: 'fetch_html', previousTool: 'search', allowCrossToolReuse: false })
    );
    expect(decision.action).toBe('block');
    expect(decision.signals).toContain('cross_tool_reuse');
  });

  it('does not flag cross-tool reuse when it is allowed', () => {
    const engine = bootstrapEngine();
    const decision = engine.evaluate(
      input({ tool: 'fetch_html', previousTool: 'search', allowCrossToolReuse: true })
    );
    expect(decision.action).toBe('allow');
    expect(decision.signals).not.toContain('cross_tool_reuse');
  });

  it('blocks a cross-compartment flow even with a permissive rule', () => {
    const engine = new PrivacyBoundaryEngine();
    engine.registerRule(
      rule({
        id: 'm-to-r',
        sourceCompartmentId: 'marketing',
        targetCompartmentId: 'research',
        actionOnViolation: 'block'
      })
    );
    const decision = engine.evaluate(
      input({ sourceCompartmentId: 'marketing', targetCompartmentId: 'research' })
    );
    expect(decision.action).toBe('block');
    expect(decision.riskLevel).toBe('high');
    expect(decision.signals).toContain('cross_compartment');
  });

  it('picks the most restrictive action across multiple signals', () => {
    const engine = bootstrapEngine();
    const decision = engine.evaluate(
      input({
        riskLevel: 'high',
        routingIsolationLevel: 'strict'
      })
    );
    // risk_escalation → require_approval beats strict → rotate_session.
    expect(decision.action).toBe('require_approval');
    expect(decision.riskLevel).toBe('high');
    expect(decision.signals).toContain('risk_escalation');
    expect(decision.signals).toContain('strict_isolation_required');
  });
});

describe('PrivacyBoundaryEngine — determinism & purity', () => {
  it('is deterministic for identical inputs', () => {
    const engine = bootstrapEngine();
    const a = engine.evaluate(input({ riskLevel: 'medium' }));
    const b = engine.evaluate(input({ riskLevel: 'medium' }));
    expect(a).toEqual(b);
  });

  it('never mutates the evaluation input', () => {
    const engine = bootstrapEngine();
    const original = input({ riskLevel: 'medium', routingIsolationLevel: 'strict' });
    const snapshot = JSON.parse(JSON.stringify(original));
    engine.evaluate(original);
    expect(original).toEqual(snapshot);
  });

  it('never mutates registered rules when the caller mutates its copy', () => {
    const engine = new PrivacyBoundaryEngine();
    const r = rule();
    engine.registerRule(r);
    r.maxAllowedRisk = 'high';
    r.actionOnViolation = 'block';
    const decision = engine.evaluate(input({ riskLevel: 'medium' }));
    expect(decision.action).toBe('require_approval');
  });
});

describe('Privacy boundary bootstrap rules', () => {
  it('exposes the research-self rule', () => {
    expect(BOOTSTRAP_RESEARCH_SELF_RULE.sourceCompartmentId).toBe('research');
    expect(BOOTSTRAP_RESEARCH_SELF_RULE.targetCompartmentId).toBe('research');
    expect(BOOTSTRAP_RESEARCH_SELF_RULE.maxAllowedRisk).toBe('low');
    expect(BOOTSTRAP_RESEARCH_SELF_RULE.actionOnViolation).toBe('require_approval');
    expect(BOOTSTRAP_PRIVACY_BOUNDARY_RULES).toHaveLength(1);
  });
});
