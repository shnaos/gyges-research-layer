/**
 * CapabilityGraphEngine — deterministic, in-memory execution-capability graph.
 *
 * The engine maintains a {@link CapabilityExecutionGraph} (nodes + edges), the
 * registered {@link CapabilityTransitionRule}s and {@link DependencyIsolationPolicy}s,
 * and, per compartment, the ordered list of capabilities currently forming its
 * execution path. From those it produces a {@link CapabilityPathDecision} for a
 * prospective capability.
 *
 * Determinism & safety:
 *   - identical inputs always yield identical decisions
 *   - the clock and id generator are injectable, so tests are fully reproducible
 *   - every returned node / edge / rule / policy is a defensive copy — a caller
 *     can never mutate engine state through a held reference
 *   - purely in-memory and side-effect free: NO network, NO persistence, NO
 *     AI/ML, NO semantic classification — only graph bookkeeping and bounded
 *     comparisons
 *   - never stores tokens, secrets, or raw request input
 */

import { randomUUID } from 'node:crypto';
import { CapabilityTool, RiskLevel } from '../index.js';
import {
  CapabilityEdge,
  CapabilityGraphFilter,
  CapabilityGraphRequestInput,
  CapabilityNode,
  CapabilityPathDecision,
  CapabilityPathEvaluationInput,
  CapabilityTransitionInput,
  CapabilityTransitionRule,
  DependencyIsolationPolicy,
  EXECUTION_PATH_RISK_RANK,
  RISK_LEVEL_RANK,
  pathRiskForRank
} from './types.js';

export interface CapabilityGraphEngineOptions {
  /** Injectable clock for deterministic timestamps. Defaults to {@link Date.now}. */
  now?: () => number;
  /** Injectable id generator for nodes / edges. Defaults to {@link randomUUID}. */
  generateId?: () => string;
}

/** One capability admitted onto a compartment's execution path. */
interface PathEntry {
  nodeId: string;
  tool: CapabilityTool;
  riskLevel: RiskLevel;
}

/** Deep-clone a {@link CapabilityNode}. */
function cloneNode(node: CapabilityNode): CapabilityNode {
  const clone: CapabilityNode = {
    id: node.id,
    kind: node.kind,
    createdAt: node.createdAt
  };
  if (node.agentId !== undefined) clone.agentId = node.agentId;
  if (node.compartmentId !== undefined) clone.compartmentId = node.compartmentId;
  if (node.tool !== undefined) clone.tool = node.tool;
  if (node.riskLevel !== undefined) clone.riskLevel = node.riskLevel;
  return clone;
}

/** Deep-clone a {@link CapabilityEdge}. */
function cloneEdge(edge: CapabilityEdge): CapabilityEdge {
  return {
    id: edge.id,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    relation: edge.relation,
    createdAt: edge.createdAt
  };
}

/** Deep-clone a {@link CapabilityTransitionRule}. */
function cloneRule(rule: CapabilityTransitionRule): CapabilityTransitionRule {
  return {
    id: rule.id,
    fromTool: rule.fromTool,
    toTool: rule.toTool,
    maxAllowedRisk: rule.maxAllowedRisk,
    actionOnViolation: rule.actionOnViolation,
    enabled: rule.enabled
  };
}

/** Deep-clone a {@link DependencyIsolationPolicy}. */
function clonePolicy(policy: DependencyIsolationPolicy): DependencyIsolationPolicy {
  return {
    id: policy.id,
    compartmentId: policy.compartmentId,
    maxPathLength: policy.maxPathLength,
    forbidCrossToolEscalation: policy.forbidCrossToolEscalation,
    requireApprovalOnToolChange: policy.requireApprovalOnToolChange,
    blockOnHighRiskPath: policy.blockOnHighRiskPath,
    enabled: policy.enabled
  };
}

export class CapabilityGraphEngine {
  /** Canonical nodes, keyed by id and kept in insertion order. */
  private readonly nodes = new Map<string, CapabilityNode>();
  /** Canonical edges, kept in insertion order. */
  private readonly edges = new Map<string, CapabilityEdge>();
  /** Registered transition rules, keyed by id (insertion order preserved). */
  private readonly transitionRules = new Map<string, CapabilityTransitionRule>();
  /** Registered isolation policies, keyed by id (insertion order preserved). */
  private readonly isolationPolicies = new Map<string, DependencyIsolationPolicy>();
  /** Fast lookup of the active policy for a compartment, by compartment id. */
  private readonly policyByCompartment = new Map<string, string>();
  /** Per-compartment ordered execution path of admitted capabilities. */
  private readonly paths = new Map<string, PathEntry[]>();

  private readonly now: () => number;
  private readonly generateId: () => string;

