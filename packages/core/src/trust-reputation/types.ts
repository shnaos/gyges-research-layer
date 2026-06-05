/**
 * Compartment Trust Scoring & Reputation Engine MVP — core primitives and
 * contracts.
 *
 * Sprint 14 introduces the first reputation / trust-scoring layer of GRL. Until
 * now GRL could apply policies, rate-limit, cooldown, temporarily block,
 * escalate risk, detect anomalies, and open incidents — but it could not attach
 * a confidence score to a compartment, evolve that confidence from runtime
 * events, progressively degrade or restore a compartment, or expose a readable
 * local reputation.
 *
 * This module adds a deterministic, in-memory {@link CompartmentTrustEngine}
 * that maintains a {@link ReputationProfile} per identity compartment: a bounded
 * {@link TrustScore} (0..100) classified into a {@link TrustLevel}, plus the
 * ordered list of {@link ReputationEvent}s that shaped it.
 *
 * Hard constraints (Sprint 14 MVP): everything here is deterministic, purely
 * local, and side-effect free. There is NO machine learning, NO AI, NO semantic
 * classification — only static, additive scoring rules. There is NO database, NO
 * Redis, NO file write, NO network, NO fetch / DNS / socket, NO browser, NO
 * durable persistence, and NO cloud telemetry.
 *
 * Privacy: a reputation profile and its events carry only minimal, secret-free
 * metadata (compartment id, scores, deltas, reasons, correlation ids,
 * timestamps). They must NEVER contain an approval token, secret, credential,
 * raw HTTP header, raw environment, raw stack trace, or raw request input.
 */

import { IncidentSeverity } from '../runtime-security/index.js';

/**
 * Coarse, ordered trust classification of a compartment, from most to least
 * trusted. The band a {@link TrustScore} falls into is derived from its numeric
 * `value` (see {@link levelForScore}).
 *
 * - `trusted`     — 80..100, proceed normally
 * - `neutral`     — 50..79, proceed normally (the healthy default)
 * - `restricted`  — 20..49, degraded: force human approval before executing
 * - `quarantined` — 0..19, denied: the compartment is not allowed to execute
 */
export type TrustLevel = 'trusted' | 'neutral' | 'restricted' | 'quarantined';

/**
 * The closed vocabulary of reputation events the engine can score.
 *
 * Each value maps to a deterministic {@link TrustAdjustment}. New event kinds
 * are added by extending this union, never by inventing free-form strings.
 */
export type ReputationEventType =
  | 'capability_allowed'
  | 'capability_denied'
  | 'approval_rejected'
  | 'privacy_boundary_blocked'
  | 'sandbox_blocked'
  | 'execution_failed'
  | 'incident_opened'
  | 'incident_closed'
  | 'clean_execution';

/**
 * A bounded trust score and the {@link TrustLevel} band it falls into.
 *
 * `value` is always clamped to `[0, 100]` and `level` is always consistent with
 * `value` — both are produced together by {@link makeTrustScore}.
 */
export interface TrustScore {
  /** Bounded confidence value, 0..100. */
  value: number;
  /** The band `value` falls into. Always consistent with `value`. */
  level: TrustLevel;
}

/**
 * A single scored reputation event.
 *
 * `id` and `createdAt` are assigned by the {@link CompartmentTrustEngine} when
 * the event is recorded. `delta` is the nominal trust adjustment the event
 * carried (the actual stored score is additionally clamped to `[0, 100]`).
 */
export interface ReputationEvent {
  id: string;
  createdAt: number;
  compartmentId: string;
  type: ReputationEventType;
  delta: number;
  reason: string;
  relatedEventId?: string;
  relatedIncidentId?: string;
}

/**
 * The full reputation record for one identity compartment: its current
 * {@link TrustScore} plus the ordered history of {@link ReputationEvent}s that
 * shaped it.
 */
export interface ReputationProfile {
  compartmentId: string;
  score: TrustScore;
  events: ReputationEvent[];
  createdAt: number;
  updatedAt: number;
}

/** A nominal trust adjustment: a signed `delta` and a human-readable `reason`. */
export interface TrustAdjustment {
  delta: number;
  reason: string;
}

