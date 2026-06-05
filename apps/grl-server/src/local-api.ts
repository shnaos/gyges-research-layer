import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  ApprovalQueue,
  ApprovalRequest,
  AuditQuery,
  CapabilityFirewall,
  CapabilityRequest,
  CapabilityTool,
  DEFAULT_APPROVAL_TTL_MS,
  ExecutionEngine,
  ExecutionRequest,
  IdentityCompartment,
  MockTransportAdapter,
  PrivacyBoundaryDecision,
  PrivacyBoundaryEngine,
  PrivacyBoundaryRule,
  RiskLevel,
  RoutingDecision,
  SandboxDecision,
  SecurityEvent,
  SecurityEventEngine,
  SecurityEventType,
  EventSeverity,
  SessionManager,
  SessionRecord,
  SessionReusePolicy,
  TransportCapabilityAudit,
  TransportCapabilityRegistry,
  TransportManifest,
  TransportPolicyEngine,
  TransportPolicyError,
  TransportPolicyRule,
  BOOTSTRAP_PRIVACY_BOUNDARY_RULES,
  BOOTSTRAP_TRANSPORT_MANIFESTS,
  BOOTSTRAP_TRANSPORT_POLICY_RULES,
  STRICT_SANDBOX_POLICY
} from '../../../packages/core/src/index.js';
import {
  PolicyDocument,
  PolicyRule,
  YamlPolicyEngine
} from '../../../packages/policy-engine/src/index.js';
import {
  ApprovalDecisionHttpResponse,
  AuditEventHttpResponse,
  AuditEventsHttpResponse,
  CompartmentsHttpResponse,
  CompartmentView,
  EvaluateCapabilityHttpRequest,
  EvaluateCapabilityHttpResponse,
  ExecuteMockCapabilityHttpResponse,
  ExecutionResultView,
  HealthHttpResponse,
  PendingApprovalsHttpResponse,
  PendingApprovalView,
  PrivacyBoundariesHttpResponse,
  PrivacyBoundaryDecisionView,
  PrivacyBoundaryRuleView,
  RequestCapabilityHttpResponse,
  RoutingDecisionView,
  SandboxDecisionView,
  SecurityEventView,
  SessionsHttpResponse,
  SessionView,
  TransportCapabilityAuditView,
  TransportManifestView,
  TransportPoliciesHttpResponse,
  TransportPolicyRuleView,
  TransportsAuditHttpResponse,
  TransportsHttpResponse
} from './api-contract.js';

/** Default local-only bind address. The server must never listen on 0.0.0.0. */
export const DEFAULT_HOST = '127.0.0.1';
/** Default local API port. */
export const DEFAULT_PORT = 8787;
/** Default maximum request body size (256 KiB) — generous for evaluate payloads. */
export const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

const VALID_RISK_LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high'];

/**
 * In-memory bootstrap policy for the Local API MVP.
 *
 * No persistence: this is the only policy the local server starts with. It maps
 * directly to deny-by-default firewall rules.
 *
 * - `low` is allowed without confirmation
 * - `medium`/`high` overflow the ceiling and are denied
 * - unknown agent / compartment / tool fall through to default-deny
 */
export const BOOTSTRAP_POLICY = {
  agentId: 'local-agent',
  compartmentId: 'research',
  allowedTools: ['search', 'fetch_html', 'fetch_json'],
  maxRiskLevel: 'low' as RiskLevel,
  requiresConfirmationAbove: 'low' as RiskLevel
} as const;

/**
 * In-memory bootstrap confirmation rule for the Approval Queue MVP.
 *
 * It deliberately lives ABOVE the deny ceiling of {@link BOOTSTRAP_POLICY} so
 * the human-in-the-loop path is reachable without weakening the existing
 * allow/deny behaviour: `fetch_html` at `medium` risk is allowed but flagged as
 * requiring confirmation, routing it into the approval queue.
 */
export const BOOTSTRAP_CONFIRMATION_RULE = {
  agentId: 'local-agent',
  compartmentId: 'research',
  tool: 'fetch_html' as CapabilityTool,
  maxRiskLevel: 'medium' as RiskLevel
} as const;

/** Build the deny-by-default policy engine from the in-memory bootstrap policy. */
export function buildBootstrapEngine(): YamlPolicyEngine {
  const rules: PolicyRule[] = BOOTSTRAP_POLICY.allowedTools.map((tool) => ({
    effect: 'allow',
    agentId: BOOTSTRAP_POLICY.agentId,
    compartment: BOOTSTRAP_POLICY.compartmentId,
    tool: tool as CapabilityTool,
    maxRiskLevel: BOOTSTRAP_POLICY.maxRiskLevel,
    transport: 'direct',
    requiresConfirmation: false
  }));
  // Appended after the low-risk rules so a low-risk request still matches the
  // no-confirmation rule first; only medium-risk fetch_html reaches this one.
  rules.push({
    effect: 'allow',
    agentId: BOOTSTRAP_CONFIRMATION_RULE.agentId,
    compartment: BOOTSTRAP_CONFIRMATION_RULE.compartmentId,
    tool: BOOTSTRAP_CONFIRMATION_RULE.tool,
    maxRiskLevel: BOOTSTRAP_CONFIRMATION_RULE.maxRiskLevel,
    transport: 'direct',
    requiresConfirmation: true
  });
  const policy: PolicyDocument = { defaultDeny: true, rules };
  return new YamlPolicyEngine(policy);
}

/** Build a Capability Firewall backed by the bootstrap policy. */
export function buildBootstrapFirewall(): CapabilityFirewall {
  return new CapabilityFirewall(buildBootstrapEngine());
}

/** Build an in-memory approval queue with the configured TTL. */
export function buildApprovalQueue(ttlMs?: number): ApprovalQueue {
  return new ApprovalQueue({ ttlMs: ttlMs ?? DEFAULT_APPROVAL_TTL_MS });
}

/**
 * Build the Sprint 6 execution engine wired with the mock transport ONLY.
 *
 * This engine performs no real network I/O: the single registered adapter is
 * the deterministic {@link MockTransportAdapter}. No `direct`/`tor`/`proxy`/
 * `searxng`/`browser` transport is registered.
 *
 * When a {@link TransportCapabilityRegistry} is supplied, the engine enforces
 * the Sprint 10 adapter sandbox ({@link STRICT_SANDBOX_POLICY}) BEFORE invoking
 * the adapter: an unregistered transport, an unsupported tool, or a sandbox
 * violation yields a `blocked` result and the adapter is never called.
 */
export function buildMockExecutionEngine(
  registry?: TransportCapabilityRegistry
): ExecutionEngine {
  return new ExecutionEngine({
    adapters: [new MockTransportAdapter()],
    ...(registry
      ? { registry, sandboxPolicy: STRICT_SANDBOX_POLICY }
      : {})
  });
}

