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
