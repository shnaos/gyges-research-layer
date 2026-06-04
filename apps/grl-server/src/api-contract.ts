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
