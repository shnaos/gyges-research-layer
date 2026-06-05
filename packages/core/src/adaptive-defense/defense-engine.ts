/**
 * AdaptiveDefenseEngine — deterministic mapping from observed runtime
 * anomalies / incidents onto active {@link DefenseAction}s.
 *
 * Responsibilities (Sprint 13 MVP):
 *   - hold {@link AdaptiveDefensePolicy}s keyed by id (no silent duplicate)
 *   - {@link evaluate} a batch of {@link RuntimeAnomaly}s + {@link RuntimeIncident}s
 *     against every enabled policy, returning one {@link AdaptiveDefenseDecision}
 *     per fired policy, in registration order
 *
 * Matching: a policy fires when ANY input anomaly's type is listed in
 * `triggerAnomalyTypes`, OR ANY input incident's severity is listed in
 * `triggerIncidentSeverities`.
 *
 * Determinism & safety:
 *   - identical inputs always produce identical, ordered decisions
 *   - the input anomalies/incidents are never mutated
 *   - purely in-memory and side-effect free: NO network, NO persistence, NO
 *     AI/ML, NO semantic classification — only explicit policy matching
 */

import {
  AdaptiveDefenseDecision,
  AdaptiveDefenseEvaluationInput,
  AdaptiveDefensePolicy
} from './types.js';

/**
 * The nominal baseline risk the engine reports as the `originalRisk` of an
 * escalation. The engine does not see the live request risk; the integration
 * layer recomputes the real escalation against the actual request risk before
 * applying it (see `escalateRisk`).
 */
const ESCALATION_BASELINE_RISK = 'low' as const;

/** Deep-clone an {@link AdaptiveDefensePolicy}. */
function clonePolicy(policy: AdaptiveDefensePolicy): AdaptiveDefensePolicy {
  const clone: AdaptiveDefensePolicy = {
    id: policy.id,
    triggerAnomalyTypes: [...policy.triggerAnomalyTypes],
    triggerIncidentSeverities: [...policy.triggerIncidentSeverities],
    resultingAction: policy.resultingAction,
    enabled: policy.enabled
  };
  if (policy.cooldownMs !== undefined) clone.cooldownMs = policy.cooldownMs;
  if (policy.escalationRiskLevel !== undefined) {
    clone.escalationRiskLevel = policy.escalationRiskLevel;
  }
  return clone;
}

export class AdaptiveDefenseEngine {
  /** Registered policies, in insertion order. */
  private readonly policies: AdaptiveDefensePolicy[] = [];

  /**
   * Register an adaptive defense policy. Policy ids are unique: registering a
   * policy whose id already exists throws.
   */
  registerPolicy(policy: AdaptiveDefensePolicy): void {
    if (this.policies.some((existing) => existing.id === policy.id)) {
      throw new Error(`Duplicate adaptive defense policy id: ${policy.id}`);
    }
    this.policies.push(clonePolicy(policy));
  }

  /** List the registered policies. Returns defensive copies in registration order. */
  listPolicies(): AdaptiveDefensePolicy[] {
    return this.policies.map(clonePolicy);
  }

  /** Remove every registered policy. */
  clearPolicies(): void {
    this.policies.length = 0;
  }

  /**
   * Evaluate the observed anomalies/incidents.
   *
   * Returns one decision per fired, enabled policy in registration order. A
   * disabled policy is never evaluated. The input is never mutated.
   */
  evaluate(input: AdaptiveDefenseEvaluationInput): AdaptiveDefenseDecision[] {
    const anomalyTypes = new Set(input.anomalies.map((a) => a.type));
    const incidentSeverities = new Set(input.incidents.map((i) => i.severity));

    const decisions: AdaptiveDefenseDecision[] = [];
    for (const policy of this.policies) {
      if (!policy.enabled) continue;

      const anomalyMatch = policy.triggerAnomalyTypes.some((type) =>
        anomalyTypes.has(type)
      );
      const incidentMatch = policy.triggerIncidentSeverities.some((severity) =>
        incidentSeverities.has(severity)
      );
      if (!anomalyMatch && !incidentMatch) continue;

      const reason = `Adaptive defense policy "${policy.id}" triggered (${
        anomalyMatch ? 'anomaly' : 'incident'
      } match) → ${policy.resultingAction}.`;
      const decision: AdaptiveDefenseDecision = {
        action: policy.resultingAction,
        reason
      };
      if (policy.cooldownMs !== undefined) {
        decision.cooldownMs = policy.cooldownMs;
      }
      if (policy.resultingAction === 'escalate_risk') {
        decision.escalation = {
          originalRisk: ESCALATION_BASELINE_RISK,
          escalatedRisk: policy.escalationRiskLevel ?? 'high',
          reason
        };
      }
      decisions.push(decision);
    }
    return decisions;
  }
}
