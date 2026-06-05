/**
 * CompartmentTrustEngine — deterministic, in-memory trust-scoring engine.
 *
 * The engine maintains one {@link ReputationProfile} per identity compartment.
 * It scores {@link ReputationEvent}s with static, additive rules, keeps every
 * score bounded to `[0, 100]`, and classifies it into a {@link TrustLevel}. It
 * can also passively restore degraded compartments toward a neutral baseline
 * via {@link applyDecay}.
 *
 * Determinism & safety:
 *   - identical event sequences always yield identical scores and histories
 *   - the clock and id generator are injectable, so tests are fully reproducible
 *   - all returned profiles/events are defensive deep copies — a caller can
 *     never mutate engine state through a held reference
 *   - purely in-memory and side-effect free: NO network, NO persistence, NO
 *     AI/ML, NO semantic classification — only counting and bounded arithmetic
 */

import { randomUUID } from 'node:crypto';
import { IncidentSeverity } from '../runtime-security/index.js';
import {
  DEFAULT_INCIDENT_WEIGHTED_SCORING_POLICY,
  DEFAULT_REPUTATION_DECAY_POLICY,
  DEFAULT_TRUST_RECOVERY_POLICY
} from './bootstrap.js';
import {
  INITIAL_TRUST_SCORE,
  IncidentWeightedScoringPolicy,
  ReputationDecayPolicy,
  ReputationEvent,
  ReputationEventInput,
  ReputationProfile,
  STATIC_REPUTATION_DELTAS,
  TrustAdjustment,
  TrustRecoveryPolicy,
  clampScore,
  makeTrustScore
} from './types.js';

export interface CompartmentTrustEngineOptions {
  /** Injectable clock for deterministic timestamps. Defaults to {@link Date.now}. */
  now?: () => number;
  /** Injectable id generator for reputation events. Defaults to {@link randomUUID}. */
  generateId?: () => string;
  /** Passive decay / restoration policy. Defaults to the bootstrap policy. */
  decayPolicy?: ReputationDecayPolicy;
  /** Active recovery policy for positive events. Defaults to the bootstrap policy. */
  recoveryPolicy?: TrustRecoveryPolicy;
  /** Incident-weighted scoring policy. Defaults to the bootstrap policy. */
  incidentScoringPolicy?: IncidentWeightedScoringPolicy;
}

/** Deep-clone a {@link ReputationEvent}. */
function cloneEvent(event: ReputationEvent): ReputationEvent {
  const clone: ReputationEvent = {
    id: event.id,
    createdAt: event.createdAt,
    compartmentId: event.compartmentId,
    type: event.type,
    delta: event.delta,
    reason: event.reason
  };
  if (event.relatedEventId !== undefined) clone.relatedEventId = event.relatedEventId;
  if (event.relatedIncidentId !== undefined) {
    clone.relatedIncidentId = event.relatedIncidentId;
  }
  return clone;
}

/** Deep-clone a {@link ReputationProfile}, including its score and event list. */
function cloneProfile(profile: ReputationProfile): ReputationProfile {
  return {
    compartmentId: profile.compartmentId,
    score: { value: profile.score.value, level: profile.score.level },
    events: profile.events.map(cloneEvent),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  };
}

/** One bounded recovery application, used to enforce the per-window cap. */
interface RecoveryMark {
  at: number;
  amount: number;
}

export class CompartmentTrustEngine {
  /** Canonical per-compartment profiles. */
  private readonly profiles = new Map<string, ReputationProfile>();
  /** Last decay-pass timestamp per compartment, for `intervalMs` spacing. */
  private readonly lastDecayAt = new Map<string, number>();
  /** Sliding-window record of positive recovery applied per compartment. */
  private readonly recoveryHistory = new Map<string, RecoveryMark[]>();

  private readonly now: () => number;
  private readonly generateId: () => string;
  private readonly decayPolicy: ReputationDecayPolicy;
  private readonly recoveryPolicy: TrustRecoveryPolicy;
  private readonly incidentScoringPolicy: IncidentWeightedScoringPolicy;

  constructor(options: CompartmentTrustEngineOptions = {}) {
    this.now = options.now ?? Date.now;
    this.generateId = options.generateId ?? randomUUID;
    this.decayPolicy = { ...(options.decayPolicy ?? DEFAULT_REPUTATION_DECAY_POLICY) };
    this.recoveryPolicy = {
      ...(options.recoveryPolicy ?? DEFAULT_TRUST_RECOVERY_POLICY)
    };
    this.incidentScoringPolicy = {
      ...(options.incidentScoringPolicy ?? DEFAULT_INCIDENT_WEIGHTED_SCORING_POLICY)
    };
  }

  /**
   * Return the profile for `compartmentId`, creating a fresh neutral one (score
   * {@link INITIAL_TRUST_SCORE}) when none exists. Returns a defensive copy.
   */
  getOrCreateProfile(compartmentId: string): ReputationProfile {
    return cloneProfile(this.ensureProfile(compartmentId, this.now()));
  }

  /** Return a defensive copy of the profile for `compartmentId`, or `undefined`. */
  getProfile(compartmentId: string): ReputationProfile | undefined {
    const profile = this.profiles.get(compartmentId);
    return profile ? cloneProfile(profile) : undefined;
  }

  /** List every profile in creation order. Returns defensive deep copies. */
  listProfiles(): ReputationProfile[] {
    return [...this.profiles.values()].map(cloneProfile);
  }

