/**
 * Bootstrap defense policies for the Adaptive Defense & Rate Limiting MVP.
 *
 * These are the deterministic defaults the local server starts with. They are
 * pure, static configuration — no ML, no AI, no semantic classification, no real
 * network. Rate limits are sliding-window counters; adaptive policies map the
 * Sprint 12 anomaly/incident vocabulary onto active {@link DefenseAction}s.
 */

import { AdaptiveDefensePolicy, RateLimitPolicy } from './types.js';

/**
 * The full set of bootstrap rate-limit policies, in registration order.
 *
 * - `agent-search-rate`     — slow a single agent to 10 requests / minute
 * - `tool-fetch-html-rate`  — divert `fetch_html` bursts (5 / minute) to approval
 */
export const BOOTSTRAP_RATE_LIMIT_POLICIES: readonly RateLimitPolicy[] = [
  {
    id: 'agent-search-rate',
    scope: 'agent',
    maxRequests: 10,
    windowMs: 60_000,
    action: 'cooldown',
    enabled: true
  },
  {
    id: 'tool-fetch-html-rate',
    scope: 'tool',
    maxRequests: 5,
    windowMs: 60_000,
    action: 'require_approval',
    enabled: true
  }
];

/**
 * The full set of bootstrap adaptive defense policies, in registration order.
 *
 * Each maps an anomaly type (and a correlated incident severity) onto an active
 * defense:
 *   - repeated denied capabilities      → cooldown
 *   - sandbox violation attempts        → temporary block
 *   - privacy boundary violations       → require approval
 *   - approval rejection pattern        → cooldown
 *   - high-risk execution pattern       → escalate risk
 */
export const BOOTSTRAP_ADAPTIVE_DEFENSE_POLICIES: readonly AdaptiveDefensePolicy[] =
  [
    {
      id: 'repeated-denied-defense',
      triggerAnomalyTypes: ['repeated_denied_capabilities'],
      triggerIncidentSeverities: ['warning'],
      resultingAction: 'cooldown',
      cooldownMs: 60_000,
      enabled: true
    },
    {
      id: 'sandbox-defense',
      triggerAnomalyTypes: ['sandbox_violation_attempts'],
      triggerIncidentSeverities: ['critical'],
      resultingAction: 'temporary_block',
      cooldownMs: 300_000,
      enabled: true
    },
    {
      id: 'privacy-boundary-defense',
      triggerAnomalyTypes: ['privacy_boundary_violations'],
      triggerIncidentSeverities: ['critical'],
      resultingAction: 'require_approval',
      enabled: true
    },
    {
      id: 'approval-rejection-defense',
      triggerAnomalyTypes: ['approval_rejection_pattern'],
      triggerIncidentSeverities: ['warning'],
      resultingAction: 'cooldown',
      cooldownMs: 120_000,
      enabled: true
    },
    {
      id: 'risk-escalation-defense',
      triggerAnomalyTypes: ['high_risk_execution_pattern'],
      triggerIncidentSeverities: ['warning', 'critical'],
      resultingAction: 'escalate_risk',
      escalationRiskLevel: 'high',
      enabled: true
    }
  ];
