import { beforeEach, describe, expect, it } from 'vitest';
import {
  CapabilityEdge,
  CapabilityGraphEngine,
  CapabilityNode,
  CapabilityTransitionRule,
  DependencyIsolationPolicy,
  pathRiskForLevel
} from '../src/index.js';

/**
 * Build a deterministic engine: a fixed clock and a monotonic id generator so
 * every test is fully reproducible (deterministic ids/timestamps).
 */
function deterministicEngine(): CapabilityGraphEngine {
  let seq = 0;
  return new CapabilityGraphEngine({
    now: () => 1000,
    generateId: () => `cg-${++seq}`
  });
}

/** The bootstrap research isolation policy used by most tests. */
function researchPolicy(
  overrides: Partial<DependencyIsolationPolicy> = {}
): DependencyIsolationPolicy {
  return {
    id: 'research-default-dependency-isolation',
    compartmentId: 'research',
    maxPathLength: 5,
    forbidCrossToolEscalation: true,
    requireApprovalOnToolChange: true,
    blockOnHighRiskPath: true,
    enabled: true,
    ...overrides
  };
}

const SEARCH_TO_FETCH_HTML: CapabilityTransitionRule = {
  id: 'search-to-fetch-html',
  fromTool: 'search',
  toTool: 'fetch_html',
  maxAllowedRisk: 'medium',
  actionOnViolation: 'require_approval',
  enabled: true
};

const FETCH_HTML_TO_FETCH_JSON: CapabilityTransitionRule = {
  id: 'fetch-html-to-fetch-json',
  fromTool: 'fetch_html',
  toTool: 'fetch_json',
  maxAllowedRisk: 'medium',
  actionOnViolation: 'require_approval',
  enabled: true
};

describe('path risk helpers', () => {
  it('projects risk levels into path risk bands', () => {
    expect(pathRiskForLevel('low')).toBe('low');
    expect(pathRiskForLevel('medium')).toBe('medium');
    expect(pathRiskForLevel('high')).toBe('high');
  });
});

describe('CapabilityGraphEngine — nodes & edges', () => {
  let engine: CapabilityGraphEngine;
  beforeEach(() => {
    engine = deterministicEngine();
  });

  it('adds a node and returns a defensive copy', () => {
    const node: CapabilityNode = {
      id: 'n1',
      kind: 'capability',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low',
      createdAt: 10
    };
    const added = engine.addNode(node);
    expect(added).toEqual(node);
    expect(added).not.toBe(node);
    // Mutating the returned copy must not affect engine state.
    added.tool = 'fetch_html';
    expect(engine.listNodes()[0].tool).toBe('search');
  });

  it('rejects a duplicate node id', () => {
    const node: CapabilityNode = { id: 'n1', kind: 'request', createdAt: 1 };
    engine.addNode(node);
    expect(() => engine.addNode(node)).toThrow(/Duplicate capability node id/);
  });

  it('adds an edge between existing nodes', () => {
    engine.addNode({ id: 'n1', kind: 'capability', createdAt: 1 });
    engine.addNode({ id: 'n2', kind: 'capability', createdAt: 2 });
    const edge: CapabilityEdge = {
      id: 'e1',
      fromNodeId: 'n1',
      toNodeId: 'n2',
      relation: 'transitioned_to',
      createdAt: 3
    };
    const added = engine.addEdge(edge);
    expect(added).toEqual(edge);
    expect(added).not.toBe(edge);
  });

  it('rejects an edge with an unknown endpoint', () => {
    engine.addNode({ id: 'n1', kind: 'capability', createdAt: 1 });
    expect(() =>
      engine.addEdge({
        id: 'e1',
        fromNodeId: 'n1',
        toNodeId: 'missing',
        relation: 'transitioned_to',
        createdAt: 2
      })
    ).toThrow(/Unknown edge target node/);
  });

  it('returns defensive copies from listNodes', () => {
    engine.addNode({
      id: 'n1',
      kind: 'capability',
      tool: 'search',
      createdAt: 1
    });
    const first = engine.listNodes();
    first[0].tool = 'fetch_json';
    expect(engine.listNodes()[0].tool).toBe('search');
  });

  it('returns defensive copies from listEdges', () => {
    engine.addNode({ id: 'n1', kind: 'capability', createdAt: 1 });
    engine.addNode({ id: 'n2', kind: 'capability', createdAt: 2 });
    engine.addEdge({
      id: 'e1',
      fromNodeId: 'n1',
      toNodeId: 'n2',
      relation: 'transitioned_to',
      createdAt: 3
    });
    const first = engine.listEdges();
    first[0].relation = 'blocked';
    expect(engine.listEdges()[0].relation).toBe('transitioned_to');
  });

  it('filters nodes by agent, compartment, and tool', () => {
    engine.addNode({
      id: 'n1',
      kind: 'capability',
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      createdAt: 1
    });
    engine.addNode({
      id: 'n2',
      kind: 'capability',
      agentId: 'a2',
      compartmentId: 'other',
      tool: 'fetch_html',
      createdAt: 2
    });
    expect(engine.listNodes({ agentId: 'a1' }).map((n) => n.id)).toEqual(['n1']);
    expect(
      engine.listNodes({ compartmentId: 'other' }).map((n) => n.id)
    ).toEqual(['n2']);
    expect(engine.listNodes({ tool: 'fetch_html' }).map((n) => n.id)).toEqual([
      'n2'
    ]);
  });
});

