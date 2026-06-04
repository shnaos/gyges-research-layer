import { describe, expect, it } from 'vitest';
import { CapabilityRequest } from '../../core/src/index.js';
import { PolicyDocument, YamlPolicyEngine } from '../src/index.js';

const allowSearchLowResearch: PolicyDocument = {
  defaultDeny: true,
  rules: [
    {
      effect: 'allow',
      agentId: 'local-agent',
      compartment: 'research',
      tool: 'search',
      riskLevel: 'low',
      requiresConfirmation: false
    }
  ]
};

const baseRequest: CapabilityRequest = {
  agentId: 'local-agent',
  compartment: 'research',
  tool: 'search',
  riskLevel: 'low',
  input: { query: 'gyges research layer' }
};

describe('YamlPolicyEngine', () => {
  it('denies by default when no rule matches', () => {
    const engine = new YamlPolicyEngine({ defaultDeny: true, rules: [] });
    const result = engine.evaluate(baseRequest);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Denied by default');
  });

  it('allows the explicit search/low/research combination', () => {
    const engine = new YamlPolicyEngine(allowSearchLowResearch);
    const result = engine.evaluate(baseRequest);

    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('Allowed by explicit');
  });

  it('denies when the risk level is too high', () => {
    const engine = new YamlPolicyEngine(allowSearchLowResearch);
    const result = engine.evaluate({ ...baseRequest, riskLevel: 'high' });

    expect(result.allowed).toBe(false);
  });

  it('denies when the compartment is wrong', () => {
    const engine = new YamlPolicyEngine(allowSearchLowResearch);
    const result = engine.evaluate({ ...baseRequest, compartment: 'personal' });

    expect(result.allowed).toBe(false);
  });

  it('denies a tool that is not allowed', () => {
    const engine = new YamlPolicyEngine(allowSearchLowResearch);
    const result = engine.evaluate({ ...baseRequest, tool: 'fetch_html' });

    expect(result.allowed).toBe(false);
  });
});

const torPolicy: PolicyDocument = {
  defaultDeny: true,
  rules: [
    {
      effect: 'allow',
      agentId: 'research-agent',
      compartment: 'darknet-research',
      tool: 'search',
      transport: 'tor',
      maxRiskLevel: 'medium'
    }
  ]
};

const torRequest: CapabilityRequest = {
  agentId: 'research-agent',
  compartment: 'darknet-research',
  tool: 'search',
  riskLevel: 'low',
  input: { query: 'onion services' }
};

describe('YamlPolicyEngine transport enforcement', () => {
  it('resolves the policy transport when the agent omits one', () => {
    const engine = new YamlPolicyEngine(torPolicy);
    const result = engine.evaluate(torRequest);

    expect(result.allowed).toBe(true);
    expect(result.transport).toBe('tor');
  });

  it('allows when the asserted transport matches the policy', () => {
    const engine = new YamlPolicyEngine(torPolicy);
    const result = engine.evaluate({ ...torRequest, transport: 'tor' });

    expect(result.allowed).toBe(true);
    expect(result.transport).toBe('tor');
  });

  it('denies the wrong transport', () => {
    const engine = new YamlPolicyEngine(torPolicy);
    const result = engine.evaluate({ ...torRequest, transport: 'proxy' });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Transport not permitted');
  });

  it('denies unauthorized transport escalation to direct', () => {
    const engine = new YamlPolicyEngine(torPolicy);
    const result = engine.evaluate({ ...torRequest, transport: 'direct' });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Transport not permitted');
  });

  it('enforces the maxRiskLevel ceiling', () => {
    const engine = new YamlPolicyEngine(torPolicy);
    const allowed = engine.evaluate({ ...torRequest, riskLevel: 'medium' });
    const denied = engine.evaluate({ ...torRequest, riskLevel: 'high' });

    expect(allowed.allowed).toBe(true);
    expect(denied.allowed).toBe(false);
  });

  it('defaults a rule without a transport to direct', () => {
    const engine = new YamlPolicyEngine(allowSearchLowResearch);
    const result = engine.evaluate(baseRequest);

    expect(result.allowed).toBe(true);
    expect(result.transport).toBe('direct');
  });
});