  /**
   * Record a reputation event for a compartment, adjust its bounded score, and
   * return a defensive copy of the updated profile.
   *
   * The score is moved by the event's deterministic delta and re-clamped to
   * `[0, 100]`; the {@link TrustLevel} is recomputed. The caller's input is
   * never mutated.
   */
  recordEvent(input: ReputationEventInput): ReputationProfile {
    const at = input.createdAt ?? this.now();
    const profile = this.ensureProfile(input.compartmentId, at);

    const adjustment = this.adjustmentFor(input);
    let delta = adjustment.delta;
    // Cap positive recovery (clean_execution / incident_closed) within the
    // sliding window so a flood of clean events cannot instantly rehabilitate.
    if (
      delta > 0 &&
      this.recoveryPolicy.enabled &&
      (input.type === 'clean_execution' || input.type === 'incident_closed')
    ) {
      delta = this.capRecovery(input.compartmentId, at, delta);
    }

    const event: ReputationEvent = {
      id: this.generateId(),
      createdAt: at,
      compartmentId: input.compartmentId,
      type: input.type,
      delta,
      reason: input.reason
    };
    if (input.relatedEventId !== undefined) {
      event.relatedEventId = input.relatedEventId;
    }
    if (input.relatedIncidentId !== undefined) {
      event.relatedIncidentId = input.relatedIncidentId;
    }

    profile.events.push(event);
    profile.score = makeTrustScore(profile.score.value + delta);
    profile.updatedAt = at;

    return cloneProfile(profile);
  }

  /**
   * Apply one passive decay pass: nudge every degraded profile (score below the
   * decay policy's `maxScore`) up by `recoveryDelta`, never crossing `maxScore`.
   * A profile is skipped when its last pass was within `intervalMs`.
   *
   * Returns defensive copies of the profiles that actually changed.
   */
  applyDecay(now: number = this.now()): ReputationProfile[] {
    if (!this.decayPolicy.enabled) return [];

    const changed: ReputationProfile[] = [];
    for (const profile of this.profiles.values()) {
      const last = this.lastDecayAt.get(profile.compartmentId);
      if (last !== undefined && now - last < this.decayPolicy.intervalMs) {
        continue;
      }
      this.lastDecayAt.set(profile.compartmentId, now);

      // Decay only restores DEGRADED compartments toward neutral; a score at or
      // above maxScore is never artificially inflated by decay.
      if (profile.score.value >= this.decayPolicy.maxScore) continue;

      const restored = Math.min(
        this.decayPolicy.maxScore,
        profile.score.value + this.decayPolicy.recoveryDelta
      );
      if (restored === profile.score.value) continue;

      profile.score = makeTrustScore(restored);
      profile.updatedAt = now;
      changed.push(cloneProfile(profile));
    }
    return changed;
  }

  /** Drop every profile and all decay / recovery bookkeeping. */
  clear(): void {
    this.profiles.clear();
    this.lastDecayAt.clear();
    this.recoveryHistory.clear();
  }

  /** Number of tracked compartment profiles. */
  size(): number {
    return this.profiles.size;
  }

  /** Get the live profile for `compartmentId`, creating a neutral one if absent. */
  private ensureProfile(compartmentId: string, at: number): ReputationProfile {
    let profile = this.profiles.get(compartmentId);
    if (!profile) {
      profile = {
        compartmentId,
        score: makeTrustScore(INITIAL_TRUST_SCORE),
        events: [],
        createdAt: at,
        updatedAt: at
      };
      this.profiles.set(compartmentId, profile);
    }
    return profile;
  }

  /** Resolve the nominal {@link TrustAdjustment} an event input carries. */
  private adjustmentFor(input: ReputationEventInput): TrustAdjustment {
    switch (input.type) {
      case 'clean_execution':
        return {
          delta: this.recoveryPolicy.enabled
            ? this.recoveryPolicy.cleanExecutionDelta
            : 0,
          reason: input.reason
        };
      case 'incident_closed':
        return {
          delta: this.recoveryPolicy.enabled
            ? this.recoveryPolicy.incidentClosedDelta
            : 0,
          reason: input.reason
        };
      case 'incident_opened':
        return {
          delta: this.incidentDelta(input.incidentSeverity),
          reason: input.reason
        };
      default:
        return {
          delta: STATIC_REPUTATION_DELTAS[input.type],
          reason: input.reason
        };
    }
  }

  /** Incident-opened delta for a severity (critical vs. everything else). */
  private incidentDelta(severity: IncidentSeverity | undefined): number {
    if (!this.incidentScoringPolicy.enabled) return 0;
    return severity === 'critical'
      ? this.incidentScoringPolicy.criticalIncidentDelta
      : this.incidentScoringPolicy.warningIncidentDelta;
  }

  /**
   * Cap a proposed positive recovery `delta` so the total recovery applied
   * within the policy window does not exceed `maxRecoveryPerWindow`, and record
   * the (capped) amount against the sliding window.
   */
  private capRecovery(compartmentId: string, at: number, delta: number): number {
    const windowStart = at - this.recoveryPolicy.windowMs;
    const marks = (this.recoveryHistory.get(compartmentId) ?? []).filter(
      (mark) => mark.at >= windowStart
    );
    const used = marks.reduce((sum, mark) => sum + mark.amount, 0);
    const allowed = Math.max(0, this.recoveryPolicy.maxRecoveryPerWindow - used);
    const effective = Math.min(delta, allowed);
    if (effective > 0) {
      marks.push({ at, amount: effective });
    }
    this.recoveryHistory.set(compartmentId, marks);
    return effective;
  }
}