describe('CapabilityGraphEngine — evaluatePath rules', () => {
  let engine: CapabilityGraphEngine;
  beforeEach(() => {
    engine = deterministicEngine();
    engine.registerTransitionRule(SEARCH_TO_FETCH_HTML);
    engine.registerTransitionRule(FETCH_HTML_TO_FETCH_JSON);
    engine.registerIsolationPolicy(researchPolicy());
  });

  it('allows the first capability of a compartment', () => {
    const decision = engine.evaluatePath({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low'
    });
    expect(decision.action).toBe('allow');
    expect(decision.risk).toBe('low');
  });

  it('allows a same-tool low-risk continuation', () => {
    engine.recordCapabilityRequest({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low'
    });
    const decision = engine.evaluatePath({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low'
    });
    expect(decision.action).toBe('allow');
  });

  it('requires approval on a permitted low-risk tool change', () => {
    engine.recordCapabilityRequest({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low'
    });
    const decision = engine.evaluatePath({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'fetch_html',
      riskLevel: 'low'
    });
    expect(decision.action).toBe('require_approval');
  });

  it('blocks a transition not permitted by any rule', () => {
    engine.recordCapabilityRequest({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low'
    });
    const decision = engine.evaluatePath({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'fetch_json',
      riskLevel: 'low'
    });
    expect(decision.action).toBe('block');
    expect(decision.risk).toBe('blocked');
  });

  it('blocks a path that exceeds maxPathLength', () => {
    engine.clear();
    engine.registerTransitionRule(SEARCH_TO_FETCH_HTML);
    engine.registerIsolationPolicy(researchPolicy({ maxPathLength: 2 }));
    engine.recordCapabilityRequest({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low'
    });
    engine.recordCapabilityRequest({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low'
    });
    const decision = engine.evaluatePath({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low'
    });
    expect(decision.action).toBe('block');
  });

  it('blocks a high-risk path when blockOnHighRiskPath is true', () => {
    engine.recordCapabilityRequest({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low'
    });
    const decision = engine.evaluatePath({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'high'
    });
    expect(decision.action).toBe('block');
  });

  it('forces rotation on a forbidden cross-tool escalation', () => {
    engine.recordCapabilityRequest({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low'
    });
    const decision = engine.evaluatePath({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'fetch_html',
      riskLevel: 'medium'
    });
    expect(decision.action).toBe('force_rotation');
  });

  it('blocks a cross-tool escalation to high risk (force/block by policy)', () => {
    engine.recordCapabilityRequest({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low'
    });
    const decision = engine.evaluatePath({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'fetch_html',
      riskLevel: 'high'
    });
    // blockOnHighRiskPath wins over the escalation rotation: a high-risk path
    // is refused outright.
    expect(decision.action).toBe('block');
  });

  it('applies a rule violation action when risk exceeds the rule ceiling', () => {
    engine.clear();
    engine.registerTransitionRule(SEARCH_TO_FETCH_HTML);
    engine.registerIsolationPolicy(
      researchPolicy({
        blockOnHighRiskPath: false,
        forbidCrossToolEscalation: false,
        requireApprovalOnToolChange: false
      })
    );
    engine.recordCapabilityRequest({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'high'
    });
    const decision = engine.evaluatePath({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'fetch_html',
      riskLevel: 'high'
    });
    // high > maxAllowedRisk(medium) → actionOnViolation = require_approval.
    expect(decision.action).toBe('require_approval');
  });

  it('fails closed when no policy applies to the compartment', () => {
    const decision = engine.evaluatePath({
      agentId: 'a1',
      compartmentId: 'unknown-compartment',
      tool: 'search',
      riskLevel: 'low'
    });
    expect(decision.action).toBe('block');
    expect(decision.risk).toBe('blocked');
  });

  it('ignores a disabled transition rule (treated as no rule → block)', () => {
    engine.clear();
    engine.registerTransitionRule({
      ...SEARCH_TO_FETCH_HTML,
      enabled: false
    });
    engine.registerIsolationPolicy(researchPolicy());
    engine.recordCapabilityRequest({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low'
    });
    const decision = engine.evaluatePath({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'fetch_html',
      riskLevel: 'low'
    });
    expect(decision.action).toBe('block');
  });

  it('does not mutate the graph during evaluatePath', () => {
    engine.recordCapabilityRequest({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low'
    });
    const nodesBefore = engine.listNodes().length;
    const edgesBefore = engine.listEdges().length;
    engine.evaluatePath({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'fetch_html',
      riskLevel: 'low'
    });
    expect(engine.listNodes().length).toBe(nodesBefore);
    expect(engine.listEdges().length).toBe(edgesBefore);
  });
});

