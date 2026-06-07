/**
 * Explicit HTTP contracts for the GRL Local API boundary.
 *
 * These types describe the wire format of the local API only. They are kept
 * deliberately separate from the core capability types so that internal details
 * (transport resolution, session identity, policy internals) are never leaked
 * over HTTP. The agent talks to this boundary; the boundary talks to the
 * Capability Firewall.
 */

/**
 * Request body for `POST /v1/capabilities/evaluate`.
 *
 * `riskLevel` and `input` are typed loosely on purpose: validation happens at
 * the boundary before the request reaches the firewall.
 */
export interface EvaluateCapabilityHttpRequest {
  agentId: string;
  compartmentId: string;
  tool: string;
  riskLevel: string;
  input: unknown;
}

/**
 * Response body for `POST /v1/capabilities/evaluate`.
 *
 * Returned with HTTP 200 for any successful firewall evaluation — including a
 * deny. `sanitizedInput` is only present when the capability is allowed.
 */
export interface EvaluateCapabilityHttpResponse {
  allowed: boolean;
  reason: string;
  requiresConfirmation: boolean;
  sanitizedInput?: unknown;
  delayMs?: number;
}

/** Response body for `GET /v1/health`. */
export interface HealthHttpResponse {
  status: 'ok';
  service: 'grl-server';
}

/** Uniform error envelope for invalid HTTP requests (4xx/5xx, never a deny). */
export interface HttpErrorResponse {
  error: string;
}

/**
 * Request body for `POST /v1/capabilities/request`.
 *
 * Structurally identical to the evaluate request: the boundary runs the same
 * firewall, then routes an allowed-but-confirmation-required decision into the
 * human approval queue instead of returning it directly.
 */
export type RequestCapabilityHttpRequest = EvaluateCapabilityHttpRequest;

/** Top-level decision returned by `POST /v1/capabilities/request`. */
export type CapabilityRequestDecision = 'allowed' | 'denied' | 'pending';

/**
 * Response body for `POST /v1/capabilities/request`.
 *
 * - `allowed` — firewall permitted the capability; `sanitizedInput` is present
 * - `denied`  — firewall refused the capability
 * - `pending` — firewall permitted it but flagged confirmation; an approval
 *   request was enqueued. `approvalRequestId` and `approvalToken` are returned
 *   exactly once. The token is NEVER returned again by any other endpoint.
 */
export interface RequestCapabilityHttpResponse {
  decision: CapabilityRequestDecision;
  reason: string;
  sanitizedInput?: unknown;
  delayMs?: number;
  approvalRequestId?: string;
  approvalToken?: string;
}

/**
 * Public, token-free view of a pending approval request.
 *
 * Returned by `GET /v1/approvals/pending`. It deliberately omits the secret
 * approval token, which is only ever surfaced once at creation time.
 */
export interface PendingApprovalView {
  id: string;
  createdAt: number;
  expiresAt: number;
  agentId: string;
  compartmentId: string;
  tool: string;
  riskLevel: string;
  reason: string;
  status: 'pending';
}

/** Response body for `GET /v1/approvals/pending`. */
export interface PendingApprovalsHttpResponse {
  pending: PendingApprovalView[];
}

/** Request body for `POST /v1/approvals/:id/approve` and `.../reject`. */
export interface ApprovalDecisionHttpRequest {
  token: string;
}

/** Response body for a successful approve/reject (HTTP 200). */
export interface ApprovalDecisionHttpResponse {
  id: string;
  status: 'approved' | 'rejected';
}

/**
 * Request body for `POST /v1/capabilities/execute-mock`.
 *
 * Structurally identical to the evaluate/request bodies: the boundary runs the
 * same firewall, then — only when allowed without confirmation — executes the
 * request through the mock transport. This endpoint is mock-only and never
 * performs any real network egress.
 */
export type ExecuteMockCapabilityHttpRequest = EvaluateCapabilityHttpRequest;

/**
 * Public, transport-safe view of an execution result returned by
 * `POST /v1/capabilities/execute-mock` when a capability is allowed.
 */
export interface ExecutionResultView {
  status: 'success' | 'blocked' | 'failed';
  transportKind: 'mock' | 'direct' | 'tor' | 'proxy' | 'searxng' | 'browser';
  output?: unknown;
  error?: string;
}

/**
 * Public view of the routing decision the Transport Policy Engine produced for
 * an allowed execution. Pure metadata — no secrets, no transport configuration.
 */
export interface RoutingDecisionView {
  transportKind: 'mock' | 'direct' | 'tor' | 'proxy' | 'searxng' | 'browser';
  shouldRotateSession: boolean;
  isolationLevel: 'none' | 'session' | 'compartment' | 'strict';
  reason:
    | 'default_transport'
    | 'forced_rotation'
    | 'strict_isolation'
    | 'risk_escalation'
    | 'reuse_allowed';
}

/**
 * Response body for `POST /v1/capabilities/execute-mock`.
 *
 * - `denied`  — firewall refused the capability; NO execution happened
 * - `pending` — firewall flagged confirmation; an approval request was enqueued
 *   and NO execution happened. `approvalRequestId`/`approvalToken` are returned
 *   exactly once.
 * - `allowed` — firewall permitted it; the Transport Policy Engine produced a
 *   `routing` decision and the request was executed through the mock transport,
 *   with `execution` carrying the result.
 */

/**
 * Temporal obfuscation metadata attached to the execute-mock response.
 * Carries only delay/risk metadata — never raw input or tokens.
 */