/**
 * Build the Sprint 10 Transport Capability Registry seeded with the bootstrap
 * manifest(s).
 *
 * The registry is deterministic and purely in-memory: it declares the mock
 * transport's capability surface and evaluates the adapter sandbox. It NEVER
 * loads a plugin, reads a manifest from disk, touches a database, or performs
 * any real network / browser / filesystem / process work.
 */
export function buildBootstrapTransportRegistry(): TransportCapabilityRegistry {
  const registry = new TransportCapabilityRegistry();
  for (const manifest of BOOTSTRAP_TRANSPORT_MANIFESTS) {
    registry.registerManifest(manifest);
  }
  return registry;
}

/**
 * Build the Sprint 8 Transport Policy Engine seeded with the bootstrap rules.
 *
 * The engine is deterministic and fail-closed: it decides transport/rotation/
 * isolation only. It NEVER mints a session, opens a connection, or executes —
 * and it references only the `mock` transport. No real network I/O.
 */
export function buildBootstrapTransportPolicyEngine(): TransportPolicyEngine {
  const engine = new TransportPolicyEngine();
  for (const rule of BOOTSTRAP_TRANSPORT_POLICY_RULES) {
    engine.registerRule(rule);
  }
  return engine;
}

/**
 * Build the Sprint 9 Privacy Boundary Engine seeded with the bootstrap rules.
 *
 * The engine is deterministic and fail-closed: it decides anti-correlation /
 * privacy boundary actions only. It NEVER mints a session, rotates a session,
 * opens a connection, or executes — and it performs no real network, browser,
 * DNS, socket, persistence, or AI/semantic classification work.
 */
export function buildBootstrapPrivacyBoundaryEngine(): PrivacyBoundaryEngine {
  const engine = new PrivacyBoundaryEngine();
  for (const rule of BOOTSTRAP_PRIVACY_BOUNDARY_RULES) {
    engine.registerRule(rule);
  }
  return engine;
}

/**
 * Build the Sprint 11 Security Event Engine backing the audit trail.
 *
 * The engine is deterministic-by-default in tests (injectable clock + id
 * generator) and purely in-memory: it records normalised, secret-free
 * {@link SecurityEvent}s and serves them back over the read endpoints. It NEVER
 * writes a file, opens a socket / DNS / network connection, spawns a process,
 * persists durably, or performs cloud telemetry.
 */
export function buildSecurityEventEngine(): SecurityEventEngine {
  return new SecurityEventEngine();
}

/** Every valid {@link SecurityEventType}, used to validate audit query params. */
export const VALID_SECURITY_EVENT_TYPES: readonly SecurityEventType[] = [
  'capability_allowed',
  'capability_denied',
  'approval_pending',
  'approval_approved',
  'approval_rejected',
  'privacy_boundary_blocked',
  'privacy_boundary_rotation',
  'routing_resolved',
  'session_created',
  'session_rotated',
  'session_revoked',
  'sandbox_allowed',
  'sandbox_blocked',
  'execution_started',
  'execution_succeeded',
  'execution_blocked',
  'execution_failed'
];

/** Every valid {@link EventSeverity}, used to validate audit query params. */
export const VALID_EVENT_SEVERITIES: readonly EventSeverity[] = [
  'debug',
  'info',
  'warning',
  'critical'
];

/** Default session TTL (10 minutes) when `GRL_SESSION_TTL_MS` is unset. */
export const DEFAULT_SESSION_TTL_MS = 600_000;
/** Default per-session request ceiling when `GRL_SESSION_MAX_REQUESTS` is unset. */
export const DEFAULT_SESSION_MAX_REQUESTS = 25;
/** Default reuse policy when `GRL_SESSION_REUSE_POLICY` is unset. */
export const DEFAULT_SESSION_REUSE_POLICY: SessionReusePolicy = 'reuse_active';

/** Identity of the single statically-bootstrapped compartment. */
export const BOOTSTRAP_COMPARTMENT_ID = 'research';

export interface SessionBootstrapConfig {
  ttlMs: number;
  maxRequests: number;
  reusePolicy: SessionReusePolicy;
}

/**
 * Build the in-memory Session Manager for the Local API MVP.
 *
 * It registers exactly one static compartment (`research`). There is NO dynamic
 * compartment creation surface in this sprint: the manager keeps all state
 * in-memory and performs no persistence, no network, and no browser work. Its
 * sole job is to mint/reuse/rotate session *identities* for the mock transport.
 */
export function buildBootstrapSessionManager(
  config: SessionBootstrapConfig,
  now: () => number = Date.now
): SessionManager {
  const manager = new SessionManager(
    {
      defaultTtlMs: config.ttlMs,
      defaultMaxRequests: config.maxRequests
    },
    { now }
  );
  const compartment: IdentityCompartment = {
    id: BOOTSTRAP_COMPARTMENT_ID,
    label: 'Default research compartment',
    transportKind: 'mock',
    reusePolicy: config.reusePolicy,
    ttlMs: config.ttlMs,
    maxRequests: config.maxRequests,
    createdAt: now()
  };
  manager.registerCompartment(compartment);
  return manager;
}

/** Project an Identity Compartment into its public, secret-free HTTP view. */
function toCompartmentView(compartment: IdentityCompartment): CompartmentView {
  const view: CompartmentView = {
    id: compartment.id,
    transportKind: compartment.transportKind,
    reusePolicy: compartment.reusePolicy,
    ttlMs: compartment.ttlMs,
    maxRequests: compartment.maxRequests,
    createdAt: compartment.createdAt
  };
  if (compartment.label !== undefined) {
    view.label = compartment.label;
  }
  return view;
}

/** Project a Session Record into its public, secret-free HTTP view. */
function toSessionView(session: SessionRecord): SessionView {
  const view: SessionView = {
    sessionId: session.sessionId,
    compartmentId: session.compartmentId,
    transportKind: session.transportKind,
    status: session.status,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    requestCount: session.requestCount
  };
  if (session.lastUsedAt !== undefined) {
    view.lastUsedAt = session.lastUsedAt;
  }
  return view;
}

/** Project a Transport Policy Rule into its public, secret-free HTTP view. */
function toTransportPolicyRuleView(
  rule: TransportPolicyRule
): TransportPolicyRuleView {
  return {
    tool: rule.tool,
    riskLevel: rule.riskLevel,
    preferredTransport: rule.preferredTransport,
    isolationPolicy: {
      level: rule.isolationPolicy.level,
      forceRotateOnHighRisk: rule.isolationPolicy.forceRotateOnHighRisk,
      forbidSessionReuse: rule.isolationPolicy.forbidSessionReuse,
      allowCrossToolReuse: rule.isolationPolicy.allowCrossToolReuse
    }
  };
}