  constructor(options: CapabilityGraphEngineOptions = {}) {
    this.now = options.now ?? Date.now;
    this.generateId = options.generateId ?? randomUUID;
  }

  /** Add a fully-formed node to the graph. Returns a defensive copy. */
  addNode(node: CapabilityNode): CapabilityNode {
    if (this.nodes.has(node.id)) {
      throw new Error(`Duplicate capability node id: ${node.id}`);
    }
    const stored = cloneNode(node);
    this.nodes.set(stored.id, stored);
    return cloneNode(stored);
  }

  /**
   * Add a fully-formed edge to the graph. Both endpoints must already exist.
   * Returns a defensive copy.
   */
  addEdge(edge: CapabilityEdge): CapabilityEdge {
    if (this.edges.has(edge.id)) {
      throw new Error(`Duplicate capability edge id: ${edge.id}`);
    }
    if (!this.nodes.has(edge.fromNodeId)) {
      throw new Error(`Unknown edge source node: ${edge.fromNodeId}`);
    }
    if (!this.nodes.has(edge.toNodeId)) {
      throw new Error(`Unknown edge target node: ${edge.toNodeId}`);
    }
    const stored = cloneEdge(edge);
    this.edges.set(stored.id, stored);
    return cloneEdge(stored);
  }

  /**
   * Record an admitted capability: create a `capability` node, link it from the
   * compartment's previous path node with a `transitioned_to` edge, and advance
   * the compartment's execution path. Returns a defensive copy of the new node.
   *
   * This is the canonical way the executed path GROWS — call it only for a
   * capability that was allowed (or force-rotated) and actually ran.
   */
  recordCapabilityRequest(input: CapabilityGraphRequestInput): CapabilityNode {
    const at = input.createdAt ?? this.now();
    const node = this.createNode({
      kind: 'capability',
      agentId: input.agentId,
      compartmentId: input.compartmentId,
      tool: input.tool,
      riskLevel: input.riskLevel,
      createdAt: at
    });

    const path = this.paths.get(input.compartmentId) ?? [];
    const previous = path[path.length - 1];
    // The first capability on a path has no predecessor and therefore no edge.
    if (previous) {
      this.createEdge(previous.nodeId, node.id, 'transitioned_to', at);
    }

    path.push({ nodeId: node.id, tool: input.tool, riskLevel: input.riskLevel });
    this.paths.set(input.compartmentId, path);
    return cloneNode(node);
  }

  /**
   * Evaluate AND record a transition. The path is evaluated for `toTool`; when
   * the decision is not `block`/`require_approval` the transition is admitted
   * (node + `transitioned_to` edge, path advanced). A blocked / approval-bound
   * transition records only a minimal node and a `blocked` edge WITHOUT advancing
   * the path. Returns the decision with the related node / edge ids populated.
   */
  recordTransition(input: CapabilityTransitionInput): CapabilityPathDecision {
    const at = input.createdAt ?? this.now();
    const decision = this.evaluatePath({
      agentId: input.agentId,
      compartmentId: input.compartmentId,
      tool: input.toTool,
      riskLevel: input.riskLevel
    });

    const path = this.paths.get(input.compartmentId) ?? [];
    const previous = path[path.length - 1];

    if (decision.action === 'allow' || decision.action === 'force_rotation') {
      const node = this.createNode({
        kind: 'capability',
        agentId: input.agentId,
        compartmentId: input.compartmentId,
        tool: input.toTool,
        riskLevel: input.riskLevel,
        createdAt: at
      });
      const relatedEdgeIds: string[] = [];
      if (previous) {
        relatedEdgeIds.push(
          this.createEdge(previous.nodeId, node.id, 'transitioned_to', at).id
        );
      }
      path.push({
        nodeId: node.id,
        tool: input.toTool,
        riskLevel: input.riskLevel
      });
      this.paths.set(input.compartmentId, path);
      return {
        ...decision,
        relatedNodeIds: [node.id],
        relatedEdgeIds
      };
    }

    // block / require_approval: record a minimal node + edge, never advance the
    // executed path. The edge relation reflects the refusal.
    const node = this.createNode({
      kind: decision.action === 'require_approval' ? 'approval' : 'request',
      agentId: input.agentId,
      compartmentId: input.compartmentId,
      tool: input.toTool,
      riskLevel: input.riskLevel,
      createdAt: at
    });
    const relation = decision.action === 'require_approval' ? 'approved' : 'blocked';
    const relatedEdgeIds: string[] = [];
    if (previous) {
      relatedEdgeIds.push(
        this.createEdge(previous.nodeId, node.id, relation, at).id
      );
    }
    return {
      ...decision,
      relatedNodeIds: [node.id],
      relatedEdgeIds
    };
  }

