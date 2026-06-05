/**
 * Execution Capability Graph & Dependency Isolation MVP — core primitives and
 * contracts.
 *
 * Sprint 15 introduces the first execution *graph* layer of GRL. Until now GRL
 * controlled each capability in isolation: a single request was rate-limited,
 * defended, firewalled, approved, privacy-checked, routed, sandboxed, and
 * executed on its own. It could not yet model the RELATIONS between capabilities
 * — it could not see that a `search` led to a `fetch_html` which led to a
 * `fetch_json`, could not reason about the risk of a whole execution *path*
 * rather than a single request, and could not isolate or block a dangerous
 * dependency chain (an escalation chain).
 *
 * This module adds a deterministic, in-memory {@link CapabilityExecutionGraph}
 * of {@link CapabilityNode}s connected by {@link CapabilityEdge}s, plus a
 * {@link CapabilityGraphEngine} that evaluates a prospective capability against
 * the compartment's existing path using {@link CapabilityTransitionRule}s and a
 * {@link DependencyIsolationPolicy}, producing a {@link CapabilityPathDecision}.
 *
 * Hard constraints (Sprint 15 MVP): everything here is deterministic, purely
 * local, and side-effect free. There is NO machine learning, NO AI, NO semantic
 * classification — only static graph bookkeeping and bounded comparisons. There
 * is NO database, NO Redis, NO file write, NO network, NO fetch / DNS / socket,
 * NO browser, NO durable persistence, and NO cloud telemetry.
 *
 * Privacy: nodes, edges, rules and policies carry only minimal, secret-free
 * metadata (ids, kinds, relations, tool names, risk levels, compartment / agent
 * ids, timestamps). They must NEVER contain an approval token, secret,
 * credential, raw HTTP header, raw environment, raw stack trace, or raw request
 * input.
 */

import { CapabilityTool, RiskLevel } from '../index.js';

/**
 * The kind of an execution-graph node. A node is one observed point in the
 * capability lifecycle, never a free-form string.
 *
 * - `request`          — an inbound capability request
 * - `capability`       — a capability admitted onto the execution path
 * - `approval`         — a human-in-the-loop approval point
 * - `execution`        — an actual (mock) execution
 * - `sandbox`          — an adapter sandbox checkpoint
 * - `privacy_boundary` — a privacy / anti-correlation checkpoint
 */
export type CapabilityNodeKind =
  | 'request'
  | 'capability'
  | 'approval'
  | 'execution'
  | 'sandbox'
  | 'privacy_boundary';

/**
 * Coarse, ordered risk classification of a whole execution *path* (not a single
 * request). `blocked` is a terminal classification meaning the path itself is
 * refused — it is never a "passing" risk band.
 */
export type ExecutionPathRisk = 'low' | 'medium' | 'high' | 'blocked';

/**
 * The action a {@link CapabilityPathDecision} carries.
 *
 * - `allow`            — the path may proceed normally
 * - `require_approval` — the path is diverted to human approval; no execution
 * - `force_rotation`   — the path may proceed but a session rotation is forced
 * - `block`            — the path is refused; no session, no execution
 */
export type CapabilityPathAction =
  | 'allow'
  | 'require_approval'
  | 'force_rotation'
  | 'block';

/**
 * The relation an edge expresses between two nodes. Closed vocabulary — new
 * relations are added by extending this union, never by inventing strings.
 */
export type CapabilityEdgeRelation =
  | 'requested'
  | 'approved'
  | 'executed'
  | 'blocked'
  | 'depends_on'
  | 'transitioned_to';

/**
 * A single node in the {@link CapabilityExecutionGraph}.
 *
 * `id` and `createdAt` are assigned by the {@link CapabilityGraphEngine} when a
 * node is recorded (or supplied for a fully-formed {@link CapabilityNode} passed
 * to {@link CapabilityGraphEngine.addNode}). Optional correlation fields tie the
 * node to an agent / compartment / tool without ever requiring secrets.
 */
export interface CapabilityNode {
  id: string;
  kind: CapabilityNodeKind;
  agentId?: string;
  compartmentId?: string;
  tool?: CapabilityTool;
  riskLevel?: RiskLevel;
  createdAt: number;
}

/** A single directed edge between two {@link CapabilityNode}s. */
export interface CapabilityEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relation: CapabilityEdgeRelation;
  createdAt: number;
}