describe('CapabilityGraphEngine — registration & recording', () => {
  let engine: CapabilityGraphEngine;
  beforeEach(() => {
    engine = deterministicEngine();
    engine.registerTransitionRule(SEARCH_TO_FETCH_HTML);
    engine.registerIsolationPolicy(researchPolicy());
  });

  it('rejects a duplicate transition rule id', () => {
    expect(() => engine.registerTransitionRule(SEARCH_TO_FETCH_HTML)).toThrow(
      /Duplicate transition rule id/
    );
  });

  it('rejects a duplicate isolation policy id', () => {
    expect(() => engine.registerIsolationPolicy(researchPolicy())).toThrow(
      /Duplicate isolation policy id|already registered/
    );
  });

  it('rejects a second policy for the same compartment', () => {
    expect(() =>
      engine.registerIsolationPolicy(
        researchPolicy({ id: 'another-policy' })
      )
    ).toThrow(/already registered/);
  });

  it('lists registered rules and policies as defensive copies', () => {
    const rules = engine.listTransitionRules();
    rules[0].enabled = false;
    expect(engine.listTransitionRules()[0].enabled).toBe(true);
    const policies = engine.listIsolationPolicies();
    policies[0].maxPathLength = 99;
    expect(engine.listIsolationPolicies()[0].maxPathLength).toBe(5);
  });

  it('records a capability request as a node and grows the path', () => {
    const node = engine.recordCapabilityRequest({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low'
    });
    expect(node.kind).toBe('capability');
    expect(node.tool).toBe('search');
    expect(engine.listNodes().map((n) => n.id)).toContain(node.id);
  });

  it('records a transition with a transitioned_to edge when allowed', () => {
    engine.recordCapabilityRequest({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low'
    });
    const decision = engine.recordTransition({
      agentId: 'a1',
      compartmentId: 'research',
      fromTool: 'search',
      toTool: 'search',
      riskLevel: 'low'
    });
    expect(decision.action).toBe('allow');
    expect(decision.relatedNodeIds.length).toBe(1);
    expect(decision.relatedEdgeIds.length).toBe(1);
    const edge = engine
      .listEdges()
      .find((e) => e.id === decision.relatedEdgeIds[0]);
    expect(edge?.relation).toBe('transitioned_to');
  });

  it('records a blocked transition without advancing the path', () => {
    engine.recordCapabilityRequest({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low'
    });
    const decision = engine.recordTransition({
      agentId: 'a1',
      compartmentId: 'research',
      fromTool: 'search',
      toTool: 'fetch_json',
      riskLevel: 'low'
    });
    expect(decision.action).toBe('block');
    const edge = engine
      .listEdges()
      .find((e) => e.id === decision.relatedEdgeIds[0]);
    expect(edge?.relation).toBe('blocked');
    // A subsequent same-tool evaluation still sees `search` as the last
    // admitted tool, proving the blocked transition did not advance the path.
    const next = engine.evaluatePath({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low'
    });
    expect(next.action).toBe('allow');
  });

  it('produces deterministic ids and timestamps', () => {
    const node = engine.recordCapabilityRequest({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low'
    });
    expect(node.id).toBe('cg-1');
    expect(node.createdAt).toBe(1000);
  });

  it('clears all graph state', () => {
    engine.recordCapabilityRequest({
      agentId: 'a1',
      compartmentId: 'research',
      tool: 'search',
      riskLevel: 'low'
    });
    engine.clear();
    expect(engine.listNodes()).toEqual([]);
    expect(engine.listEdges()).toEqual([]);
    expect(engine.listTransitionRules()).toEqual([]);
    expect(engine.listIsolationPolicies()).toEqual([]);
  });
});
