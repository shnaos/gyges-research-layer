/**
 * Compartment Correlation & Privacy Boundary Engine MVP — public surface.
 *
 * Sprint 9 contracts and the deterministic PrivacyBoundaryEngine. No real
 * network, browser, DNS, socket, persistence, or AI/semantic classification
 * behaviour is exposed here.
 */

export type {
  CorrelationRiskLevel,
  PrivacyBoundaryAction,
  CorrelationSignal,
  PrivacyBoundaryRule,
  PrivacyBoundaryDecision,
  BoundaryViolation,
  PrivacyBoundaryEvaluationInput,
  PrivacyBoundaryErrorKind
} from './types.js';

export { PrivacyBoundaryEngine, PrivacyBoundaryError } from './engine.js';

export {
  BOOTSTRAP_RESEARCH_SELF_RULE,
  BOOTSTRAP_PRIVACY_BOUNDARY_RULES
} from './bootstrap.js';