export interface TemporalObfuscationView {
  cadenceRisk: 'low' | 'medium' | 'high' | 'critical';
  delayMs: number;
  requiresCadenceSmoothing: boolean;
  requiresBurstFragmentation: boolean;
  requiresSchedulingEscalation: boolean;
  detectedBursts: number;
  smoothedRequests: number;
  budgetConsumed: number;
  budgetRemaining: number;
  reason: string;
}
export interface ExecuteMockCapabilityHttpResponse {
  decision: CapabilityRequestDecision;
  reason: string;
  defense?: DefenseDecisionView;
  capabilityGraph?: CapabilityPathDecisionView;
  trust?: TrustView;
  routing?: RoutingDecisionView;
  privacyBoundary?: PrivacyBoundaryDecisionView;
  sandbox?: SandboxDecisionView;
  execution?: ExecutionResultView;
  approvalRequestId?: string;
  approvalToken?: string;
  temporalObfuscation?: TemporalObfuscationView;
  fingerprint?: {
    activeFingerprintId: string;
    rotationCount: number;
    correlationRisk: string;
    rotated: boolean;
  };
  runtimePolicy?: CompositeRuntimeDecisionView;
  networkIsolation?: NetworkIsolationDecisionView;
}

/** Trust level band a compartment falls into (Sprint 14). */
export type TrustLevelView =
  | 'trusted'
  | 'neutral'
  | 'restricted'
  | 'quarantined';

/**
 * Public, secret-free view of a compartment's current trust standing attached to
 * an execute-mock response and returned by the `/v1/trust` read endpoints. Pure
 * metadata — never a token, secret, or raw request input.
 */
export interface TrustView {
  compartmentId: string;
  score: number;
  level: TrustLevelView;
}

/** Active defensive action surfaced on an execute-mock response. */
export type DefenseActionView =
  | 'allow'
  | 'cooldown'
  | 'temporary_block'
  | 'require_approval'
  | 'escalate_risk';

/** Which engine produced a defense decision. */
export type DefenseSourceView = 'rate_limit' | 'adaptive_defense';

/** Risk level used in a dynamic risk escalation. */
export type RiskLevelView = 'low' | 'medium' | 'high';

/**
 * Public, secret-free view of a dynamic risk escalation applied before the
 * firewall. Pure metadata — no secrets, no raw input.
 */
export interface RiskEscalationView {
  originalRisk: RiskLevelView;
  escalatedRisk: RiskLevelView;
  reason: string;
}

/**
 * Public, secret-free view of the active defense decision (rate limiter or
 * adaptive defense engine) attached to an execute-mock response.
 *
 * It carries only normalised defense metadata — NEVER a token, secret, raw
 * header, raw environment, raw stack trace, or raw request input.
 */
export interface DefenseDecisionView {
  action: DefenseActionView;
  source: DefenseSourceView;
  reason: string;
  retryAfterMs?: number;
  escalation?: RiskEscalationView;
}

/**
 * Public, secret-free view of a registered rate-limit policy.
 *
 * Returned by `GET /v1/defense/rate-limits`. Pure configuration metadata.
 */
export interface RateLimitPolicyView {
  id: string;
  scope: 'agent' | 'compartment' | 'session' | 'tool';
  maxRequests: number;
  windowMs: number;
  action: DefenseActionView;
  enabled: boolean;
}

/** Response body for `GET /v1/defense/rate-limits`. */
export interface RateLimitPoliciesHttpResponse {
  policies: RateLimitPolicyView[];
}

/**
 * Public, secret-free view of a temporary capability block.
 *
 * Returned by `GET /v1/defense/temporary-blocks`. Pure metadata — never a
 * token, secret, or raw request input.
 */
export interface TemporaryCapabilityBlockView {
  id: string;
  createdAt: number;
  expiresAt: number;
  agentId?: string;
  compartmentId?: string;
  tool?: string;
  reason: string;
}

/** Response body for `GET /v1/defense/temporary-blocks`. */
export interface TemporaryBlocksHttpResponse {
  blocks: TemporaryCapabilityBlockView[];
}

/**
 * Public, secret-free view of a registered adaptive defense policy.
 *
 * Returned by `GET /v1/defense/adaptive-policies`. Pure configuration metadata.
 */
export interface AdaptiveDefensePolicyView {
  id: string;
  triggerAnomalyTypes: string[];
  triggerIncidentSeverities: string[];
  resultingAction: DefenseActionView;
  cooldownMs?: number;
  escalationRiskLevel?: RiskLevelView;
  enabled: boolean;
}

/** Response body for `GET /v1/defense/adaptive-policies`. */
export interface AdaptiveDefensePoliciesHttpResponse {
  policies: AdaptiveDefensePolicyView[];
}

/**
 * Public, secret-free view of an Identity Compartment.
 *
 * Returned by `GET /v1/compartments`. A compartment carries no secrets,
 * credentials, or real transport configuration — only lifecycle metadata.
 */
export interface CompartmentView {
  id: string;
  label?: string;
  transportKind: 'mock' | 'direct' | 'tor' | 'proxy' | 'searxng' | 'browser';
  reusePolicy: 'reuse_active' | 'always_rotate';
  ttlMs: number;
  maxRequests: number;
  createdAt: number;
}

/** Response body for `GET /v1/compartments`. */
export interface CompartmentsHttpResponse {
  compartments: CompartmentView[];
}

/**
 * Public, secret-free view of a session.
 *
 * Returned by `GET /v1/sessions`. It exposes only session lifecycle metadata —
 * never a token, credential, or transport handle.
 */
export interface SessionView {
  sessionId: string;
  compartmentId: string;
  transportKind: 'mock' | 'direct' | 'tor' | 'proxy' | 'searxng' | 'browser';
  status: 'active' | 'rotated' | 'expired' | 'revoked';
  createdAt: number;
  expiresAt: number;
  requestCount: number;
  lastUsedAt?: number;
}