/** Project a RoutingDecision into its public HTTP view. */
function toRoutingDecisionView(decision: RoutingDecision): RoutingDecisionView {
  return {
    transportKind: decision.transportKind,
    shouldRotateSession: decision.shouldRotateSession,
    isolationLevel: decision.isolationLevel,
    reason: decision.reason
  };
}

/** Project a Privacy Boundary Rule into its public, secret-free HTTP view. */
function toPrivacyBoundaryRuleView(
  rule: PrivacyBoundaryRule
): PrivacyBoundaryRuleView {
  return {
    id: rule.id,
    sourceCompartmentId: rule.sourceCompartmentId,
    targetCompartmentId: rule.targetCompartmentId,
    maxAllowedRisk: rule.maxAllowedRisk,
    actionOnViolation: rule.actionOnViolation
  };
}

/** Project a PrivacyBoundaryDecision into its public HTTP view. */
function toPrivacyBoundaryDecisionView(
  decision: PrivacyBoundaryDecision
): PrivacyBoundaryDecisionView {
  return {
    action: decision.action,
    riskLevel: decision.riskLevel,
    signals: [...decision.signals],
    reason: decision.reason
  };
}

/** Project a Transport Manifest into its public, secret-free HTTP view. */
function toTransportManifestView(
  manifest: TransportManifest
): TransportManifestView {
  return {
    kind: manifest.kind,
    name: manifest.name,
    version: manifest.version,
    supportedTools: [...manifest.supportedTools],
    declaredPermissions: [...manifest.declaredPermissions],
    networkAccess: manifest.networkAccess,
    browserAccess: manifest.browserAccess,
    filesystemAccess: manifest.filesystemAccess,
    processSpawnAccess: manifest.processSpawnAccess,
    envAccess: manifest.envAccess
  };
}

/** Project a Transport Capability Audit into its public HTTP view. */
function toTransportCapabilityAuditView(
  entry: TransportCapabilityAudit
): TransportCapabilityAuditView {
  return {
    kind: entry.kind,
    supportedTools: [...entry.supportedTools],
    declaredPermissions: [...entry.declaredPermissions],
    networkAccess: entry.networkAccess,
    browserAccess: entry.browserAccess,
    filesystemAccess: entry.filesystemAccess,
    processSpawnAccess: entry.processSpawnAccess,
    envAccess: entry.envAccess
  };
}

/** Project a SandboxDecision into its public HTTP view. */
function toSandboxDecisionView(decision: SandboxDecision): SandboxDecisionView {
  return {
    action: decision.action,
    violations: decision.violations.map((violation) => ({
      code: violation.code,
      reason: violation.reason
    }))
  };
}

/** Project a recorded {@link SecurityEvent} into its public HTTP view. */
function toSecurityEventView(event: SecurityEvent): SecurityEventView {
  const view: SecurityEventView = {
    id: event.id,
    timestamp: event.timestamp,
    type: event.type,
    severity: event.severity,
    message: event.message
  };
  if (event.agentId !== undefined) view.agentId = event.agentId;
  if (event.compartmentId !== undefined) view.compartmentId = event.compartmentId;
  if (event.sessionId !== undefined) view.sessionId = event.sessionId;
  if (event.requestId !== undefined) view.requestId = event.requestId;
  if (event.executionId !== undefined) view.executionId = event.executionId;
  if (event.approvalRequestId !== undefined) {
    view.approvalRequestId = event.approvalRequestId;
  }
  if (event.metadata !== undefined) view.metadata = event.metadata;
  return view;
}

/**
 * Parse and validate the `GET /v1/audit/events` query string into an
 * {@link AuditQuery}. Returns `{ error }` on the first invalid parameter so the
 * endpoint can answer `400` — this is purely structural validation.
 */
function validateAuditQuery(
  raw: Record<string, unknown>
): { query: AuditQuery } | { error: string } {
  const query: AuditQuery = {};

  const readString = (key: string): string | undefined => {
    const value = raw[key];
    if (value === undefined) return undefined;
    return typeof value === 'string' ? value : '__invalid__';
  };

  const type = readString('type');
  if (type !== undefined) {
    if (!VALID_SECURITY_EVENT_TYPES.includes(type as SecurityEventType)) {
      return { error: `Invalid "type" query parameter: ${String(raw.type)}.` };
    }
    query.type = type as SecurityEventType;
  }

  const severity = readString('severity');
  if (severity !== undefined) {
    if (!VALID_EVENT_SEVERITIES.includes(severity as EventSeverity)) {
      return {
        error: `Invalid "severity" query parameter: ${String(raw.severity)}.`
      };
    }
    query.severity = severity as EventSeverity;
  }

  for (const key of [
    'agentId',
    'compartmentId',
    'sessionId',
    'requestId',
    'executionId'
  ] as const) {
    const value = readString(key);
    if (value !== undefined) {
      if (!isNonEmptyString(value)) {
        return { error: `Invalid "${key}" query parameter.` };
      }
      query[key] = value;
    }
  }

  for (const key of ['since', 'until'] as const) {
    const value = readString(key);
    if (value !== undefined) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        return { error: `Invalid "${key}" query parameter: must be an integer.` };
      }
      query[key] = parsed;
    }
  }

  const limit = readString('limit');
  if (limit !== undefined) {
    const parsed = Number(limit);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return {
        error: 'Invalid "limit" query parameter: must be a non-negative integer.'
      };
    }
    query.limit = parsed;
  }

  return { query };
}