/**
 * A rule authorising a transition from one tool to another.
 *
 * A tool change is only permitted when an *enabled* rule whose `fromTool` /
 * `toTool` match exists. When the prospective request's risk exceeds
 * `maxAllowedRisk`, `actionOnViolation` is applied instead of `allow`.
 */
export interface CapabilityTransitionRule {
  id: string;
  fromTool: CapabilityTool;
  toTool: CapabilityTool;
  maxAllowedRisk: ExecutionPathRisk;
  actionOnViolation: CapabilityPathAction;
  enabled: boolean;
}

/**
 * The dependency-isolation policy governing one compartment's execution paths.
 *
 * - `maxPathLength`              — hard ceiling on the number of capabilities a
 *   single path may chain; exceeding it blocks the path
 * - `forbidCrossToolEscalation` — when true, a tool change that also raises the
 *   risk level is treated as an escalation chain (force rotation, or block on a
 *   high-risk path)
 * - `requireApprovalOnToolChange` — when true, any tool change is diverted to
 *   human approval
 * - `blockOnHighRiskPath`       — when true, a path whose aggregate risk is high
 *   is blocked outright
 */
export interface DependencyIsolationPolicy {
  id: string;
  compartmentId: string;
  maxPathLength: number;
  forbidCrossToolEscalation: boolean;
  requireApprovalOnToolChange: boolean;
  blockOnHighRiskPath: boolean;
  enabled: boolean;
}

/**
 * The decision produced by {@link CapabilityGraphEngine.evaluatePath} and
 * {@link CapabilityGraphEngine.recordTransition}.
 *
 * It carries only normalised metadata — never a token, secret, or raw input.
 * `relatedNodeIds` / `relatedEdgeIds` point at the graph elements the decision
 * concerns (empty for a pure read-only evaluation).
 */
export interface CapabilityPathDecision {
  action: CapabilityPathAction;
  risk: ExecutionPathRisk;
  reason: string;
  relatedNodeIds: string[];
  relatedEdgeIds: string[];
}

/** Input accepted by {@link CapabilityGraphEngine.recordCapabilityRequest}. */
export interface CapabilityGraphRequestInput {
  agentId: string;
  compartmentId: string;
  tool: CapabilityTool;
  riskLevel: RiskLevel;
  /** Optional deterministic timestamp; the engine's clock is used otherwise. */
  createdAt?: number;
}

/** Input accepted by {@link CapabilityGraphEngine.recordTransition}. */
export interface CapabilityTransitionInput {
  agentId: string;
  compartmentId: string;
  /** Previous tool on the path; omitted for the first capability. */
  fromTool?: CapabilityTool;
  toTool: CapabilityTool;
  riskLevel: RiskLevel;
  /** Optional deterministic timestamp; the engine's clock is used otherwise. */
  createdAt?: number;
}

/** Input accepted by {@link CapabilityGraphEngine.evaluatePath}. */
export interface CapabilityPathEvaluationInput {
  agentId: string;
  compartmentId: string;
  tool: CapabilityTool;
  riskLevel: RiskLevel;
}

/** Optional filter for {@link CapabilityGraphEngine.listNodes} / `listEdges`. */
export interface CapabilityGraphFilter {
  agentId?: string;
  compartmentId?: string;
  tool?: CapabilityTool;
}

/**
 * Numeric rank of a {@link RiskLevel}, used for bounded comparisons. Higher is
 * riskier. This is the single source of truth for risk ordering in the graph.
 */
export const RISK_LEVEL_RANK: Readonly<Record<RiskLevel, number>> = {
  low: 1,
  medium: 2,
  high: 3
};

/**
 * Numeric rank of an {@link ExecutionPathRisk}, used when comparing a request's
 * risk against a transition rule's `maxAllowedRisk`. `blocked` ranks highest.
 */
export const EXECUTION_PATH_RISK_RANK: Readonly<
  Record<ExecutionPathRisk, number>
> = {
  low: 1,
  medium: 2,
  high: 3,
  blocked: 4
};

/** Map a numeric risk rank (1..3) back to its {@link ExecutionPathRisk} band. */
export function pathRiskForRank(rank: number): ExecutionPathRisk {
  if (rank >= RISK_LEVEL_RANK.high) return 'high';
  if (rank >= RISK_LEVEL_RANK.medium) return 'medium';
  return 'low';
}

/** Project a single-request {@link RiskLevel} into its {@link ExecutionPathRisk}. */
export function pathRiskForLevel(level: RiskLevel): ExecutionPathRisk {
  return pathRiskForRank(RISK_LEVEL_RANK[level]);
}