/** Response body for `GET /v1/sessions`. */
export interface SessionsHttpResponse {
  sessions: SessionView[];
}

/**
 * Public, secret-free view of an isolation policy.
 *
 * Returned (nested) by `GET /v1/transport-policies`. Pure metadata.
 */
export interface IsolationPolicyView {
  level: 'none' | 'session' | 'compartment' | 'strict';
  forceRotateOnHighRisk: boolean;
  forbidSessionReuse: boolean;
  allowCrossToolReuse: boolean;
}

/**
 * Public, secret-free view of a transport policy rule.
 *
 * Returned by `GET /v1/transport-policies`. It exposes only the routing/
 * isolation metadata of a rule — never a secret or real transport handle.
 */
export interface TransportPolicyRuleView {
  tool: string;
  riskLevel: string;
  preferredTransport: 'mock' | 'direct' | 'tor' | 'proxy' | 'searxng' | 'browser';
  isolationPolicy: IsolationPolicyView;
}

/** Response body for `GET /v1/transport-policies`. */
export interface TransportPoliciesHttpResponse {
  rules: TransportPolicyRuleView[];
}

/**
 * Public view of the privacy boundary decision the engine produced for a
 * request. Pure metadata — no secrets, no compartment data, no transport handle.
 */
export interface PrivacyBoundaryDecisionView {
  action: 'allow' | 'rotate_session' | 'require_approval' | 'block';
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  signals: Array<
    | 'same_compartment'
    | 'cross_compartment'
    | 'cross_tool_reuse'
    | 'risk_escalation'
    | 'strict_isolation_required'
    | 'unknown_compartment'
  >;
  reason?: string;
}

/**
 * Public, secret-free view of a privacy boundary rule.
 *
 * Returned by `GET /v1/privacy-boundaries`. It exposes only the correlation /
 * boundary metadata of a rule — never a secret or real compartment payload.
 */
export interface PrivacyBoundaryRuleView {
  id: string;
  sourceCompartmentId: string;
  targetCompartmentId: string;
  maxAllowedRisk: 'none' | 'low' | 'medium' | 'high';
  actionOnViolation: 'allow' | 'rotate_session' | 'require_approval' | 'block';
}

/** Response body for `GET /v1/privacy-boundaries`. */
export interface PrivacyBoundariesHttpResponse {
  rules: PrivacyBoundaryRuleView[];
}

/** Sandbox permission labels declared by a manifest / granted by a policy. */
export type AdapterSandboxPermissionView =
  | 'execute_mock'
  | 'network_disabled'
  | 'network_explicit_allowed'
  | 'no_filesystem'
  | 'no_process_spawn'
  | 'no_env_access';

/**
 * Public, secret-free view of a registered transport manifest.
 *
 * Returned by `GET /v1/transports`. It exposes only the declared capability
 * surface of an adapter — never a secret, credential, token, or real transport
 * endpoint/configuration.
 */
export interface TransportManifestView {
  kind: 'mock' | 'direct' | 'tor' | 'proxy' | 'searxng' | 'browser';
  name: string;
  version: string;
  supportedTools: string[];
  declaredPermissions: AdapterSandboxPermissionView[];
  networkAccess: boolean;
  browserAccess: boolean;
  filesystemAccess: boolean;
  processSpawnAccess: boolean;
  envAccess: boolean;
}

/** Response body for `GET /v1/transports`. */
export interface TransportsHttpResponse {
  transports: TransportManifestView[];
}

/**
 * Public, secret-free view of a transport's capability-audit surface.
 *
 * Returned by `GET /v1/transports/audit`. Pure metadata — no secrets.
 */
export interface TransportCapabilityAuditView {
  kind: 'mock' | 'direct' | 'tor' | 'proxy' | 'searxng' | 'browser';
  supportedTools: string[];
  declaredPermissions: AdapterSandboxPermissionView[];
  networkAccess: boolean;
  browserAccess: boolean;
  filesystemAccess: boolean;
  processSpawnAccess: boolean;
  envAccess: boolean;
}

/** Response body for `GET /v1/transports/audit`. */
export interface TransportsAuditHttpResponse {
  audit: TransportCapabilityAuditView[];
}

/** Public view of a single sandbox violation. */
export interface SandboxViolationView {
  code:
    | 'transport_not_registered'
    | 'tool_not_supported'
    | 'permission_not_allowed'
    | 'network_not_allowed'
    | 'browser_not_allowed'
    | 'filesystem_not_allowed'
    | 'process_spawn_not_allowed'
    | 'env_access_not_allowed';
  reason: string;
}

/**
 * Public view of the sandbox decision the registry produced for an execution.
 * Pure metadata — no secrets, no transport configuration.
 */
export interface SandboxDecisionView {
  action: 'allow' | 'block';
  violations: SandboxViolationView[];
}

/** Severity of an audited security event. */
export type EventSeverityView = 'debug' | 'info' | 'warning' | 'critical';

