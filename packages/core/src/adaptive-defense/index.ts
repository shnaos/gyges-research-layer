/**
 * Adaptive Defense & Capability Rate Limiting MVP — public surface.
 *
 * Sprint 13 contracts plus the deterministic, in-memory
 * {@link CapabilityRateLimiter} and {@link AdaptiveDefenseEngine}. No database,
 * file, network, fetch, DNS, socket, browser, durable persistence, cloud
 * telemetry, or AI/ML is exposed here.
 */

export type {
  RateLimitScope,
  DefenseAction,
  CooldownWindow,
  RateLimitPolicy,
  RateLimitDecision,
  TemporaryCapabilityBlock,
  DynamicRiskEscalation,
  AdaptiveDefensePolicy,
  RateLimitEvaluationInput,
  AdaptiveDefenseEvaluationInput,
  AdaptiveDefenseDecision
} from './types.js';

export { RISK_ORDER, escalateRisk } from './types.js';

export { CapabilityRateLimiter } from './rate-limiter.js';

export { AdaptiveDefenseEngine } from './defense-engine.js';

export {
  BOOTSTRAP_RATE_LIMIT_POLICIES,
  BOOTSTRAP_ADAPTIVE_DEFENSE_POLICIES
} from './bootstrap.js';
