/**
 * Bootstrap trust / reputation policies for the Compartment Trust Scoring MVP.
 *
 * These are the deterministic defaults the {@link CompartmentTrustEngine} and
 * the local server start with. They are pure, static configuration — no ML, no
 * AI, no semantic classification, no real network, no durable persistence.
 */

import {
  IncidentWeightedScoringPolicy,
  ReputationDecayPolicy,
  TrustRecoveryPolicy
} from './types.js';

/**
 * Default passive decay / restoration policy.
 *
 * Once per hour, a degraded compartment is nudged +1 toward a neutral baseline,
 * never crossing 70. A score already at or above 70 is never inflated by decay.
 */
export const DEFAULT_REPUTATION_DECAY_POLICY: ReputationDecayPolicy = {
  intervalMs: 3_600_000,
  recoveryDelta: 1,
  maxScore: 70,
  enabled: true
};

/**
 * Default active recovery policy.
 *
 * A clean execution restores +1 and a closed incident restores +5, but no more
 * than +10 of positive recovery may be applied within any one-hour window.
 */
export const DEFAULT_TRUST_RECOVERY_POLICY: TrustRecoveryPolicy = {
  cleanExecutionDelta: 1,
  incidentClosedDelta: 5,
  maxRecoveryPerWindow: 10,
  windowMs: 3_600_000,
  enabled: true
};

/**
 * Default incident-weighted scoring policy: a warning incident costs -12 and a
 * critical incident costs -25.
 */
export const DEFAULT_INCIDENT_WEIGHTED_SCORING_POLICY: IncidentWeightedScoringPolicy =
  {
    warningIncidentDelta: -12,
    criticalIncidentDelta: -25,
    enabled: true
  };