/** Normalised type of an audited security event. */
export type SecurityEventTypeView =
  | 'capability_allowed'
  | 'capability_denied'
  | 'approval_pending'
  | 'approval_approved'
  | 'approval_rejected'
  | 'privacy_boundary_blocked'
  | 'privacy_boundary_rotation'
  | 'routing_resolved'
  | 'session_created'
  | 'session_rotated'
  | 'session_revoked'
  | 'sandbox_allowed'
  | 'sandbox_blocked'
  | 'execution_started'
  | 'execution_succeeded'
  | 'execution_blocked'
  | 'execution_failed'
  | 'rate_limit_triggered'
  | 'cooldown_applied'
  | 'temporary_block_applied'
  | 'risk_escalated'
  | 'adaptive_defense_triggered'
  | 'trust_score_changed'
  | 'compartment_restricted'
  | 'compartment_quarantined'
  | 'trust_recovered'
  | 'capability_graph_allowed'
  | 'capability_graph_blocked'
  | 'capability_graph_approval_required'
  | 'capability_graph_rotation_required'
  | 'config_loaded'
  | 'config_reloaded'
  | 'config_reload_failed'
  | 'config_validation_failed'
  | 'runtime_profile_loaded'
  | 'runtime_profile_switched'
  | 'runtime_profile_switch_failed'
  | 'policy_pack_applied'
  | 'agent_registered'
  | 'agent_restricted'
  | 'agent_quarantined'
  | 'agent_evicted'
  | 'agent_quota_exceeded'
  | 'agent_lease_acquired'
  | 'agent_lease_expired'
  | 'behavior_fragment_created'
  | 'behavior_fragment_rotated'
  | 'behavior_correlation_detected'
  | 'behavioral_jitter_applied'
  | 'behavioral_privacy_escalated'
  | 'persona_created'
  | 'persona_rotated'
  | 'persona_isolation_escalated'
  | 'persona_fragment_bound'
  | 'interest_segmentation_triggered'
  | 'temporal_spacing_applied'
  | 'burst_detected'
  | 'temporal_budget_exhausted'
  | 'temporal_scheduling_escalated'
  | 'cadence_smoothing_applied'
  | 'fingerprint_assigned'
  | 'fingerprint_rotated'
  | 'header_isolation_applied'
  | 'language_isolation_applied'
  | 'user_agent_rotated'
  | 'runtime_policy_evaluated'
  | 'runtime_policy_conflict_detected'
  | 'runtime_policy_decision_applied'
  | 'runtime_policy_signal_evicted'
  | 'relay_route_assigned'
  | 'relay_route_rotated'
  | 'network_isolation_enforced'
  | 'network_isolation_denied';

/**
 * Public, secret-free view of a recorded security event.
 *
 * Returned by `GET /v1/audit/events` and `GET /v1/audit/events/:id`. It carries
 * only normalised, minimal metadata — NEVER an approval token, secret, raw HTTP
 * header, raw environment, raw stack trace, or raw request input.
 */
