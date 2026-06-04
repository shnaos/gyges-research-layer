import { describe, expect, it } from 'vitest';
import {
  CapabilityFirewall,
  CapabilityPolicy,
  CapabilityRequest,
  PolicyCollisionError,
  PolicyEngine,
  PolicyStore
} from '../src/firewall.js';

const basePolicy: CapabilityPolicy = {
  agentId: 'local-agent',
  compartmentId: 'research',
  allowedTools: ['search', 'fetch_html'],
  maxRiskLevel: 'medium',
  requiresConfirmationAbove: 'low'
};

const baseRequest: CapabilityRequest = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'search',
  riskLevel: 'low',
  input: { query: 'gyges research layer' }
};

function buildFirewall(policies: CapabilityPolicy[] = [basePolicy]): CapabilityFirewall {
  const store = new PolicyStore(policies);
  return new CapabilityFirewall(new PolicyEngine(store));
}

describe('CapabilityFirewall — deny by default', () => {
  it('denies when the policy store is empty', () => {
    const firewall = buildFirewall([]);
    const decision = firewall.evaluate(baseRequest);

    expect(decision.allowed).toBe(false);
    expect(decision.requiresConfirmation).toBe(false);
    expect(decision.reason).toContain('no matching policy');
  });

  it('denies an unknown agent', () => {
    const firewall = buildFirewall();
    const decision = firewall.evaluate({ ...baseRequest, agentId: 'ghost-agent' });

    expect(decision.allowed).toBe(false);
  });

  it('denies an unknown compartment', () => {
    const firewall = buildFirewall();
    const decision = firewall.evaluate({ ...baseRequest, compartmentId: 'personal' });

    expect(decision.allowed).toBe(false);
  });

  it('denies a tool that is not in the policy allow-list', () => {
    const firewall = buildFirewall();
    const decision = firewall.evaluate({ ...baseRequest, tool: 'fetch_json' });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('tool not permitted');
  });

  it('denies an unknown / malformed tool value', () => {
    const firewall = buildFirewall();
    const decision = firewall.evaluate({
      ...baseRequest,
      // Simulate an out-of-contract tool reaching the firewall.
      tool: 'exec' as CapabilityRequest['tool']
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('Unknown tool');
  });
});

describe('CapabilityFirewall — allow path', () => {
  it('allows an exact match and returns sanitized input', () => {
    const firewall = buildFirewall();
    const decision = firewall.evaluate(baseRequest);

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toContain('Allowed by policy');
    expect(decision.sanitizedInput).toEqual({ query: 'gyges research layer' });
  });

  it('allows the newly supported fetch_json tool when permitted', () => {
    const firewall = buildFirewall([
      { ...basePolicy, allowedTools: ['fetch_json'] }
    ]);
    const decision = firewall.evaluate({ ...baseRequest, tool: 'fetch_json' });

    expect(decision.allowed).toBe(true);
  });
});

describe('CapabilityFirewall — risk handling', () => {
  it('denies when the risk level exceeds the policy maximum', () => {
    const firewall = buildFirewall();
    const decision = firewall.evaluate({ ...baseRequest, riskLevel: 'high' });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('exceeds policy maximum');
  });

  it('allows at the exact risk ceiling', () => {
    const firewall = buildFirewall();
    const decision = firewall.evaluate({ ...baseRequest, riskLevel: 'medium' });

    expect(decision.allowed).toBe(true);
  });

  it('flags confirmation when risk is above the confirmation threshold', () => {
    const firewall = buildFirewall();
    const low = firewall.evaluate({ ...baseRequest, riskLevel: 'low' });
    const medium = firewall.evaluate({ ...baseRequest, riskLevel: 'medium' });

    expect(low.requiresConfirmation).toBe(false);
    expect(medium.allowed).toBe(true);
    expect(medium.requiresConfirmation).toBe(true);
  });

  it('never flags confirmation when the policy omits a threshold', () => {
    const firewall = buildFirewall([
      { ...basePolicy, requiresConfirmationAbove: undefined }
    ]);
    const decision = firewall.evaluate({ ...baseRequest, riskLevel: 'medium' });

    expect(decision.allowed).toBe(true);
    expect(decision.requiresConfirmation).toBe(false);
  });
});

describe('CapabilityFirewall — malformed input', () => {
  it('denies a missing agentId', () => {
    const firewall = buildFirewall();
    const decision = firewall.evaluate({
      ...baseRequest,
      agentId: '   '
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('agentId');
  });

  it('denies a missing compartmentId', () => {
    const firewall = buildFirewall();
    const decision = firewall.evaluate({
      ...baseRequest,
      compartmentId: ''
    });

    expect(decision.allowed).toBe(false);
  });

  it('denies an invalid riskLevel', () => {
    const firewall = buildFirewall();
    const decision = firewall.evaluate({
      ...baseRequest,
      riskLevel: 'critical' as CapabilityRequest['riskLevel']
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('riskLevel');
  });

  it('denies undefined input', () => {
    const firewall = buildFirewall();
    const decision = firewall.evaluate({ ...baseRequest, input: undefined });

    expect(decision.allowed).toBe(false);
  });
});

describe('CapabilityFirewall — sanitizer', () => {
  it('trims and strips dangerous control characters from string input', () => {
    const firewall = buildFirewall();
    const decision = firewall.evaluate({
      ...baseRequest,
      input: '  hel\u0000lo\u0007 world  '
    });

    expect(decision.allowed).toBe(true);
    expect(decision.sanitizedInput).toBe('hello world');
  });

  it('preserves common whitespace inside strings', () => {
    const firewall = buildFirewall();
    const decision = firewall.evaluate({
      ...baseRequest,
      input: 'line1\nline2\tend'
    });

    expect(decision.allowed).toBe(true);
    expect(decision.sanitizedInput).toBe('line1\nline2\tend');
  });

  it('denies an oversized string payload', () => {
    const store = new PolicyStore([basePolicy]);
    const engine = new PolicyEngine(store, {
      sanitizer: { maxStringLength: 8, maxPayloadBytes: 1024 }
    });
    const firewall = new CapabilityFirewall(engine);
    const decision = firewall.evaluate({
      ...baseRequest,
      input: 'this string is definitely too long'
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('maximum');
  });

  it('denies a payload that exceeds the maximum byte size', () => {
    const store = new PolicyStore([basePolicy]);
    const engine = new PolicyEngine(store, {
      sanitizer: { maxStringLength: 1_000_000, maxPayloadBytes: 16 }
    });
    const firewall = new CapabilityFirewall(engine);
    const decision = firewall.evaluate({
      ...baseRequest,
      input: { query: 'an input object that serializes beyond sixteen bytes' }
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('Payload exceeds');
  });
});

describe('PolicyStore', () => {
  it('throws on policy collision for the same agent + compartment', () => {
    const store = new PolicyStore([basePolicy]);

    expect(() => store.add({ ...basePolicy, maxRiskLevel: 'high' })).toThrow(
      PolicyCollisionError
    );
  });

  it('keeps distinct policies for distinct compartments', () => {
    const store = new PolicyStore([
      basePolicy,
      { ...basePolicy, compartmentId: 'other' }
    ]);

    expect(store.size).toBe(2);
    expect(store.get('local-agent', 'research')).toBeDefined();
    expect(store.get('local-agent', 'other')).toBeDefined();
  });

  it('allows explicit replacement via set without collision', () => {
    const store = new PolicyStore([basePolicy]);
    store.set({ ...basePolicy, maxRiskLevel: 'high' });

    expect(store.size).toBe(1);
    expect(store.get('local-agent', 'research')?.maxRiskLevel).toBe('high');
  });
});

describe('CapabilityFirewall — determinism', () => {
  it('returns identical decisions for identical requests', () => {
    const firewall = buildFirewall();
    const first = firewall.evaluate(baseRequest);
    const second = firewall.evaluate(baseRequest);

    expect(first).toEqual(second);
  });

  it('does not mutate the incoming request', () => {
    const firewall = buildFirewall();
    const request: CapabilityRequest = {
      ...baseRequest,
      input: '  spaced  '
    };
    const snapshot = JSON.stringify(request);
    firewall.evaluate(request);

    expect(JSON.stringify(request)).toBe(snapshot);
  });
});