  /**
   * Evaluate a prospective capability against the compartment's current path,
   * its transition rules, and its dependency-isolation policy. Read-only: it
   * NEVER mutates the graph or the path. Fail-closed: a missing or disabled
   * policy blocks.
   *
   * Decision precedence (most restrictive first):
   *   1. no / disabled policy                       → block (fail-closed)
   *   2. prospective path length > maxPathLength     → block
   *   3. first capability of the compartment         → allow (block if high &
   *      blockOnHighRiskPath)
   *   4. same tool                                   → allow (block if path risk
   *      high & blockOnHighRiskPath)
   *   5. tool change with no enabled transition rule → block
   *   6. high-risk path with blockOnHighRiskPath     → block
   *   7. request risk exceeds rule.maxAllowedRisk    → rule.actionOnViolation
   *   8. forbidden cross-tool escalation             → force_rotation
   *   9. requireApprovalOnToolChange                 → require_approval
   *  10. otherwise                                   → allow
   */
  evaluatePath(input: CapabilityPathEvaluationInput): CapabilityPathDecision {
    const policyId = this.policyByCompartment.get(input.compartmentId);
    const policy = policyId ? this.isolationPolicies.get(policyId) : undefined;
    if (!policy || !policy.enabled) {
      return blocked(
        'No applicable dependency isolation policy (fail-closed).'
      );
    }

    const path = this.paths.get(input.compartmentId) ?? [];
    const prospectiveLength = path.length + 1;
    const newRank = RISK_LEVEL_RANK[input.riskLevel];
    const pathRank = path.reduce(
      (max, entry) => Math.max(max, RISK_LEVEL_RANK[entry.riskLevel]),
      newRank
    );
    const pathRisk = pathRiskForRank(pathRank);

    // 2. hard path-length ceiling.
    if (prospectiveLength > policy.maxPathLength) {
      return blocked(
        `Execution path length ${prospectiveLength} exceeds max ${policy.maxPathLength}.`
      );
    }

    // 3. first capability of the compartment.
    if (path.length === 0) {
      if (policy.blockOnHighRiskPath && input.riskLevel === 'high') {
        return blocked('First capability is high risk; blocked by isolation policy.');
      }
      return {
        action: 'allow',
        risk: pathRisk,
        reason: 'First capability in compartment execution path.',
        relatedNodeIds: [],
        relatedEdgeIds: []
      };
    }

    const previous = path[path.length - 1];
    const sameTool = previous.tool === input.tool;

    // 4. same-tool continuation.
    if (sameTool) {
      if (policy.blockOnHighRiskPath && pathRisk === 'high') {
        return blocked('High-risk execution path blocked by isolation policy.');
      }
      return {
        action: 'allow',
        risk: pathRisk,
        reason: 'Same-tool continuation of the execution path.',
        relatedNodeIds: [],
        relatedEdgeIds: []
      };
    }

    // 5. a tool change requires an enabled transition rule.
    const rule = this.findEnabledRule(previous.tool, input.tool);
    if (!rule) {
      return blocked(
        `Tool transition ${previous.tool} -> ${input.tool} not permitted by any rule.`
      );
    }

    // 6. high-risk path block (most restrictive non-length check).
    if (policy.blockOnHighRiskPath && pathRisk === 'high') {
      return blocked('High-risk execution path blocked by isolation policy.');
    }

    // 7. request risk exceeds the rule's ceiling → rule-defined violation action.
    if (newRank > EXECUTION_PATH_RISK_RANK[rule.maxAllowedRisk]) {
      return {
        action: rule.actionOnViolation,
        risk: rule.actionOnViolation === 'block' ? 'blocked' : pathRisk,
        reason: `Transition ${previous.tool} -> ${input.tool} exceeds max allowed risk ${rule.maxAllowedRisk}.`,
        relatedNodeIds: [],
        relatedEdgeIds: []
      };
    }

    // 8. forbidden cross-tool escalation (tool change that also raises risk).
    const isEscalation = newRank > RISK_LEVEL_RANK[previous.riskLevel];
    if (policy.forbidCrossToolEscalation && isEscalation) {
      return {
        action: 'force_rotation',
        risk: pathRisk,
        reason: `Cross-tool escalation ${previous.tool} -> ${input.tool} requires forced rotation.`,
        relatedNodeIds: [],
        relatedEdgeIds: []
      };
    }

    // 9. any tool change is diverted to human approval when the policy demands it.
    if (policy.requireApprovalOnToolChange) {
      return {
        action: 'require_approval',
        risk: pathRisk,
        reason: `Tool change ${previous.tool} -> ${input.tool} requires human approval.`,
        relatedNodeIds: [],
        relatedEdgeIds: []
      };
    }

    // 10. otherwise the rule-authorised transition proceeds.
    return {
      action: 'allow',
      risk: pathRisk,
      reason: `Tool transition ${previous.tool} -> ${input.tool} permitted.`,
      relatedNodeIds: [],
      relatedEdgeIds: []
    };
  }