export interface SecurityEventView {
  id: string;
  timestamp: number;
  type: SecurityEventTypeView;
  severity: EventSeverityView;
  agentId?: string;
  compartmentId?: string;
  sessionId?: string;
  requestId?: string;
  executionId?: string;
  approvalRequestId?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

/** Response body for `GET /v1/audit/events`. */
export interface AuditEventsHttpResponse {
  events: SecurityEventView[];
}

/** Response body for `GET /v1/audit/events/:id`. */
export interface AuditEventHttpResponse {
  event: SecurityEventView;
}

/** Coarse, ordered security score of a runtime anomaly. */
export type SecurityScoreView = 'low' | 'medium' | 'high' | 'critical';

/** Normalised type of a runtime anomaly. */
export type RuntimeAnomalyTypeView =
  | 'repeated_denied_capabilities'
  | 'sandbox_violation_attempts'
  | 'privacy_boundary_violations'
  | 'rapid_session_rotation'
  | 'high_risk_execution_pattern'
  | 'approval_rejection_pattern';

/**
 * Public, secret-free view of a detected runtime anomaly.
 *
 * Returned by `GET /v1/security/anomalies`. It carries only normalised,
 * minimal metadata (anomaly/event types, counts, severities, timestamps, ids) —
 * NEVER an approval token, secret, raw HTTP header, raw environment, raw stack
 * trace, or raw request input.
 */
export interface RuntimeAnomalyView {
  id: string;
  createdAt: number;
  type: RuntimeAnomalyTypeView;
  score: SecurityScoreView;
  relatedEventIds: string[];
  summary: string;
  metadata?: Record<string, unknown>;
}

/** Response body for `GET /v1/security/anomalies`. */
export interface RuntimeAnomaliesHttpResponse {
  anomalies: RuntimeAnomalyView[];
}

/** Severity of a runtime incident. */
export type IncidentSeverityView = 'info' | 'warning' | 'critical';

/** Lifecycle status of a runtime incident. */
export type IncidentStatusView = 'open' | 'closed';

/**
 * Public, secret-free view of a runtime incident.
 *
 * Returned by `GET /v1/security/incidents`, `GET /v1/security/incidents/:id`,
 * and `POST /v1/security/incidents/:id/close`. Pure correlation metadata — no
 * secrets, tokens, or raw input.
 */
export interface RuntimeIncidentView {
  id: string;
  createdAt: number;
  updatedAt: number;
  severity: IncidentSeverityView;
  status: IncidentStatusView;
  anomalyIds: string[];
  relatedEventIds: string[];
  summary: string;
}

/** Response body for `GET /v1/security/incidents`. */
export interface RuntimeIncidentsHttpResponse {
  incidents: RuntimeIncidentView[];
}

/**
 * Response body for `GET /v1/security/incidents/:id` and
 * `POST /v1/security/incidents/:id/close`.
 */
export interface RuntimeIncidentHttpResponse {
  incident: RuntimeIncidentView;
}

/**
 * Public, secret-free view of a single scored reputation event (Sprint 14).
 *
 * Returned by `GET /v1/trust/events`. Pure correlation metadata — never a token,
 * secret, raw header, raw environment, raw stack trace, or raw request input.
 */
export interface ReputationEventView {
  id: string;
  createdAt: number;
  compartmentId: string;
  type: string;
  delta: number;
  reason: string;
  relatedEventId?: string;
  relatedIncidentId?: string;
}

/**
 * Public, secret-free view of a compartment reputation profile (Sprint 14).
 *
 * Returned by `GET /v1/trust/profiles` and `GET /v1/trust/profiles/:id`. Pure
 * metadata: the bounded trust score, its level band, and the ordered event
 * history that shaped it. Never a token, secret, or raw request input.
 */
export interface ReputationProfileView {
  compartmentId: string;
  score: number;
  level: TrustLevelView;
  events: ReputationEventView[];
  createdAt: number;
  updatedAt: number;
}

/** Response body for `GET /v1/trust/profiles`. */
export interface ReputationProfilesHttpResponse {
  profiles: ReputationProfileView[];
}

/** Response body for `GET /v1/trust/profiles/:compartmentId`. */
export interface ReputationProfileHttpResponse {
  profile: ReputationProfileView;
}

/** Response body for `GET /v1/trust/events`. */
export interface ReputationEventsHttpResponse {
  events: ReputationEventView[];
}

/** Kind of an execution-capability graph node (Sprint 15). */
export type CapabilityNodeKindView =
  | 'request'
  | 'capability'
  | 'approval'
  | 'execution'
  | 'sandbox'
  | 'privacy_boundary';

/** Relation expressed by a capability graph edge (Sprint 15). */
export type CapabilityEdgeRelationView =
  | 'requested'
  | 'approved'
  | 'executed'
  | 'blocked'
  | 'depends_on'
  | 'transitioned_to';

/** Coarse, ordered risk classification of a whole execution path (Sprint 15). */
export type ExecutionPathRiskView = 'low' | 'medium' | 'high' | 'blocked';

/** Action a capability path decision carries (Sprint 15). */
export type CapabilityPathActionView =
  | 'allow'
  | 'require_approval'
  | 'force_rotation'
  | 'block';

/**
 * Public, secret-free view of a single execution-capability graph node.
 *
 * Returned by `GET /v1/capability-graph/nodes`. Pure metadata (kind, optional
 * agent / compartment / tool / risk level, timestamp) — never a token, secret,
 * or raw request input.
 */
export interface CapabilityNodeView {
  id: string;
  kind: CapabilityNodeKindView;
  agentId?: string;
  compartmentId?: string;
  tool?: string;
  riskLevel?: RiskLevelView;
  createdAt: number;
}

/**
 * Public, secret-free view of a single execution-capability graph edge.
 *
 * Returned by `GET /v1/capability-graph/edges`. Pure metadata — never a token,
 * secret, or raw request input.
 */
export interface CapabilityEdgeView {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relation: CapabilityEdgeRelationView;
  createdAt: number;
}

/**
 * Public, secret-free view of a capability transition rule.
 *
 * Returned by `GET /v1/capability-graph/transition-rules`. Pure configuration
 * metadata.
 */
export interface CapabilityTransitionRuleView {
  id: string;
  fromTool: string;
  toTool: string;
  maxAllowedRisk: ExecutionPathRiskView;
  actionOnViolation: CapabilityPathActionView;
  enabled: boolean;
}

/**
 * Public, secret-free view of a dependency-isolation policy.
 *
 * Returned by `GET /v1/capability-graph/isolation-policies`. Pure configuration
 * metadata.
 */
export interface DependencyIsolationPolicyView {
  id: string;
  compartmentId: string;
  maxPathLength: number;
  forbidCrossToolEscalation: boolean;
  requireApprovalOnToolChange: boolean;
  blockOnHighRiskPath: boolean;
  enabled: boolean;
}

/**
 * Public, secret-free view of a capability path decision attached to an
 * execute-mock response (Sprint 15). Pure normalised metadata — never a token,
 * secret, or raw request input.
 */
export interface CapabilityPathDecisionView {
  action: CapabilityPathActionView;
  risk: ExecutionPathRiskView;
  reason: string;
  relatedNodeIds: string[];
  relatedEdgeIds: string[];
}

/** Response body for `GET /v1/capability-graph/nodes`. */
export interface CapabilityGraphNodesHttpResponse {
  nodes: CapabilityNodeView[];
}

/** Response body for `GET /v1/capability-graph/edges`. */
export interface CapabilityGraphEdgesHttpResponse {
  edges: CapabilityEdgeView[];
}

/** Response body for `GET /v1/capability-graph/transition-rules`. */
export interface CapabilityGraphTransitionRulesHttpResponse {
  transitionRules: CapabilityTransitionRuleView[];
}

/** Response body for `GET /v1/capability-graph/isolation-policies`. */
export interface CapabilityGraphIsolationPoliciesHttpResponse {
  isolationPolicies: DependencyIsolationPolicyView[];
}

// ---------------------------------------------------------------------------
// Sprint 16 — Runtime configuration read/reload surface.
//
// These responses expose only secret-free policy metadata derived from the
// active RuntimeConfigSnapshot. They NEVER carry a token, secret, credential,
// or raw request input — a RuntimeConfig is pure policy data.
// ---------------------------------------------------------------------------

/**
 * Response body for `GET /v1/runtime/config`.
 *
 * `config` is the full active {@link import('../../../packages/core/src/index.js').RuntimeConfig}
 * — deterministic policy metadata only.
 */
export interface RuntimeConfigHttpResponse {
  version: number;
  loadedAt: number;
  checksum: string;
  config: import('../../../packages/core/src/index.js').RuntimeConfig;
}

/** Response body for `GET /v1/runtime/config/checksum`. */
export interface RuntimeConfigChecksumHttpResponse {
  checksum: string;
}

/** Response body for `GET /v1/runtime/config/version`. */
export interface RuntimeConfigVersionHttpResponse {
  version: number;
}

/** Response body for `POST /v1/runtime/reload` — new snapshot metadata only. */
export interface RuntimeReloadHttpResponse {
  version: number;
  loadedAt: number;
  checksum: string;
}

// ---------------------------------------------------------------------------
// Sprint 17 — Real execution endpoint (POST /v1/capabilities/execute).
//
// Differs from execute-mock: uses real transport routing configured at runtime.
// Falls back to mock when no real transport is configured.
// ---------------------------------------------------------------------------

/**
 * Request body for `POST /v1/capabilities/execute`.
 *
 * Structurally identical to the execute-mock request: the same validation and
 * firewall pipeline runs; only the transport selection differs.
 */
export type ExecuteCapabilityHttpRequest = EvaluateCapabilityHttpRequest;

/**
 * Response body for `POST /v1/capabilities/execute`.
 *
 * Identical shape to {@link ExecuteMockCapabilityHttpResponse} but explicitly
 * named for the real execute endpoint. The `transportKind` field in the
 * execution block will be `"searxng"` when a real transport is used.
 */
export type ExecuteCapabilityHttpResponse = ExecuteMockCapabilityHttpResponse;

// ---------------------------------------------------------------------------
// Sprint 20 — Policy Packs & Runtime Profiles surface.
//
// These responses expose only secret-free profile/pack metadata. They NEVER
// carry a token, secret, credential, or raw request input. The full resolved
// RuntimeConfig is NOT returned — only the profile name, pack ids, and a
// summary of the active configuration.
// ---------------------------------------------------------------------------

/**
 * Minimal view of a runtime profile returned by the API.
 *
 * Secret-free metadata only: name, description, inheritance, pack ids,
 * enabled state. The full `overrides` block is omitted to avoid leaking
 * internal policy state over HTTP.
 */
export interface RuntimeProfileView {
  name: string;
  description?: string;
  extends?: string;
  packIds: string[];
  enabled: boolean;
}

/**
 * Minimal view of a policy pack returned by the API.
 *
 * Secret-free metadata only: id, description, and the set of policy-field
 * names the pack defines (the actual policy values are NOT returned — they
 * contain no secrets but the shape is internal).
 */
export interface PolicyPackView {
  id: string;
  description?: string;
  /** Names of the RuntimeConfig fields this pack defines. */
  definedFields: string[];
}

/** Response body for `GET /v1/runtime/profiles`. */
export interface RuntimeProfilesHttpResponse {
  profiles: RuntimeProfileView[];
}

/** Response body for `GET /v1/runtime/profile` (active profile). */
export interface RuntimeProfileHttpResponse {
  profile: RuntimeProfileView;
}

/** Response body for `GET /v1/runtime/packs`. */
export interface RuntimePacksHttpResponse {
  packs: PolicyPackView[];
}

/** Response body for `POST /v1/runtime/profile/:name` (profile switch). */
export interface RuntimeProfileSwitchHttpResponse {
  profile: RuntimeProfileView;
  /** ISO-8601 timestamp of the switch. */
  switchedAt: number;
}



// ---------------------------------------------------------------------------
// Sprint 23 — Multi-Agent Runtime Isolation API contracts
// ---------------------------------------------------------------------------

/** Public, secret-free view of a single agent runtime. */
export interface AgentRuntimeView {
  agentId: string;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'idle' | 'restricted' | 'quarantined' | 'evicted';
  compartments: string[];
  trustScore: number;
  activeSessions: number;
  activeExecutions: number;
  quota: AgentQuotaView;
  lease?: AgentLeaseView;
}

/** Public view of agent quota (no sensitive data). */
export interface AgentQuotaView {
  maxConcurrentExecutions: number;
  maxSessions: number;
  maxApprovalsPending: number;
  maxAuditEvents: number;
  maxIncidents: number;
}

/** Public view of a runtime lease. */
export interface AgentLeaseView {
  id: string;
  acquiredAt: number;
  expiresAt: number;
  renewable: boolean;
  holderAgentId: string;
}

/** Public trust view for an agent. */
export interface AgentTrustView {
  agentId: string;
  trustScore: number;
  status: 'active' | 'idle' | 'restricted' | 'quarantined' | 'evicted';
}

/** Response body for `GET /v1/agents`. */
export interface AgentsHttpResponse {
  agents: AgentRuntimeView[];
}

/** Response body for `GET /v1/agents/:agentId`. */
export interface AgentHttpResponse {
  agent: AgentRuntimeView;
}

/** Response body for `GET /v1/agents/:agentId/leases`. */
export interface AgentLeasesHttpResponse {
  agentId: string;
  leases: AgentLeaseView[];
}

/** Response body for `GET /v1/agents/:agentId/sessions`. */
export interface AgentSessionsHttpResponse {
  agentId: string;
  activeSessions: number;
  maxSessions: number;
}

/** Response body for `GET /v1/agents/:agentId/trust`. */
export interface AgentTrustHttpResponse {
  trust: AgentTrustView;
}

/** Response body for `POST /v1/agents/:agentId/restrict`. */
export interface AgentRestrictHttpResponse {
  agentId: string;
  status: 'restricted';
  updatedAt: number;
}

/** Response body for `POST /v1/agents/:agentId/evict`. */
export interface AgentEvictHttpResponse {
  agentId: string;
  status: 'evicted';
  updatedAt: number;
}

// Sprint 24 — Behavioral Privacy API contracts
export interface BehavioralProfileView {
  agentId: string;
  createdAt: number;
  updatedAt: number;
  correlationRisk: 'low' | 'medium' | 'high' | 'critical';
  activeIdentityFragments: number;
  recentSearchTopics: string[];
  temporalPatternsDetected: number;
  repeatedBehaviorScore: number;
}

export interface BehavioralProfilesHttpResponse {
  profiles: BehavioralProfileView[];
}

export interface BehavioralProfileHttpResponse {
  profile: BehavioralProfileView;
}

export interface IdentityFragmentView {
  id: string;
  agentId: string;
  createdAt: number;
  expiresAt: number;
  isolatedSessionIds: string[];
  isolatedTransportKinds: string[];
  active: boolean;
  requestCount: number;
}

export interface IdentityFragmentsHttpResponse {
  fragments: IdentityFragmentView[];
}

export interface JitterPoliciesHttpResponse {
  jitterPolicy: {
    enabled: boolean;
    minDelayMs: number;
    maxDelayMs: number;
    adaptive: boolean;
  };
  fragmentationPolicy: {
    enabled: boolean;
    maxRequestsPerFragment: number;
    fragmentTtlMs: number;
    forceIsolationOnHighRisk: boolean;
  };
  correlationPolicy: {
    enabled: boolean;
    repeatedQueryThreshold: number;
    temporalPatternThreshold: number;
    maxBehaviorScore: number;
  };
}

// ---------------------------------------------------------------------------
// Sprint 25 — Persona Isolation API contracts
// ---------------------------------------------------------------------------

/** Public, secret-free view of a {@link SearchPersona}. */
export interface SearchPersonaView {
  id: string;
  agentId: string;
  createdAt: number;
  updatedAt: number;
  category: string;
  active: boolean;
  fragmentIds: string[];
  isolatedSessionIds: string[];
  searchCount: number;
  correlationRisk: 'low' | 'medium' | 'high' | 'critical';
}

/** Response body for `GET /v1/privacy/personas`. */
export interface PersonasHttpResponse {
  personas: SearchPersonaView[];
}

/** Response body for `GET /v1/privacy/personas/:agentId`. */
export interface PersonasByAgentHttpResponse {
  agentId: string;
  personas: SearchPersonaView[];
}

/** Public, secret-free view of a {@link PersonaFragmentBinding}. */
export interface PersonaFragmentBindingView {
  personaId: string;
  fragmentId: string;
  createdAt: number;
  active: boolean;
}

/** Response body for `GET /v1/privacy/persona-bindings`. */
export interface PersonaBindingsHttpResponse {
  bindings: PersonaFragmentBindingView[];
}

/** Response body for `GET /v1/privacy/persona-bindings/:agentId`. */
export interface PersonaBindingsByAgentHttpResponse {
  agentId: string;
  bindings: PersonaFragmentBindingView[];
}

/** Response body for `GET /v1/privacy/segmentation-policies`. */
export interface SegmentationPoliciesHttpResponse {
  segmentationPolicy: {
    enabled: boolean;
    maxSearchesPerPersona: number;
    forceRotationOnCategoryChange: boolean;
    isolateHighRiskCategories: boolean;
  };
}

// ---------------------------------------------------------------------------
// Sprint 26 — Temporal Obfuscation API contracts
// ---------------------------------------------------------------------------

/** Public, secret-free view of a temporal profile. */
export interface TemporalProfileView {
  agentId: string;
  createdAt: number;
  updatedAt: number;
  cadenceRisk: 'low' | 'medium' | 'high' | 'critical';
  recentExecutionTimestamps: number[];
  detectedBursts: number;
  smoothedRequests: number;
  temporalBudget: TemporalBudgetView;
  currentDelayMs: number;
}

/** Public view of a temporal privacy budget. */
export interface TemporalBudgetView {
  maxRequestsPerWindow: number;
  windowMs: number;
  consumed: number;
  remaining: number;
  resetsAt: number;
}

/** Response body for `GET /v1/privacy/temporal/profiles`. */
export interface TemporalProfilesHttpResponse {
  profiles: TemporalProfileView[];
}

/** Response body for `GET /v1/privacy/temporal/profiles/:agentId`. */
export interface TemporalProfileHttpResponse {
  profile: TemporalProfileView;
}

/** Response body for `GET /v1/privacy/temporal/budgets`. */
export interface TemporalBudgetsHttpResponse {
  budgets: TemporalBudgetView[];
}

/** Response body for `GET /v1/privacy/temporal/budgets/:agentId`. */
export interface TemporalBudgetHttpResponse {
  agentId: string;
  budget: TemporalBudgetView;
}

/** Response body for `GET /v1/privacy/temporal/policies`. */
export interface TemporalPoliciesHttpResponse {
  cadencePolicy: {
    enabled: boolean;
    minSpacingMs: number;
    adaptiveSpacing: boolean;
    burstPenaltyMs: number;
  };
  burstPolicy: {
    enabled: boolean;
    burstThreshold: number;
    burstWindowMs: number;
    cooldownMs: number;
  };
  budgetPolicy: {
    enabled: boolean;
    maxRequestsPerWindow: number;
    windowMs: number;
    forceDelayOnExhaustion: boolean;
  };
}


// ---------------------------------------------------------------------------
// Sprint 27 — Transport Fingerprint API contracts
// ---------------------------------------------------------------------------

/** Public, secret-free view of a fingerprint profile. */
export interface FingerprintProfileView {
  agentId: string;
  createdAt: number;
  updatedAt: number;
  activeFingerprintId: string;
  rotationCount: number;
  requestCount: number;
  correlationRisk: 'low' | 'medium' | 'high' | 'critical';
  assignedUserAgent: string;
  assignedLanguage: string;
}

/** Response body for `GET /v1/privacy/fingerprints`. */
export interface FingerprintProfilesHttpResponse {
  profiles: FingerprintProfileView[];
}

/** Response body for `GET /v1/privacy/fingerprints/:agentId`. */
export interface FingerprintProfileHttpResponse {
  agentId: string;
  profile: FingerprintProfileView;
}

/** Public view of a header profile. */
export interface HeaderProfileView {
  id: string;
  userAgent: string;
  acceptLanguage: string;
  createdAt: number;
  active: boolean;
}

/** Response body for `GET /v1/privacy/header-profiles`. */
export interface HeaderProfilesHttpResponse {
  profiles: HeaderProfileView[];
}

/** Response body for `GET /v1/privacy/header-policies`. */
export interface HeaderPoliciesHttpResponse {
  policy: {
    enabled: boolean;
    rotateOnPersonaChange: boolean;
    rotateOnTemporalEscalation: boolean;
    maxRequestsPerFingerprint: number;
    strictSensitiveCategoryIsolation: boolean;
  };
}

// ---------------------------------------------------------------------------
// Sprint 28 — Agent Runtime Policy Orchestrator & Composite Privacy Policies
// ---------------------------------------------------------------------------

/** Public, secret-free view of a PolicySignal. */
export interface PolicySignalView {
  id: string;
  source: string;
  action: string;
  severity: string;
  reason: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

/** Public, secret-free view of a PolicyConflict. */
export interface PolicyConflictView {
  id: string;
  signalIds: string[];
  conflictType: string;
  resolution: string;
  reason: string;
}

/** Public view of the CompositeRuntimeDecision (no raw input, no tokens). */
export interface CompositeRuntimeDecisionView {
  action: string;
  allowed: boolean;
  requiresDelay: boolean;
  delayMs?: number;
  requiresApproval: boolean;
  requiresSessionRotation: boolean;
  requiresFragmentRotation: boolean;
  requiresFingerprintRotation: boolean;
  requiresIdentityRotation: boolean;
  reason: string;
  signals: PolicySignalView[];
  conflicts: PolicyConflictView[];
}

/** Public view of a CompositePrivacyPolicy. */
export interface CompositePrivacyPolicyView {
  id: string;
  enabled: boolean;
  precedence: string[];
  defaultAction: string;
  failClosed: boolean;
  mergeStrategy: string;
}

/** Response body for `GET /v1/runtime/policy-orchestrator/policies`. */
export interface PolicyOrchestratorPoliciesHttpResponse {
  policies: CompositePrivacyPolicyView[];
}

/** Response body for `GET /v1/runtime/policy-orchestrator/signals`. */
export interface PolicyOrchestratorSignalsHttpResponse {
  signals: PolicySignalView[];
}

/** Response body for `GET /v1/runtime/policy-orchestrator/last-decision`. */
export interface PolicyOrchestratorLastDecisionHttpResponse {
  decision: CompositeRuntimeDecisionView | null;
}

// ---------------------------------------------------------------------------
// Sprint 30 — Privacy Transport Relay & Network Isolation Layer
//
// All views are metadata only. They NEVER carry an IP, host, URL, DNS name,
// endpoint, credential, token, or raw caller input. Relays and routes are
// opaque local identifiers.
// ---------------------------------------------------------------------------

/** Public view of a relay profile (no host / IP / endpoint). */
export interface RelayProfileView {
  id: string;
  name: string;
  enabled: boolean;
  isolationLevel: string;
  supportsDnsIsolation: boolean;
  tags: string[];
  createdAt: number;
}

/** Public view of a logical relay route (opaque id only). */
export interface RelayRouteView {
  id: string;
  relayProfileId: string;
  compartmentId?: string;
  personaId?: string;
  fragmentId?: string;
  assignedAt: number;
  active: boolean;
}

/** Public view of a compartment→route binding. */
export interface NetworkCompartmentBindingView {
  compartmentId: string;
  relayRouteId: string;
  isolationLevel: string;
  createdAt: number;
}

/** Public view of the DNS isolation policy (metadata model only). */
export interface DnsIsolationPolicyView {
  enabled: boolean;
  isolatePerCompartment: boolean;
  isolatePerPersona: boolean;
  isolatePerFragment: boolean;
}

/** Public view of the relay rotation policy. */
export interface RelayRotationPolicyView {
  enabled: boolean;
  rotateOnPersonaChange: boolean;
  rotateOnCategoryChange: boolean;
  rotateOnCriticalRisk: boolean;
  maxAssignmentsPerRoute: number;
}

/** Per-request network-isolation decision surfaced on execute responses. */
export interface NetworkIsolationDecisionView {
  allowed: boolean;
  relayProfileId?: string;
  relayRouteId?: string;
  isolationLevel: string;
  shouldRotate: boolean;
  reason: string;
}

/** Response body for `GET /v1/network/relays`. */
export interface NetworkRelaysHttpResponse {
  relays: RelayProfileView[];
}

/** Response body for `GET /v1/network/routes`. */
export interface NetworkRoutesHttpResponse {
  routes: RelayRouteView[];
}

/** Response body for `GET /v1/network/bindings`. */
export interface NetworkBindingsHttpResponse {
  bindings: NetworkCompartmentBindingView[];
}

/** Response body for `GET /v1/network/isolation` — runtime isolation policies. */
export interface NetworkIsolationHttpResponse {
  dnsPolicy: DnsIsolationPolicyView;
  rotationPolicy: RelayRotationPolicyView;
}
