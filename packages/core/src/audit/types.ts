/**
 * Capability Execution Audit Trail & Security Event Engine MVP — core
 * primitives and contracts.
 *
 * Sprint 11 introduces the first structured audit trail and runtime security
 * event engine. A {@link SecurityEvent} is a normalised, defensive record of a
 * single security-relevant moment in the request lifecycle (firewall decision,
 * routing resolution, privacy boundary action, sandbox verdict, execution
 * outcome, session lifecycle, approval decision).
 *
 * Hard constraints (Sprint 11 MVP): everything here is purely in-memory and
 * side-effect free. NO database, NO Redis, NO file writes, NO network, NO
 * fetch / DNS / socket, NO browser, NO durable persistence, and NO cloud
 * telemetry. Events carry only minimal, secret-free metadata: an event must
 * NEVER contain an approval token, secret, credential, raw HTTP header, raw
 * environment, raw stack trace, or raw request input.
 *
 * The types are deliberately self-contained and agnostic — no coupling to any
 * specific business product, persistence, browser, or real transport.
 */

/**
 * Severity of a {@link SecurityEvent}, from least to most urgent.
 *
 * - `debug`    — fine-grained lifecycle trace
 * - `info`     — a normal, expected security event (allow, route, succeed)
 * - `warning`  — a defensive refusal (deny, block) or notable deviation
 * - `critical` — an event that demands operator attention
 */
export type EventSeverity = 'debug' | 'info' | 'warning' | 'critical';

/**
 * The normalised vocabulary of security events GRL can record.
 *
 * The set is deliberately closed: every emission site maps to exactly one of
 * these types so the audit trail stays analysable. New event kinds are added by
 * extending this union, never by inventing free-form strings.
 */
export type SecurityEventType =
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
  | 'adaptive_defense_triggered';

/**
 * A single, immutable security event.
 *
 * `id` and `timestamp` are assigned by the {@link SecurityEventEngine} at emit
 * time. The correlation fields (`agentId`, `compartmentId`, `sessionId`,
 * `requestId`, `executionId`, `approvalRequestId`) are all optional so an event
 * can be tied to whatever context is available without ever requiring secrets.
 *
 * `metadata` MUST stay minimal and secret-free (decision reason, tool, risk
 * level, transport kind, sandbox violation codes, routing reason, privacy
 * signals, execution status, and at most `inputType`/`inputSizeBytes`). It must
 * NEVER carry a token, secret, raw header, raw env, raw stack trace, or raw
 * input.
 */
export interface SecurityEvent {
  id: string;
  timestamp: number;
  type: SecurityEventType;
  severity: EventSeverity;

  agentId?: string;
  compartmentId?: string;
  sessionId?: string;
  requestId?: string;
  executionId?: string;
  approvalRequestId?: string;

  message: string;

  metadata?: Record<string, unknown>;
}

/** A single entry in the audit trail, wrapping one {@link SecurityEvent}. */
export interface AuditTrailEntry {
  event: SecurityEvent;
}

/**
 * Filter applied when querying the audit trail.
 *
 * All fields are optional and combined with AND semantics. `since`/`until` are
 * inclusive timestamp bounds; `limit` caps the number of returned events (taken
 * from the start of the stable ordering — timestamp ascending, then insertion).
 */
export interface AuditQuery {
  type?: SecurityEventType;
  severity?: EventSeverity;
  agentId?: string;
  compartmentId?: string;
  sessionId?: string;
  requestId?: string;
  executionId?: string;
  since?: number;
  until?: number;
  limit?: number;
}
