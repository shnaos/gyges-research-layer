import { describe, expect, it } from 'vitest';
import { CapabilityRequest } from '../../core/src/index.js';
import { YamlPolicyEngine } from '../src/index.js';

const baseRequest: CapabilityRequest = {
  agentId: 'local-agent',
  compartment: 'research-public',
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

  it('allows explicitly declared combinations', () => {
    const engine = new YamlPolicyEngine({
      defaultDeny: true,
      rules: [
        {
          effect: 'allow',
          agentId: 'local-agent',
          compartment: 'research-public',
          tool: 'search',
          riskLevel: 'low',
          requiresConfirmation: false
        }
      ]
    });

    const result = engine.evaluate(baseRequest);

    expect(result.allowed).toBe(true);
    expect(result.reason).toContain('Allowed by explicit');
  });
});
