/**
 * Execution Capability Graph & Dependency Isolation MVP — public surface.
 *
 * Sprint 15 contracts plus the deterministic, in-memory
 * {@link CapabilityGraphEngine}. No database, file, network, fetch, DNS, socket,
 * browser, durable persistence, cloud telemetry, or AI/ML is exposed here.
 */

export type {
  CapabilityNodeKind,
  ExecutionPathRisk,
  CapabilityPathAction,
  CapabilityEdgeRelation,
  CapabilityNode,
  CapabilityEdge,
  CapabilityTransitionRule,
  DependencyIsolationPolicy,
  CapabilityPathDecision,
  CapabilityGraphRequestInput,
  CapabilityTransitionInput,
  CapabilityPathEvaluationInput,
  CapabilityGraphFilter
} from './types.js';

export {
  RISK_LEVEL_RANK,
  EXECUTION_PATH_RISK_RANK,
  pathRiskForRank,
  pathRiskForLevel
} from './types.js';

export { CapabilityGraphEngine } from './engine.js';
export type { CapabilityGraphEngineOptions } from './engine.js';

export {
  BOOTSTRAP_CAPABILITY_TRANSITION_RULES,
  BOOTSTRAP_DEPENDENCY_ISOLATION_POLICY
} from './bootstrap.js';
