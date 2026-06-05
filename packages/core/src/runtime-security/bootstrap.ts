/**
 * Bootstrap heuristic rules for the Runtime Security Heuristics Engine MVP.
 *
 * These are the deterministic defaults the local server starts with. They are
 * pure, static thresholds over the normalised security-event stream — no ML, no
 * AI, no semantic classification, no real network. Every supported
 * {@link RuntimeAnomalyType} is covered.
 */

import { HeuristicRule } from './types.js';

/**
 * The full set of bootstrap heuristic rules, in registration order.
 *
 * Each rule fires when at least `threshold` matching security events occur
 * within `timeWindowMs`. Severities are conservative defaults: defensive
 * refusals that recur are `warning`, while sandbox / privacy violations escalate
 * to `critical`.
 */
export const BOOTSTRAP_HEURISTIC_RULES: readonly HeuristicRule[] = [
  {
    id: 'repeated-denied',
    name: 'Repeated denied capabilities',
    anomalyType: 'repeated_denied_capabilities',
    threshold: 3,
    timeWindowMs: 60_000,
    severity: 'warning',
    enabled: true
  },
  {
    id: 'sandbox-violations',
    name: 'Sandbox violation attempts',
    anomalyType: 'sandbox_violation_attempts',
    threshold: 2,
    timeWindowMs: 60_000,
    severity: 'critical',
    enabled: true
  },
  {
    id: 'privacy-boundary-violations',
    name: 'Privacy boundary violations',
    anomalyType: 'privacy_boundary_violations',
    threshold: 2,
    timeWindowMs: 60_000,
    severity: 'critical',
    enabled: true
  },
  {
    id: 'rapid-session-rotation',
    name: 'Rapid session rotation',
    anomalyType: 'rapid_session_rotation',
    threshold: 5,
    timeWindowMs: 60_000,
    severity: 'warning',
    enabled: true
  },
  {
    id: 'high-risk-execution',
    name: 'High risk execution pattern',
    anomalyType: 'high_risk_execution_pattern',
    threshold: 3,
    timeWindowMs: 60_000,
    severity: 'warning',
    enabled: true
  },
  {
    id: 'approval-rejection',
    name: 'Approval rejection pattern',
    anomalyType: 'approval_rejection_pattern',
    threshold: 3,
    timeWindowMs: 60_000,
    severity: 'warning',
    enabled: true
  }
];
