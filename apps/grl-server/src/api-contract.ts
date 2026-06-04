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
