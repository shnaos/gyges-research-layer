/**
 * Compartment Correlation & Privacy Boundary Engine MVP — primitives & contracts.
 *
 * Sprint 9 introduces the first deterministic anti-correlation / privacy boundary
 * layer. It decides whether an authorised capability may proceed given the risk
 * of *correlating* identity compartments, reusing context across tools, or
 * crossing an isolation boundary — but it performs NO real network, browser,
 * DNS, socket, persistence, or semantic/AI classification work.
 *
 * The engine sits strictly between the Transport Policy Engine and the Session
 * Manager. It NEVER mints a session, NEVER opens a connection, NEVER rotates a
 * session itself, and NEVER runs an execution: it only returns a
 * {@link PrivacyBoundaryDecision} that the caller applies.
 *
 * The types are deliberately self-contained and agnostic — no coupling to any
 * specific business product, persistence, browser, or real transport.
 */

import { CapabilityTool, RiskLevel } from '../index.js';
import { IsolationLevel } from '../transport-policy/types.js';

/**
 * Correlation risk attached to a {@link PrivacyBoundaryDecision}.
 *
 * - `none`   — no correlation concern detected
 * - `low`    — benign, in-boundary access (e.g. same compartment, within budget)
 * - `medium` — a notable correlation signal fired (risk escalation, cross-tool
 *   reuse, or strict isolation required) but it is recoverable via rotation /
 *   approval
 * - `high`   — a hard privacy boundary was crossed (unknown compartment, cross
 *   compartment, or a fail-closed missing rule)
 */
export type CorrelationRiskLevel = 'none' | 'low' | 'medium' | 'high';

/**
 * Action the caller MUST apply for a {@link PrivacyBoundaryDecision}.
 *
 * - `allow`            — proceed; reuse/rotation is left to the routing decision
 * - `rotate_session`   — force a fresh session before executing (anti-correlation)
 * - `require_approval` — defer to the human approval queue; do NOT execute now
 * - `block`            — refuse outright; no session, no execution
 */
export type PrivacyBoundaryAction =
  | 'allow'
  | 'rotate_session'
  | 'require_approval'
  | 'block';

/**
 * A deterministic correlation signal surfaced during evaluation.
 *
 * - `same_compartment`          — source and target are the same compartment
 * - `cross_compartment`         — source and target differ (boundary crossing)
 * - `cross_tool_reuse`          — a session would be reused across tools when the
 *   policy forbids it
 * - `risk_escalation`           — the request's risk exceeds the rule's ceiling
 * - `strict_isolation_required` — routing demanded `strict` isolation
 * - `unknown_compartment`       — the target compartment is not recognised
 */
export type CorrelationSignal =
  | 'same_compartment'
  | 'cross_compartment'
  | 'cross_tool_reuse'
  | 'risk_escalation'
  | 'strict_isolation_required'
  | 'unknown_compartment';

/**
 * A single deterministic privacy boundary rule, keyed by
 * `(sourceCompartmentId, targetCompartmentId)`.
 *
 * A rule authorises a flow from a source compartment into a target compartment
 * up to `maxAllowedRisk`. Any correlation signal beyond that ceiling triggers
 * `actionOnViolation`. There is no implicit fallback: a missing rule is
 * fail-closed (the engine blocks).
 */
export interface PrivacyBoundaryRule {
  id: string;
  sourceCompartmentId: string;
  targetCompartmentId: string;
  maxAllowedRisk: CorrelationRiskLevel;
  actionOnViolation: PrivacyBoundaryAction;
}

/**
 * The deterministic outcome of evaluating a request against the boundary rules.
 *
 * It is pure metadata: the caller (e.g. the Local API boundary) is responsible
 * for actually rotating a session, enqueuing an approval, blocking, or
 * proceeding. The engine never performs any of those actions itself.
 */
export interface PrivacyBoundaryDecision {
  action: PrivacyBoundaryAction;
  riskLevel: CorrelationRiskLevel;
  signals: CorrelationSignal[];
  reason: string;
}

/**
 * A single boundary violation contributing to a {@link PrivacyBoundaryDecision}.
 *
 * Surfaced as a named contract so future anti-correlation work can reason about
 * individual violations uniformly. It carries NO secrets — only metadata.
 */
export interface BoundaryViolation {
  ruleId?: string;
  signal: CorrelationSignal;
  riskLevel: CorrelationRiskLevel;
  reason: string;
}

/**
 * Input to {@link PrivacyBoundaryEngine.evaluate}.
 *
 * Only metadata is consulted — never raw input payloads, secrets, or real
 * transport handles. `sourceCompartmentId` is optional: when omitted the request
 * is treated as self-access into the target compartment.
 */
export interface PrivacyBoundaryEvaluationInput {
  agentId: string;
  sourceCompartmentId?: string;
  targetCompartmentId: string;
  tool: CapabilityTool;
  riskLevel: RiskLevel;
  routingIsolationLevel?: IsolationLevel;
  allowCrossToolReuse?: boolean;
  previousTool?: CapabilityTool;
}

/**
 * Reason a {@link PrivacyBoundaryEngine} registration could not complete.
 *
 * - `duplicate_rule` — a rule for the same `(source, target)` pair, or with the
 *   same `id`, is already registered; there is no silent overwrite.
 */
export type PrivacyBoundaryErrorKind = 'duplicate_rule';