export interface LocalApiOptions {
  firewall: CapabilityFirewall;
  /** Maximum accepted request body size in bytes. */
  maxBodyBytes?: number;
  /**
   * In-memory approval queue backing the human-in-the-loop endpoints. When
   * omitted, a fresh queue with the default TTL is created.
   */
  approvalQueue?: ApprovalQueue;
  /**
   * Execution engine backing the experimental `execute-mock` endpoint. When
   * omitted, a mock-only engine is created. It NEVER performs real network I/O.
   */
  executionEngine?: ExecutionEngine;
  /**
   * In-memory Session Manager backing `execute-mock` session identity and the
   * compartments/sessions read endpoints. When omitted, a bootstrap manager
   * with the single static `research` compartment is created. It performs no
   * persistence, no network, and no browser work.
   */
  sessionManager?: SessionManager;
  /**
   * Deterministic Transport Policy Engine backing `execute-mock` routing and the
   * `/v1/transport-policies` read endpoint. When omitted, a bootstrap engine
   * seeded with the static rules is created. It decides routing/rotation/
   * isolation only — it never mints a session, opens a connection, or executes.
   */
  transportPolicyEngine?: TransportPolicyEngine;
  /**
   * Deterministic Privacy Boundary Engine backing `execute-mock` anti-correlation
   * checks and the `/v1/privacy-boundaries` read endpoint. When omitted, a
   * bootstrap engine seeded with the static rules is created. It decides
   * correlation/boundary actions only — it never mints a session, rotates a
   * session, opens a connection, or executes.
   */
  privacyBoundaryEngine?: PrivacyBoundaryEngine;
  /**
   * Transport Capability Registry backing `execute-mock` sandbox enforcement and
   * the `/v1/transports` + `/v1/transports/audit` read endpoints. When omitted, a
   * bootstrap registry seeded with the static mock manifest is created. It is
   * purely in-memory: no plugin loading, no manifest file reads, no real
   * network / browser / filesystem / process work.
   */
  transportRegistry?: TransportCapabilityRegistry;
  /**
   * Security Event Engine backing the Sprint 11 audit trail. It records the
   * normalised security events emitted across the `execute-mock` lifecycle and
   * the approval endpoints, and serves them back over `GET /v1/audit/events`
   * and `GET /v1/audit/events/:id`. When omitted, a fresh in-memory engine is
   * created. It performs no persistence, no file write, and no network work.
   */
  securityEventEngine?: SecurityEventEngine;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Describe a request input WITHOUT ever storing it.
 *
 * Returns only a coarse `inputType` and a UTF-8 `inputSizeBytes` measurement —
 * never the raw value. This keeps the audit trail free of any sensitive request
 * payload while still recording a useful, privacy-safe shape signal.
 */
function describeInput(input: unknown): {
  inputType: string;
  inputSizeBytes: number;
} {
  const inputType =
    input === null
      ? 'null'
      : Array.isArray(input)
        ? 'array'
        : typeof input;
  let inputSizeBytes = 0;
  try {
    const serialized =
      typeof input === 'string' ? input : JSON.stringify(input ?? '');
    inputSizeBytes = Buffer.byteLength(serialized ?? '', 'utf8');
  } catch {
    inputSizeBytes = 0;
  }
  return { inputType, inputSizeBytes };
}

/**
 * Validate the raw HTTP body into a typed evaluate request.
 *
 * Returns a string describing the first validation error, or `null` when valid.
 * This is purely structural input validation — a *valid* request that the
 * firewall denies is NOT an error here.
 */
function validateEvaluateBody(
  body: unknown
): { request: EvaluateCapabilityHttpRequest } | { error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { error: 'Request body must be a JSON object.' };
  }
  const candidate = body as Record<string, unknown>;
  if (!isNonEmptyString(candidate.agentId)) {
    return { error: 'Field "agentId" is required and must be a non-empty string.' };
  }
  if (!isNonEmptyString(candidate.compartmentId)) {
    return { error: 'Field "compartmentId" is required and must be a non-empty string.' };
  }
  if (!isNonEmptyString(candidate.tool)) {
    return { error: 'Field "tool" is required and must be a non-empty string.' };
  }
  if (!isNonEmptyString(candidate.riskLevel)) {
    return { error: 'Field "riskLevel" is required and must be a non-empty string.' };
  }
  if (!VALID_RISK_LEVELS.includes(candidate.riskLevel as RiskLevel)) {
    return { error: `Field "riskLevel" must be one of: ${VALID_RISK_LEVELS.join(', ')}.` };
  }
  if (!('input' in candidate)) {
    return { error: 'Field "input" is required.' };
  }
  return {
    request: {
      agentId: candidate.agentId,
      compartmentId: candidate.compartmentId,
      tool: candidate.tool,
      riskLevel: candidate.riskLevel,
      input: candidate.input
    }
  };
}

/**
 * Project a queued {@link ApprovalRequest} into its public, token-free view.
 *
 * The approval token is never part of an {@link ApprovalRequest}; this mapping
 * also drops `input`/`sanitizedInput` so the pending listing exposes only the
 * metadata a human needs to make a decision.
 */
function toPendingApprovalView(request: ApprovalRequest): PendingApprovalView {
  return {
    id: request.id,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    agentId: request.agentId,
    compartmentId: request.compartmentId,
    tool: request.tool,
    riskLevel: request.riskLevel,
    reason: request.reason,
    status: 'pending'
  };
}

/**
 * Handle an approve/reject decision and map the queue result to HTTP codes:
 *   - 200 success
 *   - 400 invalid / missing token
 *   - 404 unknown request
 *   - 409 already finalized
 *   - 410 expired
 */
function handleApprovalDecision(
  approvalQueue: ApprovalQueue,
  securityEventEngine: SecurityEventEngine,
  action: 'approve' | 'reject',
  req: express.Request,
  res: express.Response
): express.Response {
  if (!req.is('application/json')) {
    return res
      .status(400)
      .json({ error: 'Content-Type must be application/json.' });
  }

  const body = req.body as unknown;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return res.status(400).json({ error: 'Request body must be a JSON object.' });
  }
  const token = (body as Record<string, unknown>).token;
  if (!isNonEmptyString(token)) {
    return res
      .status(400)
      .json({ error: 'Field "token" is required and must be a non-empty string.' });
  }

  const id = req.params.id;
  const result =
    action === 'approve'
      ? approvalQueue.approve(id, token)
      : approvalQueue.reject(id, token);

  if (result.ok) {
    // Audit the decision WITHOUT the token. Only secret-free metadata is stored.
    securityEventEngine.emit({
      type: action === 'approve' ? 'approval_approved' : 'approval_rejected',
      severity: 'info',
      agentId: result.request.agentId,
      compartmentId: result.request.compartmentId,
      approvalRequestId: result.request.id,
      message:
        action === 'approve'
          ? 'Approval request approved.'
          : 'Approval request rejected.',
      metadata: {
        tool: result.request.tool,
        riskLevel: result.request.riskLevel
      }
    });
    const response: ApprovalDecisionHttpResponse = {
      id: result.request.id,
      status: result.request.status as 'approved' | 'rejected'
    };
    return res.status(200).json(response);
  }

  switch (result.error) {
    case 'not_found':
      return res.status(404).json({ error: 'Approval request not found.' });
    case 'expired':
      return res.status(410).json({ error: 'Approval request has expired.' });
    case 'already_finalized':
      return res
        .status(409)
        .json({ error: 'Approval request has already been finalized.' });
    case 'invalid_token':
    default:
      return res.status(400).json({ error: 'Invalid approval token.' });
  }
}

/**
 * Build the GRL Local API boundary app.
 *
 * Exposes only the local usage frontier of GRL:
 *   - `GET  /v1/health`
 *   - `POST /v1/capabilities/evaluate`
 *   - `POST /v1/capabilities/request`
 *   - `GET  /v1/approvals/pending`
 *   - `POST /v1/approvals/:id/approve`
 *   - `POST /v1/approvals/:id/reject`
 *
 * The evaluate/request endpoints run the real Capability Firewall. They perform
 * NO web transport, fetch, browser, or network egress — they return the
 * firewall decision only. A firewall deny is a successful evaluation (HTTP 200,
 * `allowed: false` / `decision: "denied"`), never an HTTP error. The approval
 * endpoints drive a purely in-memory human-in-the-loop queue.
 */
