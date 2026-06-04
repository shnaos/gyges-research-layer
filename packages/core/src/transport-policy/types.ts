/**
 * Transport Routing & Isolation Policies MVP — core primitives and contracts.
 *
 * Sprint 8 introduces the first deterministic routing/isolation decision layer.
 * It decides *which* transport an authorised capability should use, *whether* a
 * session must rotate, and *how* strongly the execution must be isolated — but
 * it performs NO real network, browser, DNS, socket, or persistence work.
 *
 * The engine sits strictly between the Session Manager and the Execution
 * Engine. It NEVER mints a session, NEVER opens a connection, and NEVER runs an
 * execution: it only returns a {@link RoutingDecision} that the caller applies.
 *
 * The types are deliberately self-contained and agnostic — no coupling to any
 * specific business product, persistence, browser, or real transport.
 */

import { CapabilityTool, RiskLevel } from '../index.js';
import { TransportKind } from '../execution/types.js';

/**
 * Strength of isolation applied to an execution.
 *
 * - `none`        — no isolation requirement; sessions may be freely reused
 * - `session`     — isolation is scoped to a single session identity
 * - `compartment` — isolation is scoped to the owning identity compartment
 * - `strict`      — maximum isolation: each routed execution gets a fresh
 *   session and reuse is never permitted
 */
export type IsolationLevel = 'none' | 'session' | 'compartment' | 'strict';

/**
 * Deterministic justification attached to a {@link RoutingDecision}.
 *
 * - `default_transport` — no rotation/isolation trigger fired; the rule's
 *   preferred transport is used with reuse left untouched
 * - `forced_rotation`   — a fresh session is required (reuse forbidden, or a
 *   high-risk request hit `forceRotateOnHighRisk`)
 * - `strict_isolation`  — the rule's isolation level is `strict`, forcing a
 *   fresh, non-reusable session
 * - `risk_escalation`   — a high-risk request that does NOT force a rotation
 *   (its rule leaves `forceRotateOnHighRisk` off), surfaced for auditing
 * - `reuse_allowed`     — a session-scoped/compartment-scoped low/medium-risk
 *   request whose session may be reused
 */
export type RoutingReason =
  | 'default_transport'
  | 'forced_rotation'
  | 'strict_isolation'
  | 'risk_escalation'
  | 'reuse_allowed';

/**
 * Isolation strategy attached to a {@link TransportPolicyRule}.
 *
 * Carries only the booleans/level needed to make a deterministic routing
 * decision. It holds NO secrets, credentials, or real transport configuration.
 */
export interface IsolationPolicy {
  /** Strength of isolation to apply. */
  level: IsolationLevel;
  /** When `true`, a high-risk request forces a session rotation. */
  forceRotateOnHighRisk: boolean;
  /** When `true`, an existing session may never be reused — always rotate. */
  forbidSessionReuse: boolean;
  /** When `true`, a session may be reused across different tools. */
  allowCrossToolReuse: boolean;
}

/**
 * A single deterministic routing rule, keyed by `(tool, riskLevel)`.
 *
 * The engine resolves an execution to exactly one rule. There is no implicit
 * fallback: a missing rule is fail-closed (the engine throws).
 */
export interface TransportPolicyRule {
  tool: CapabilityTool;
  riskLevel: RiskLevel;
  /** Transport the rule binds matching executions to. */
  preferredTransport: TransportKind;
  /** Isolation strategy applied to matching executions. */
  isolationPolicy: IsolationPolicy;
}

/**
 * The deterministic outcome of resolving an execution against a rule.
 *
 * It is pure metadata: the caller (e.g. the Local API boundary) is responsible
 * for actually rotating/selecting a session and running the execution. The
 * engine never performs either action itself.
 */
export interface RoutingDecision {
  /** Transport the execution must use (the matched rule's preferred transport). */
  transportKind: TransportKind;
  /** Whether the caller must rotate to a fresh session before executing. */
  shouldRotateSession: boolean;
  /** Effective isolation level for the execution. */
  isolationLevel: IsolationLevel;
  /** Deterministic justification for this decision. */
  reason: RoutingReason;
}

/**
 * Reason a {@link TransportPolicyEngine} operation could not complete.
 *
 * - `duplicate_rule` — a rule for the same `(tool, riskLevel)` is already
 *   registered; there is no silent overwrite
 * - `no_rule`        — no rule matches the resolved `(tool, riskLevel)`; the
 *   engine is fail-closed and refuses to invent a default
 */
export type TransportPolicyErrorKind = 'duplicate_rule' | 'no_rule';
