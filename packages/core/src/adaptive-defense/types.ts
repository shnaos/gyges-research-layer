/**
 * Adaptive Defense & Capability Rate Limiting MVP — core primitives and
 * contracts.
 *
 * Sprint 13 introduces the first ACTIVE defensive layer of GRL. Until now GRL
 * could observe, audit, detect, open incidents, sandbox, and isolate — but it
 * could never slow an agent down, impose a cooldown, temporarily block a
 * capability, downgrade permissions, or react adaptively to dangerous patterns.
 *
 * This module adds two deterministic, in-memory engines:
 *   - {@link CapabilityRateLimiter} — static, sliding-window rate limiting plus
 *     temporary capability blocks
 *   - {@link AdaptiveDefenseEngine} — maps the {@link RuntimeAnomaly}s and
 *     {@link RuntimeIncident}s already produced by Sprint 12 onto a small set of
 *     {@link DefenseAction}s
 *
 * Hard constraints (Sprint 13 MVP): everything here is deterministic, purely
 * local, and side-effect free. There is NO machine learning, NO AI, NO semantic
 * classification — only static thresholds and explicit policy matching. There is
 * NO database, NO Redis, NO file write, NO network, NO fetch / DNS / socket, NO
 * browser, NO durable persistence, and NO cloud telemetry.
 *
 * Privacy: rate-limit decisions, temporary blocks, and defense decisions carry
 * only minimal, secret-free metadata (ids, scopes, counts, timestamps, reasons).
 * They must NEVER contain an approval token, secret, credential, raw HTTP
 * header, raw environment, raw stack trace, or raw request input.
 */

import { CapabilityTool, RiskLevel } from '../index.js';
import {
  IncidentSeverity,
  RuntimeAnomaly,
  RuntimeAnomalyType,
  RuntimeIncident
} from '../runtime-security/index.js';

/**
 * The dimension a {@link RateLimitPolicy} counts requests against.
 *
 * - `agent`       — all requests from a single agent
 * - `compartment` — all requests inside an identity compartment
 * - `session`     — all requests on a single session (skipped when no session)
 * - `tool`        — all requests for a single capability tool
 */
export type RateLimitScope = 'agent' | 'compartment' | 'session' | 'tool';

/**
 * The closed vocabulary of active defensive actions GRL can take.
 *
 * - `allow`            — no defensive action; proceed normally
 * - `cooldown`         — refuse for now and surface a `retryAfterMs`
 * - `temporary_block`  — refuse while a {@link TemporaryCapabilityBlock} is live
 * - `require_approval` — divert into the human-in-the-loop approval queue
 * - `escalate_risk`    — raise the effective {@link RiskLevel} before the firewall
 */
export type DefenseAction =
  | 'allow'
  | 'cooldown'
  | 'temporary_block'
  | 'require_approval'
  | 'escalate_risk';

/**
 * A bounded cooldown window. `startedAt` is the wall-clock-independent reference
 * timestamp the window opened at; it is active while `now < startedAt +
 * durationMs`.
 */
export interface CooldownWindow {
  durationMs: number;
  startedAt: number;
}

/**
 * A static, sliding-window rate-limit policy.
 *
 * The {@link CapabilityRateLimiter} triggers `action` when more than
 * `maxRequests` requests are observed within `windowMs` for the policy's
 * {@link RateLimitScope}. A disabled policy is never evaluated.
 */
export interface RateLimitPolicy {
  id: string;
  scope: RateLimitScope;
  maxRequests: number;
  windowMs: number;
  action: DefenseAction;
  enabled: boolean;
}

/**
 * The decision the {@link CapabilityRateLimiter} returns for one request.
 *
 * `remaining` is the number of further requests allowed in the current window,
 * `resetAt` is when the window frees up, and `retryAfterMs` is set whenever the
 * caller must wait (cooldown / temporary block).
 */
export interface RateLimitDecision {
  action: DefenseAction;
  remaining: number;
  resetAt: number;
  retryAfterMs?: number;
  reason: string;
}

/**
 * A temporary block on a capability surface.
 *
 * A block matches a request when every *defined* field equals the request's
 * (an all-`undefined` block is global). It is active while `now < expiresAt`.
 */
export interface TemporaryCapabilityBlock {
  id: string;
  createdAt: number;
  expiresAt: number;
  agentId?: string;
  compartmentId?: string;
  tool?: CapabilityTool;
  reason: string;
}

/**
 * The result of a dynamic risk escalation: the request's `originalRisk` was
 * raised to `escalatedRisk` for the reason given.
 */
export interface DynamicRiskEscalation {
  originalRisk: RiskLevel;
  escalatedRisk: RiskLevel;
  reason: string;
}

/**
 * A policy mapping observed {@link RuntimeAnomaly}s / {@link RuntimeIncident}s
 * onto a {@link DefenseAction}.
 *
 * A policy fires when any input anomaly's type is in `triggerAnomalyTypes` OR
 * any input incident's severity is in `triggerIncidentSeverities`. A disabled
 * policy is never evaluated.
 */
export interface AdaptiveDefensePolicy {
  id: string;
  triggerAnomalyTypes: RuntimeAnomalyType[];
  triggerIncidentSeverities: IncidentSeverity[];
  resultingAction: DefenseAction;
  cooldownMs?: number;
  escalationRiskLevel?: RiskLevel;
  enabled: boolean;
}

/** Per-request input the {@link CapabilityRateLimiter} evaluates. */
export interface RateLimitEvaluationInput {
  agentId: string;
  compartmentId: string;
  sessionId?: string;
  tool: CapabilityTool;
  timestamp: number;
}

/**
 * Input the {@link AdaptiveDefenseEngine} evaluates: the anomalies and incidents
 * already produced by the Sprint 12 runtime-security layer.
 */
export interface AdaptiveDefenseEvaluationInput {
  anomalies: RuntimeAnomaly[];
  incidents: RuntimeIncident[];
}

/** One defensive decision produced by the {@link AdaptiveDefenseEngine}. */
export interface AdaptiveDefenseDecision {
  action: DefenseAction;
  reason: string;
  cooldownMs?: number;
  escalation?: DynamicRiskEscalation;
}

/** Ordered risk levels, least to most severe, for escalation comparisons. */
export const RISK_ORDER: Readonly<Record<RiskLevel, number>> = {
  low: 0,
  medium: 1,
  high: 2
};

/**
 * Compute a {@link DynamicRiskEscalation} raising `current` to `target`.
 *
 * Returns `undefined` when `target` is not strictly higher than `current` (an
 * escalation never downgrades or no-ops). Deterministic and side-effect free.
 */
export function escalateRisk(
  current: RiskLevel,
  target: RiskLevel,
  reason: string
): DynamicRiskEscalation | undefined {
  if (RISK_ORDER[target] <= RISK_ORDER[current]) {
    return undefined;
  }
  return { originalRisk: current, escalatedRisk: target, reason };
}