/**
 * Policy governing passive trust decay — here decay means progressive
 * RESTORATION of a degraded compartment back toward a neutral, healthy state.
 *
 * Each {@link CompartmentTrustEngine.applyDecay} pass nudges every profile whose
 * score is below `maxScore` up by `recoveryDelta`, never crossing `maxScore`.
 * `intervalMs` is the minimum spacing between decay passes for a profile.
 */
export interface ReputationDecayPolicy {
  intervalMs: number;
  recoveryDelta: number;
  maxScore: number;
  enabled: boolean;
}

/**
 * Policy governing active trust recovery driven by positive runtime events.
 *
 * `clean_execution` restores `cleanExecutionDelta`; `incident_closed` restores
 * `incidentClosedDelta`. Total positive recovery applied within any `windowMs`
 * sliding window is capped at `maxRecoveryPerWindow`, so a flood of clean events
 * cannot instantly rehabilitate a compartment.
 */
export interface TrustRecoveryPolicy {
  cleanExecutionDelta: number;
  incidentClosedDelta: number;
  maxRecoveryPerWindow: number;
  windowMs: number;
  enabled: boolean;
}

/**
 * Policy governing how opened incidents are weighted into the score.
 *
 * A `warning`-severity incident applies `warningIncidentDelta`; a `critical`
 * incident applies `criticalIncidentDelta`. Both are expected to be negative.
 */
export interface IncidentWeightedScoringPolicy {
  warningIncidentDelta: number;
  criticalIncidentDelta: number;
  enabled: boolean;
}

/**
 * Input accepted by {@link CompartmentTrustEngine.recordEvent}.
 *
 * `incidentSeverity` is consulted only for `incident_opened` events. `createdAt`
 * is optional so callers (and tests) can supply a deterministic timestamp;
 * otherwise the engine's injectable clock is used.
 */
export interface ReputationEventInput {
  compartmentId: string;
  type: ReputationEventType;
  reason: string;
  relatedEventId?: string;
  relatedIncidentId?: string;
  incidentSeverity?: IncidentSeverity;
  createdAt?: number;
}

/** Lowest possible trust score. */
export const MIN_TRUST_SCORE = 0;
/** Highest possible trust score. */
export const MAX_TRUST_SCORE = 100;
/** Initial score a freshly-created compartment starts at (neutral). */
export const INITIAL_TRUST_SCORE = 70;

/**
 * Inclusive lower bound of each {@link TrustLevel} band:
 *   trusted 80..100, neutral 50..79, restricted 20..49, quarantined 0..19.
 */
export const TRUST_LEVEL_THRESHOLDS: Readonly<Record<TrustLevel, number>> = {
  trusted: 80,
  neutral: 50,
  restricted: 20,
  quarantined: 0
};

/**
 * The static trust adjustment each {@link ReputationEventType} carries, EXCEPT
 * the policy-driven ones (`clean_execution`, `incident_closed`,
 * `incident_opened`) whose deltas come from the recovery / incident-scoring
 * policies. This is the single source of truth for the fixed scoring rules.
 */
export const STATIC_REPUTATION_DELTAS: Readonly<
  Record<
    Exclude<
      ReputationEventType,
      'clean_execution' | 'incident_closed' | 'incident_opened'
    >,
    number
  >
> = {
  capability_allowed: 0,
  capability_denied: -2,
  approval_rejected: -4,
  privacy_boundary_blocked: -8,
  sandbox_blocked: -10,
  execution_failed: -6
};

/** Clamp an arbitrary numeric score into the valid `[0, 100]` range. */
export function clampScore(value: number): number {
  if (value < MIN_TRUST_SCORE) return MIN_TRUST_SCORE;
  if (value > MAX_TRUST_SCORE) return MAX_TRUST_SCORE;
  return value;
}

/** Classify a bounded score value into its {@link TrustLevel} band. */
export function levelForScore(value: number): TrustLevel {
  if (value >= TRUST_LEVEL_THRESHOLDS.trusted) return 'trusted';
  if (value >= TRUST_LEVEL_THRESHOLDS.neutral) return 'neutral';
  if (value >= TRUST_LEVEL_THRESHOLDS.restricted) return 'restricted';
  return 'quarantined';
}

/**
 * Build a consistent {@link TrustScore} from a raw value: clamp it to `[0, 100]`
 * and derive the matching {@link TrustLevel}.
 */
export function makeTrustScore(value: number): TrustScore {
  const clamped = clampScore(value);
  return { value: clamped, level: levelForScore(clamped) };
}
