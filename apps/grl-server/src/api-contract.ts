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
export interface ExecuteMockCapabilityHttpResponse {
  decision: CapabilityRequestDecision;
  reason: string;
  routing?: RoutingDecisionView;
  privacyBoundary?: PrivacyBoundaryDecisionView;
  sandbox?: SandboxDecisionView;
  execution?: ExecutionResultView;
  approvalRequestId?: string;
  approvalToken?: string;
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