export function createLocalApiApp(options: LocalApiOptions): express.Express {
  const { firewall } = options;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const approvalQueue = options.approvalQueue ?? buildApprovalQueue();
  const transportRegistry =
    options.transportRegistry ?? buildBootstrapTransportRegistry();
  const executionEngine =
    options.executionEngine ?? buildMockExecutionEngine(transportRegistry);
  const sessionManager =
    options.sessionManager ??
    buildBootstrapSessionManager({
      ttlMs: DEFAULT_SESSION_TTL_MS,
      maxRequests: DEFAULT_SESSION_MAX_REQUESTS,
      reusePolicy: DEFAULT_SESSION_REUSE_POLICY
    });
  const transportPolicyEngine =
    options.transportPolicyEngine ?? buildBootstrapTransportPolicyEngine();
  const privacyBoundaryEngine =
    options.privacyBoundaryEngine ?? buildBootstrapPrivacyBoundaryEngine();
  const securityEventEngine =
    options.securityEventEngine ?? buildSecurityEventEngine();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: maxBodyBytes, type: 'application/json' }));

  app.get('/v1/health', (_req, res) => {
    const body: HealthHttpResponse = { status: 'ok', service: 'grl-server' };
    res.status(200).json(body);
  });
  app.all('/v1/health', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed. Use GET /v1/health.' });
  });

  app.post('/v1/capabilities/evaluate', (req, res) => {
    if (!req.is('application/json')) {
      return res
        .status(400)
        .json({ error: 'Content-Type must be application/json.' });
    }

    const validated = validateEvaluateBody(req.body);
    if ('error' in validated) {
      return res.status(400).json({ error: validated.error });
    }

    const { request } = validated;
    const capabilityRequest: CapabilityRequest = {
      agentId: request.agentId,
      compartment: request.compartmentId,
      tool: request.tool as CapabilityTool,
      riskLevel: request.riskLevel as RiskLevel,
      input: request.input
    };

    const decision = firewall.evaluate(capabilityRequest);

    // A firewall deny is a successful evaluation: 200 with allowed=false.
    const response: EvaluateCapabilityHttpResponse = {
      allowed: decision.allowed,
      reason: decision.reason,
      requiresConfirmation: decision.requiresConfirmation
    };
    if (decision.allowed) {
      response.sanitizedInput = decision.sanitizedInput;
    }
    if (typeof decision.delayMs === 'number') {
      response.delayMs = decision.delayMs;
    }
    return res.status(200).json(response);
  });
  app.all('/v1/capabilities/evaluate', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use POST /v1/capabilities/evaluate.' });
  });

  app.post('/v1/capabilities/request', (req, res) => {
    if (!req.is('application/json')) {
      return res
        .status(400)
        .json({ error: 'Content-Type must be application/json.' });
    }

    const validated = validateEvaluateBody(req.body);
    if ('error' in validated) {
      return res.status(400).json({ error: validated.error });
    }

    const { request } = validated;
    const capabilityRequest: CapabilityRequest = {
      agentId: request.agentId,
      compartment: request.compartmentId,
      tool: request.tool as CapabilityTool,
      riskLevel: request.riskLevel as RiskLevel,
      input: request.input
    };

    const decision = firewall.evaluate(capabilityRequest);

    // Deny: a firewall refusal is still a successful evaluation (HTTP 200).
    if (!decision.allowed) {
      const response: RequestCapabilityHttpResponse = {
        decision: 'denied',
        reason: decision.reason
      };
      if (typeof decision.delayMs === 'number') {
        response.delayMs = decision.delayMs;
      }
      return res.status(200).json(response);
    }

    // Allowed without confirmation: return the decision directly.
    if (!decision.requiresConfirmation) {
      const response: RequestCapabilityHttpResponse = {
        decision: 'allowed',
        reason: decision.reason,
        sanitizedInput: decision.sanitizedInput
      };
      if (typeof decision.delayMs === 'number') {
        response.delayMs = decision.delayMs;
      }
      return res.status(200).json(response);
    }

    // Allowed but requires confirmation: enqueue a pending approval request.
    const created = approvalQueue.create({
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      tool: request.tool as CapabilityTool,
      riskLevel: request.riskLevel as RiskLevel,
      input: request.input,
      sanitizedInput: decision.sanitizedInput,
      reason: decision.reason
    });

    const response: RequestCapabilityHttpResponse = {
      decision: 'pending',
      reason: decision.reason,
      approvalRequestId: created.request.id,
      approvalToken: created.token.value
    };
    return res.status(200).json(response);
  });
  app.all('/v1/capabilities/request', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use POST /v1/capabilities/request.' });
  });

  // Experimental Sprint 6 endpoint: evaluate, then — only when allowed without
  // confirmation — execute through the MOCK transport. This endpoint is
  // mock-only: it performs no fetch, DNS, socket, browser, or any real network
  // egress. A deny never executes; a pending never executes.
  app.post('/v1/capabilities/execute-mock', async (req, res) => {
    if (!req.is('application/json')) {
      return res
        .status(400)
        .json({ error: 'Content-Type must be application/json.' });
    }

    const validated = validateEvaluateBody(req.body);
    if ('error' in validated) {
      return res.status(400).json({ error: validated.error });
    }

    const { request } = validated;
    // One correlation id ties every audit event of this request together. It is
    // a fresh local UUID — never a token, secret, or any caller-supplied value.
    const requestId = randomUUID();
    const inputDescriptor = describeInput(request.input);
    const capabilityRequest: CapabilityRequest = {
      agentId: request.agentId,
      compartment: request.compartmentId,
      tool: request.tool as CapabilityTool,
      riskLevel: request.riskLevel as RiskLevel,
      input: request.input
    };

    const decision = firewall.evaluate(capabilityRequest);

    // Deny: a firewall refusal never triggers execution.
    if (!decision.allowed) {
      securityEventEngine.emit({
        type: 'capability_denied',
        severity: 'warning',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Capability denied by firewall.',
        metadata: {
          tool: request.tool,
          riskLevel: request.riskLevel,
          reason: decision.reason
        }
      });
      const response: ExecuteMockCapabilityHttpResponse = {
        decision: 'denied',
        reason: decision.reason
      };
      return res.status(200).json(response);
    }

    // Allowed but requires confirmation: enqueue and never execute.
    if (decision.requiresConfirmation) {
      const created = approvalQueue.create({
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        tool: request.tool as CapabilityTool,
        riskLevel: request.riskLevel as RiskLevel,
        input: request.input,
        sanitizedInput: decision.sanitizedInput,
        reason: decision.reason
      });
      // Audit the pending approval WITHOUT the one-time token.
      securityEventEngine.emit({
        type: 'approval_pending',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        approvalRequestId: created.request.id,
        message: 'Capability requires human approval.',
        metadata: {
          tool: request.tool,
          riskLevel: request.riskLevel,
          reason: decision.reason
        }
      });
      const response: ExecuteMockCapabilityHttpResponse = {
        decision: 'pending',
        reason: decision.reason,
        approvalRequestId: created.request.id,
        approvalToken: created.token.value
      };
      return res.status(200).json(response);
    }

    // Allowed without confirmation.
    securityEventEngine.emit({
      type: 'capability_allowed',
      severity: 'info',
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      requestId,
      message: 'Capability allowed by firewall.',
      metadata: {
        tool: request.tool,
        riskLevel: request.riskLevel,
        reason: decision.reason
      }
    });

    // Allowed without confirmation: resolve the routing decision FIRST (the
    // Transport Policy Engine consults only tool + riskLevel and never touches
    // sessions), then select a session identity per that decision, then run it
    // through the mock execution engine.
    //
    // Strict separation of concerns:
    //   - the policy engine decides (routing/rotation/isolation), nothing more
    //   - the Session Manager mints/reuses/rotates the session identity
    //   - the Execution Engine runs the request through the mock transport
    //
    // A missing routing rule is fail-closed: no session is created and no
    // execution happens (HTTP 200, decision="denied").
    let routing: RoutingDecision;
    try {
      routing = transportPolicyEngine.resolve({
        id: randomUUID(),
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        tool: request.tool as CapabilityTool,
        riskLevel: request.riskLevel as RiskLevel,
        input: request.input,
        sanitizedInput: decision.sanitizedInput,
        // The session is decided AFTER routing; this context is not consulted
        // by the engine and is replaced below with the real session identity.
        session: {
          sessionId: '',
          compartmentId: request.compartmentId,
          transportKind: 'mock',
          createdAt: 0
        }
      });
    } catch (err) {
      if (err instanceof TransportPolicyError) {
        const response: ExecuteMockCapabilityHttpResponse = {
          decision: 'denied',
          reason: `No transport routing rule available: ${err.message}`
        };
        return res.status(200).json(response);
      }
      throw err;
    }

    securityEventEngine.emit({
      type: 'routing_resolved',
      severity: 'info',
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      requestId,
      message: 'Transport routing resolved.',
      metadata: {
        tool: request.tool,
        riskLevel: request.riskLevel,
        transportKind: routing.transportKind,
        routingReason: routing.reason,
        isolationLevel: routing.isolationLevel
      }
    });

    // Privacy Boundary Engine (Sprint 9): evaluate anti-correlation AFTER routing
    // is resolved but BEFORE any session is minted/rotated. The engine consults
    // metadata only (compartments, risk, routing isolation) and never mints a
    // session, opens a connection, or executes.
    //
    //   - block            → no session, no execution (decision="denied")
    //   - require_approval → enqueue approval, no execution (decision="pending")
    //   - rotate_session   → force a fresh session before executing
    //   - allow            → proceed (rotation still governed by routing)
    const privacy: PrivacyBoundaryDecision = privacyBoundaryEngine.evaluate({
      agentId: request.agentId,
      sourceCompartmentId: request.compartmentId,
      targetCompartmentId: request.compartmentId,
      tool: request.tool as CapabilityTool,
      riskLevel: request.riskLevel as RiskLevel,
      routingIsolationLevel: routing.isolationLevel
    });
    const privacyView = toPrivacyBoundaryDecisionView(privacy);

    // Privacy block: fail-closed. No session is created and nothing executes.
    if (privacy.action === 'block') {
      securityEventEngine.emit({
        type: 'privacy_boundary_blocked',
        severity: 'warning',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Privacy boundary blocked execution.',
        metadata: {
          tool: request.tool,
          riskLevel: request.riskLevel,
          privacySignals: privacy.signals,
          reason: privacy.reason
        }
      });
      const response: ExecuteMockCapabilityHttpResponse = {
        decision: 'denied',
        reason: 'Privacy boundary blocked execution.',
        routing: toRoutingDecisionView(routing),
        privacyBoundary: privacyView
      };
      return res.status(200).json(response);
    }

    // Privacy require_approval: enqueue a pending approval and never execute.
    if (privacy.action === 'require_approval') {
      const created = approvalQueue.create({
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        tool: request.tool as CapabilityTool,
        riskLevel: request.riskLevel as RiskLevel,
        input: request.input,
        sanitizedInput: decision.sanitizedInput,
        reason: privacy.reason
      });
      securityEventEngine.emit({
        type: 'approval_pending',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        approvalRequestId: created.request.id,
        message: 'Privacy boundary requires human approval.',
        metadata: {
          tool: request.tool,
          riskLevel: request.riskLevel,
          privacySignals: privacy.signals,
          reason: privacy.reason
        }
      });
      const response: ExecuteMockCapabilityHttpResponse = {
        decision: 'pending',
        reason: privacy.reason,
        routing: toRoutingDecisionView(routing),
        privacyBoundary: privacyView,
        approvalRequestId: created.request.id,
        approvalToken: created.token.value
      };
      return res.status(200).json(response);
    }

    // A privacy-driven rotation is its own audited signal.
    if (privacy.action === 'rotate_session') {
      securityEventEngine.emit({
        type: 'privacy_boundary_rotation',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        requestId,
        message: 'Privacy boundary forced a session rotation.',
        metadata: {
          tool: request.tool,
          riskLevel: request.riskLevel,
          privacySignals: privacy.signals,
          reason: privacy.reason
        }
      });
    }

    // The session rotates when EITHER the routing decision OR the privacy
    // boundary decision demands it. The engines themselves never mint a session.
    const mustRotateSession =
      routing.shouldRotateSession || privacy.action === 'rotate_session';
    const sessionsBefore = sessionManager.size();
    const session = mustRotateSession
      ? sessionManager.rotateSession(request.compartmentId)
      : sessionManager.getOrCreateSession(request.compartmentId);

    // Audit the session lifecycle: a rotation, or a freshly-minted session.
    if (mustRotateSession) {
      securityEventEngine.emit({
        type: 'session_rotated',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        sessionId: session.sessionId,
        requestId,
        message: 'Session rotated.',
        metadata: { transportKind: session.transportKind }
      });
    } else if (sessionManager.size() > sessionsBefore) {
      securityEventEngine.emit({
        type: 'session_created',
        severity: 'info',
        agentId: request.agentId,
        compartmentId: request.compartmentId,
        sessionId: session.sessionId,
        requestId,
        message: 'Session created.',
        metadata: { transportKind: session.transportKind }
      });
    }

    // Inject the transport from the RoutingDecision into the execution context
    // so the Execution Engine routes through exactly the resolved transport.
    const executionRequest: ExecutionRequest = {
      id: randomUUID(),
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      tool: request.tool as CapabilityTool,
      riskLevel: request.riskLevel as RiskLevel,
      input: request.input,
      sanitizedInput: decision.sanitizedInput,
      session: {
        ...sessionManager.toSessionContext(session),
        transportKind: routing.transportKind
      }
    };

    // Audit the start of execution before invoking the transport.
    securityEventEngine.emit({
      type: 'execution_started',
      severity: 'info',
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      sessionId: session.sessionId,
      requestId,
      executionId: executionRequest.id,
      message: 'Execution started.',
      metadata: {
        tool: request.tool,
        riskLevel: request.riskLevel,
        transportKind: routing.transportKind,
        inputType: inputDescriptor.inputType,
        inputSizeBytes: inputDescriptor.inputSizeBytes
      }
    });

    const result = await executionEngine.execute(executionRequest);

    // A `blocked` result means no adapter ran (fail-closed); it does not consume
    // the session's request budget. Any other outcome (success/failed) means the
    // transport was actually invoked, so the use is recorded.
    if (result.status !== 'blocked') {
      sessionManager.recordUse(session.sessionId);
    }

    // Audit the sandbox verdict (when the engine enforced it) and the terminal
    // execution status, using the shared correlation + execution ids.
    const sandboxViolationCodes = result.sandbox
      ? result.sandbox.violations.map((violation) => violation.code)
      : [];
    if (result.sandbox !== undefined) {
      if (result.sandbox.action === 'block') {
        securityEventEngine.emit({
          type: 'sandbox_blocked',
          severity: 'warning',
          agentId: request.agentId,
          compartmentId: request.compartmentId,
          sessionId: session.sessionId,
          requestId,
          executionId: executionRequest.id,
          message: 'Adapter sandbox blocked execution.',
          metadata: {
            tool: request.tool,
            transportKind: result.transportKind,
            sandboxViolations: sandboxViolationCodes
          }
        });
      } else {
        securityEventEngine.emit({
          type: 'sandbox_allowed',
          severity: 'info',
          agentId: request.agentId,
          compartmentId: request.compartmentId,
          sessionId: session.sessionId,
          requestId,
          executionId: executionRequest.id,
          message: 'Adapter sandbox allowed execution.',
          metadata: {
            tool: request.tool,
            transportKind: result.transportKind
          }
        });
      }
    }

    const terminalType: SecurityEventType =
      result.status === 'success'
        ? 'execution_succeeded'
        : result.status === 'failed'
          ? 'execution_failed'
          : 'execution_blocked';
    const terminalSeverity: EventSeverity =
      result.status === 'success' ? 'info' : 'warning';
    securityEventEngine.emit({
      type: terminalType,
      severity: terminalSeverity,
      agentId: request.agentId,
      compartmentId: request.compartmentId,
      sessionId: session.sessionId,
      requestId,
      executionId: executionRequest.id,
      message: `Execution ${result.status}.`,
      metadata: {
        tool: request.tool,
        transportKind: result.transportKind,
        executionStatus: result.status,
        ...(sandboxViolationCodes.length > 0
          ? { sandboxViolations: sandboxViolationCodes }
          : {})
      }
    });

    const execution: ExecutionResultView = {
      status: result.status,
      transportKind: result.transportKind
    };
    if (result.output !== undefined) {
      execution.output = result.output;
    }
    if (result.error !== undefined) {
      execution.error = result.error;
    }

    const response: ExecuteMockCapabilityHttpResponse = {
      decision: 'allowed',
      reason: decision.reason,
      routing: toRoutingDecisionView(routing),
      privacyBoundary: privacyView,
      execution
    };
    // Surface the sandbox decision (allow or block) when the engine enforced it.
    if (result.sandbox !== undefined) {
      response.sandbox = toSandboxDecisionView(result.sandbox);
    }
    return res.status(200).json(response);
  });
  app.all('/v1/capabilities/execute-mock', (_req, res) => {
    res.status(405).json({
      error: 'Method not allowed. Use POST /v1/capabilities/execute-mock.'
    });
  });

  // Read-only debug surface: list the statically-bootstrapped compartments.
  // No secrets are exposed — only compartment lifecycle metadata.
  app.get('/v1/compartments', (_req, res) => {
    const compartments = sessionManager.listCompartments().map(toCompartmentView);
    const body: CompartmentsHttpResponse = { compartments };
    return res.status(200).json(body);
  });
  app.all('/v1/compartments', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/compartments.' });
  });

  // Read-only metadata surface: list the bootstrap transport policy rules.
  // No secrets are exposed — only routing/isolation metadata.
  app.get('/v1/transport-policies', (_req, res) => {
    const rules = transportPolicyEngine
      .listRules()
      .map(toTransportPolicyRuleView);
    const body: TransportPoliciesHttpResponse = { rules };
    return res.status(200).json(body);
  });
  app.all('/v1/transport-policies', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/transport-policies.' });
  });

  // Read-only metadata surface: list the bootstrap privacy boundary rules.
  // No secrets are exposed — only correlation/boundary metadata.
  app.get('/v1/privacy-boundaries', (_req, res) => {
    const rules = privacyBoundaryEngine
      .listRules()
      .map(toPrivacyBoundaryRuleView);
    const body: PrivacyBoundariesHttpResponse = { rules };
    return res.status(200).json(body);
  });
  app.all('/v1/privacy-boundaries', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/privacy-boundaries.' });
  });

  // Read-only metadata surface: list the registered transport manifests.
  // No secrets are exposed — only the declared capability surface of each
  // adapter (tools, permissions, access flags).
  app.get('/v1/transports', (_req, res) => {
    const transports = transportRegistry
      .listManifests()
      .map(toTransportManifestView);
    const body: TransportsHttpResponse = { transports };
    return res.status(200).json(body);
  });
  app.all('/v1/transports', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/transports.' });
  });

  // Read-only audit surface: the capability/permission surface of every
  // registered transport. No secrets are exposed.
  app.get('/v1/transports/audit', (_req, res) => {
    const audit = transportRegistry.audit().map(toTransportCapabilityAuditView);
    const body: TransportsAuditHttpResponse = { audit };
    return res.status(200).json(body);
  });
  app.all('/v1/transports/audit', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/transports/audit.' });
  });

  // Read-only debug surface: list sessions, optionally filtered by compartment.
  // No tokens or secrets are exposed — only session lifecycle metadata.
  app.get('/v1/sessions', (req, res) => {
    const rawCompartmentId = req.query.compartmentId;
    let compartmentId: string | undefined;
    if (typeof rawCompartmentId === 'string' && rawCompartmentId.length > 0) {
      compartmentId = rawCompartmentId;
    } else if (Array.isArray(rawCompartmentId)) {
      return res
        .status(400)
        .json({ error: 'Query "compartmentId" must be a single value.' });
    }
    const sessions = sessionManager.listSessions(compartmentId).map(toSessionView);
    const body: SessionsHttpResponse = { sessions };
    return res.status(200).json(body);
  });
  app.all('/v1/sessions', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed. Use GET /v1/sessions.' });
  });

  // Read-only audit surface (Sprint 11): list recorded security events with an
  // optional query, or fetch a single event by id. The response carries only
  // normalised, secret-free metadata — NEVER a token, secret, raw header, raw
  // env, raw stack trace, or raw request input.
  app.get('/v1/audit/events', (req, res) => {
    const validated = validateAuditQuery(req.query as Record<string, unknown>);
    if ('error' in validated) {
      return res.status(400).json({ error: validated.error });
    }
    const events = securityEventEngine
      .query(validated.query)
      .map(toSecurityEventView);
    const body: AuditEventsHttpResponse = { events };
    return res.status(200).json(body);
  });
  app.all('/v1/audit/events', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/audit/events.' });
  });

  app.get('/v1/audit/events/:id', (req, res) => {
    const event = securityEventEngine.getEvent(req.params.id);
    if (!event) {
      return res.status(404).json({ error: 'Security event not found.' });
    }
    const body: AuditEventHttpResponse = { event: toSecurityEventView(event) };
    return res.status(200).json(body);
  });
  app.all('/v1/audit/events/:id', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/audit/events/:id.' });
  });

  app.get('/v1/approvals/pending', (_req, res) => {
    const pending: PendingApprovalView[] = approvalQueue
      .listPending()
      .map(toPendingApprovalView);
    const body: PendingApprovalsHttpResponse = { pending };
    return res.status(200).json(body);
  });
  app.all('/v1/approvals/pending', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use GET /v1/approvals/pending.' });
  });

  app.post('/v1/approvals/:id/approve', (req, res) =>
    handleApprovalDecision(approvalQueue, securityEventEngine, 'approve', req, res)
  );
  app.all('/v1/approvals/:id/approve', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use POST /v1/approvals/:id/approve.' });
  });

  app.post('/v1/approvals/:id/reject', (req, res) =>
    handleApprovalDecision(approvalQueue, securityEventEngine, 'reject', req, res)
  );
  app.all('/v1/approvals/:id/reject', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use POST /v1/approvals/:id/reject.' });
  });

  // Unknown routes → 404.
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  // Body-parser and runtime errors → typed HTTP codes.
  app.use(
    (
      err: Error & { type?: string; status?: number; statusCode?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      const status = err.status ?? err.statusCode;
      if (err.type === 'entity.too.large' || status === 413) {
        return res.status(413).json({ error: 'Payload too large.' });
      }
      if (err.type === 'entity.parse.failed' || err instanceof SyntaxError || status === 400) {
        return res.status(400).json({ error: 'Invalid JSON body.' });
      }
      return res.status(500).json({ error: 'Internal server error.' });
    }
  );

  return app;
}

