/**
 * Runtime Security Heuristics & Incident Detection MVP — core primitives and
 * contracts.
 *
 * Sprint 12 introduces the first behavioural detection layer. It is a purely
 * passive observer that consumes the normalised {@link SecurityEvent}s already
 * produced by the Sprint 11 Security Event Engine, applies a small set of
 * static {@link HeuristicRule}s, and emits {@link RuntimeAnomaly}s which the
 * {@link IncidentDetector} groups into {@link RuntimeIncident}s.
 *
 * Hard constraints (Sprint 12 MVP): everything here is deterministic, purely
 * local, and side-effect free. There is NO machine learning, NO AI, NO semantic
 * classification — only static, threshold-based heuristics over a sliding time
 * window. There is NO database, NO Redis, NO file write, NO network, NO fetch /
 * DNS / socket, NO browser, NO durable persistence, and NO cloud telemetry.
 *
 * Privacy: anomalies and incidents carry only minimal, secret-free metadata
 * (event counts, anomaly/event types, severities, timestamps, ids). They must
 * NEVER contain an approval token, secret, credential, raw HTTP header, raw
 * environment, raw stack trace, or raw request input.
 */

import { SecurityEventType } from '../audit/types.js';

/**
 * The closed vocabulary of runtime anomalies the heuristics engine can detect.
 *
 * Each value maps to one heuristic over a specific family of security events.
 */
export type RuntimeAnomalyType =
  | 'repeated_denied_capabilities'
  | 'sandbox_violation_attempts'
  | 'privacy_boundary_violations'
  | 'rapid_session_rotation'
  | 'high_risk_execution_pattern'
  | 'approval_rejection_pattern';

/**
 * Coarse, ordered security score attached to a {@link RuntimeAnomaly}, from
 * least to most severe.
 */
export type SecurityScore = 'low' | 'medium' | 'high' | 'critical';

/**
 * Severity of a {@link RuntimeIncident} (and of the {@link HeuristicRule} that
 * triggered it), from least to most urgent.
 */
export type IncidentSeverity = 'info' | 'warning' | 'critical';

/** Lifecycle status of a {@link RuntimeIncident}. */
export type IncidentStatus = 'open' | 'closed';

/**
 * A single detected runtime anomaly.
 *
 * `id` and `createdAt` are assigned by the
 * {@link RuntimeSecurityHeuristicsEngine} at detection time. `relatedEventIds`
 * are the ids of the security events that, together, crossed the rule
 * threshold within the configured window.
 */
export interface RuntimeAnomaly {
  id: string;
  createdAt: number;
  type: RuntimeAnomalyType;
  score: SecurityScore;
  relatedEventIds: string[];
  summary: string;
  metadata?: Record<string, unknown>;
}

/**
 * A static, threshold-based heuristic rule.
 *
 * The engine raises a {@link RuntimeAnomaly} of `anomalyType` when at least
 * `threshold` matching security events are observed within `timeWindowMs`. A
 * disabled rule is never evaluated.
 */
export interface HeuristicRule {
  id: string;
  name: string;
  anomalyType: RuntimeAnomalyType;
  threshold: number;
  timeWindowMs: number;
  severity: IncidentSeverity;
  enabled: boolean;
}

/**
 * A correlated group of {@link RuntimeAnomaly}s describing a runtime security
 * incident.
 *
 * Incidents are auto-opened by the {@link IncidentDetector}, default to
 * `status: 'open'`, and aggregate the `relatedEventIds` of every anomaly that
 * contributed to them. They carry no secrets — only correlation metadata.
 */
export interface RuntimeIncident {
  id: string;
  createdAt: number;
  updatedAt: number;
  severity: IncidentSeverity;
  status: IncidentStatus;
  anomalyIds: string[];
  relatedEventIds: string[];
  summary: string;
}

/**
 * The set of {@link SecurityEventType}s each {@link RuntimeAnomalyType} watches.
 *
 * This is the single source of truth mapping an anomaly back to the security
 * events that can trigger it. The mapping is deliberately closed and static.
 */
export const ANOMALY_EVENT_TYPES: Readonly<
  Record<RuntimeAnomalyType, readonly SecurityEventType[]>
> = {
  repeated_denied_capabilities: ['capability_denied'],
  sandbox_violation_attempts: ['sandbox_blocked'],
  privacy_boundary_violations: ['privacy_boundary_blocked'],
  rapid_session_rotation: ['session_rotated'],
  high_risk_execution_pattern: ['execution_failed', 'execution_blocked'],
  approval_rejection_pattern: ['approval_rejected']
};
