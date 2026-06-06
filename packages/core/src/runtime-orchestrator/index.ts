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

export { RuntimePolicyOrchestrator } from './orchestrator.js';
export { DEFAULT_COMPOSITE_PRIVACY_POLICY } from './policies.js';
export { createSignal } from './signals.js';
export type { CreateSignalInput } from './signals.js';
export { ACTION_PRECEDENCE, ROTATION_ACTIONS, precedenceOf, moreRestrictive } from './precedence.js';
export { detectConflicts } from './conflicts.js';