export interface LocalApiServerConfig {
  host: string;
  port: number;
  maxBodyBytes: number;
  approvalTtlMs: number;
  sessionTtlMs: number;
  sessionMaxRequests: number;
  sessionReusePolicy: SessionReusePolicy;
}

/** Parse a reuse policy from an env value, falling back to the default. */
export function parseReusePolicy(
  value: string | undefined
): SessionReusePolicy {
  return value === 'always_rotate' || value === 'reuse_active'
    ? value
    : DEFAULT_SESSION_REUSE_POLICY;
}

/**
 * Resolve the server configuration from an environment map.
 *
 * Reads `GRL_HOST`, `GRL_PORT`, `GRL_MAX_BODY_BYTES`, `GRL_APPROVAL_TTL_MS`,
 * `GRL_SESSION_TTL_MS`, `GRL_SESSION_MAX_REQUESTS`, and
 * `GRL_SESSION_REUSE_POLICY`. The `env` argument is injectable so configuration
 * can be tested without mutating global state.
 */
export function resolveServerConfig(
  env: NodeJS.ProcessEnv = process.env
): LocalApiServerConfig {
  const port = env.GRL_PORT ? Number(env.GRL_PORT) : DEFAULT_PORT;
  const maxBodyBytes = env.GRL_MAX_BODY_BYTES
    ? Number(env.GRL_MAX_BODY_BYTES)
    : DEFAULT_MAX_BODY_BYTES;
  const approvalTtlMs = env.GRL_APPROVAL_TTL_MS
    ? Number(env.GRL_APPROVAL_TTL_MS)
    : DEFAULT_APPROVAL_TTL_MS;
  const sessionTtlMs = env.GRL_SESSION_TTL_MS
    ? Number(env.GRL_SESSION_TTL_MS)
    : DEFAULT_SESSION_TTL_MS;
  const sessionMaxRequests = env.GRL_SESSION_MAX_REQUESTS
    ? Number(env.GRL_SESSION_MAX_REQUESTS)
    : DEFAULT_SESSION_MAX_REQUESTS;
  return {
    host: env.GRL_HOST || DEFAULT_HOST,
    port: Number.isFinite(port) ? port : DEFAULT_PORT,
    maxBodyBytes: Number.isFinite(maxBodyBytes) ? maxBodyBytes : DEFAULT_MAX_BODY_BYTES,
    approvalTtlMs:
      Number.isFinite(approvalTtlMs) && approvalTtlMs > 0
        ? approvalTtlMs
        : DEFAULT_APPROVAL_TTL_MS,
    sessionTtlMs:
      Number.isFinite(sessionTtlMs) && sessionTtlMs > 0
        ? sessionTtlMs
        : DEFAULT_SESSION_TTL_MS,
    sessionMaxRequests:
      Number.isFinite(sessionMaxRequests) && sessionMaxRequests > 0
        ? sessionMaxRequests
        : DEFAULT_SESSION_MAX_REQUESTS,
    sessionReusePolicy: parseReusePolicy(env.GRL_SESSION_REUSE_POLICY)
  };
}

function startLocalApiServer(): void {
  const config = resolveServerConfig();
  const transportRegistry = buildBootstrapTransportRegistry();
  const app = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    maxBodyBytes: config.maxBodyBytes,
    approvalQueue: buildApprovalQueue(config.approvalTtlMs),
    executionEngine: buildMockExecutionEngine(transportRegistry),
    sessionManager: buildBootstrapSessionManager({
      ttlMs: config.sessionTtlMs,
      maxRequests: config.sessionMaxRequests,
      reusePolicy: config.sessionReusePolicy
    }),
    transportPolicyEngine: buildBootstrapTransportPolicyEngine(),
    privacyBoundaryEngine: buildBootstrapPrivacyBoundaryEngine(),
    transportRegistry
  });
  app.listen(config.port, config.host, () => {
    // eslint-disable-next-line no-console
    console.log(`GRL Local API listening on http://${config.host}:${config.port}`);
  });
}

const invokedDirectly =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  startLocalApiServer();
}