  /** List nodes in insertion order, optionally filtered. Returns deep copies. */
  listNodes(filter: CapabilityGraphFilter = {}): CapabilityNode[] {
    return [...this.nodes.values()]
      .filter(
        (node) =>
          (filter.agentId === undefined || node.agentId === filter.agentId) &&
          (filter.compartmentId === undefined ||
            node.compartmentId === filter.compartmentId) &&
          (filter.tool === undefined || node.tool === filter.tool)
      )
      .map(cloneNode);
  }

  /**
   * List edges in insertion order, optionally filtered by the agent /
   * compartment / tool of either endpoint. Returns deep copies.
   */
  listEdges(filter: CapabilityGraphFilter = {}): CapabilityEdge[] {
    const hasFilter =
      filter.agentId !== undefined ||
      filter.compartmentId !== undefined ||
      filter.tool !== undefined;
    return [...this.edges.values()]
      .filter((edge) => {
        if (!hasFilter) return true;
        const from = this.nodes.get(edge.fromNodeId);
        const to = this.nodes.get(edge.toNodeId);
        return [from, to].some(
          (node) =>
            node !== undefined &&
            (filter.agentId === undefined || node.agentId === filter.agentId) &&
            (filter.compartmentId === undefined ||
              node.compartmentId === filter.compartmentId) &&
            (filter.tool === undefined || node.tool === filter.tool)
        );
      })
      .map(cloneEdge);
  }

  /**
   * Register a transition rule. A duplicate id is rejected so rule sets stay
   * unambiguous and deterministic.
   */
  registerTransitionRule(rule: CapabilityTransitionRule): void {
    if (this.transitionRules.has(rule.id)) {
      throw new Error(`Duplicate transition rule id: ${rule.id}`);
    }
    this.transitionRules.set(rule.id, cloneRule(rule));
  }

  /**
   * Register an isolation policy. A duplicate policy id, or a second policy for a
   * compartment that already has one, is rejected so resolution stays
   * deterministic.
   */
  registerIsolationPolicy(policy: DependencyIsolationPolicy): void {
    if (this.isolationPolicies.has(policy.id)) {
      throw new Error(`Duplicate isolation policy id: ${policy.id}`);
    }
    if (this.policyByCompartment.has(policy.compartmentId)) {
      throw new Error(
        `Isolation policy already registered for compartment: ${policy.compartmentId}`
      );
    }
    this.isolationPolicies.set(policy.id, clonePolicy(policy));
    this.policyByCompartment.set(policy.compartmentId, policy.id);
  }

  /** List every registered transition rule. Returns deep copies. */
  listTransitionRules(): CapabilityTransitionRule[] {
    return [...this.transitionRules.values()].map(cloneRule);
  }

  /** List every registered isolation policy. Returns deep copies. */
  listIsolationPolicies(): DependencyIsolationPolicy[] {
    return [...this.isolationPolicies.values()].map(clonePolicy);
  }

  /** Drop every node, edge, path, rule, and policy. */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.transitionRules.clear();
    this.isolationPolicies.clear();
    this.policyByCompartment.clear();
    this.paths.clear();
  }

  /** Number of nodes currently in the graph. */
  size(): number {
    return this.nodes.size;
  }

  /** Find the first enabled transition rule matching `fromTool` → `toTool`. */
  private findEnabledRule(
    fromTool: CapabilityTool,
    toTool: CapabilityTool
  ): CapabilityTransitionRule | undefined {
    for (const rule of this.transitionRules.values()) {
      if (rule.enabled && rule.fromTool === fromTool && rule.toTool === toTool) {
        return rule;
      }
    }
    return undefined;
  }

  /** Create, store, and return a node with a generated id. */
  private createNode(input: Omit<CapabilityNode, 'id'>): CapabilityNode {
    const node: CapabilityNode = { id: this.generateId(), ...input };
    this.nodes.set(node.id, node);
    return node;
  }

  /** Create, store, and return an edge with a generated id. */
  private createEdge(
    fromNodeId: string,
    toNodeId: string,
    relation: CapabilityEdge['relation'],
    createdAt: number
  ): CapabilityEdge {
    const edge: CapabilityEdge = {
      id: this.generateId(),
      fromNodeId,
      toNodeId,
      relation,
      createdAt
    };
    this.edges.set(edge.id, edge);
    return edge;
  }
}

/** Build a terminal `block` decision with the canonical `blocked` path risk. */
function blocked(reason: string): CapabilityPathDecision {
  return {
    action: 'block',
    risk: 'blocked',
    reason,
    relatedNodeIds: [],
    relatedEdgeIds: []
  };
}
