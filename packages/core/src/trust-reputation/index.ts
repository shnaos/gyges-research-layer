/**
 * Compartment Trust Scoring & Reputation Engine MVP — public surface.
 *
 * Sprint 14 contracts plus the deterministic, in-memory
 * {@link CompartmentTrustEngine}. No database, file, network, fetch, DNS,
 * socket, browser, durable persistence, cloud telemetry, or AI/ML is exposed
 * here.
 */

export type {
  TrustLevel,
  ReputationEventType,
  TrustScore,
  ReputationEvent,
  ReputationProfile,
  TrustAdjustment,
  ReputationDecayPolicy,
  TrustRecoveryPolicy,
  IncidentWeightedScoringPolicy,
  ReputationEventInput
} from './types.js';

export {
  MIN_TRUST_SCORE,
  MAX_TRUST_SCORE,
  INITIAL_TRUST_SCORE,
  TRUST_LEVEL_THRESHOLDS,
  STATIC_REPUTATION_DELTAS,
  clampScore,
  levelForScore,
  makeTrustScore
} from './types.js';

export { CompartmentTrustEngine } from './engine.js';
export type { CompartmentTrustEngineOptions } from './engine.js';

export {
  DEFAULT_REPUTATION_DECAY_POLICY,
  DEFAULT_TRUST_RECOVERY_POLICY,
  DEFAULT_INCIDENT_WEIGHTED_SCORING_POLICY
} from './bootstrap.js';
