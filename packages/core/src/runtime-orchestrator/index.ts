/**
 * Agent Runtime Policy Orchestrator & Composite Privacy Policies — public API.
 *
 * Sprint 28: central orchestration layer for composing, normalising, and
 * conflict-resolving runtime privacy/security decisions from all GRL gates.
 */

export type {
  PolicySignalSource,
  UnifiedPrivacyAction,
  PolicySignalSeverity,
  PolicySignal,
  PolicyConflict,
  CompositePrivacyPolicy,
  CompositeRuntimeDecision
} from './types.js';

export { RuntimePolicyOrchestrator, DEFAULT_MAX_SIGNALS } from './orchestrator.js';
export type {
  RuntimePolicyOrchestratorOptions,
  RecordSignalsResult
} from './orchestrator.js';
export { PolicySignalCollector, DEFAULT_MAX_COLLECTED_SIGNALS } from './collector.js';
export type { CollectorEvaluation, PolicySignalCollectorOptions } from './collector.js';
export { DEFAULT_COMPOSITE_PRIVACY_POLICY } from './policies.js';
export { createSignal } from './signals.js';
export type { CreateSignalInput } from './signals.js';
export { ACTION_PRECEDENCE, ROTATION_ACTIONS, precedenceOf, moreRestrictive } from './precedence.js';
export { detectConflicts } from './conflicts.js';
