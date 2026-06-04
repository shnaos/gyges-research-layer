import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  ApprovalQueue,
  ApprovalRequest,
  CapabilityFirewall,
  CapabilityRequest,
  CapabilityTool,
  DEFAULT_APPROVAL_TTL_MS,
  ExecutionEngine,
  ExecutionRequest,
  IdentityCompartment,
  MockTransportAdapter,
  RiskLevel,
  RoutingDecision,
  SessionManager,
  SessionRecord,
  SessionReusePolicy,
  TransportPolicyEngine,
  TransportPolicyError,
  TransportPolicyRule,
  BOOTSTRAP_TRANSPORT_POLICY_RULES
} from '../../../packages/core/src/index.js';
import {
  PolicyDocument,
  PolicyRule,
  YamlPolicyEngine
} from '../../../packages/policy-engine/src/index.js';
import {
  ApprovalDecisionHttpResponse,
  CompartmentsHttpResponse,
  CompartmentView,
  EvaluateCapabilityHttpRequest,
  EvaluateCapabilityHttpResponse,
  ExecuteMockCapabilityHttpResponse,
  ExecutionResultView,
  HealthHttpResponse,
  PendingApprovalsHttpResponse,
  PendingApprovalView,
  RequestCapabilityHttpResponse,
  RoutingDecisionView,
  SessionsHttpResponse,
  SessionView,
  TransportPoliciesHttpResponse,
  TransportPolicyRuleView
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
 * `searxng`/`browser` transport is registered in Sprint 6.
 */
export function buildMockExecutionEngine(): ExecutionEngine {
  return new ExecutionEngine({ adapters: [new MockTransportAdapter()] });
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
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
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
  const executionEngine = options.executionEngine ?? buildMockExecutionEngine();
  const sessionManager =
    options.sessionManager ??
    buildBootstrapSessionManager({
      ttlMs: DEFAULT_SESSION_TTL_MS,
      maxRequests: DEFAULT_SESSION_MAX_REQUESTS,
      reusePolicy: DEFAULT_SESSION_REUSE_POLICY
    });
  const transportPolicyEngine =
    options.transportPolicyEngine ?? buildBootstrapTransportPolicyEngine();

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
      const response: ExecuteMockCapabilityHttpResponse = {
        decision: 'pending',
        reason: decision.reason,
        approvalRequestId: created.request.id,
        approvalToken: created.token.value
      };
      return res.status(200).json(response);
    }

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

    // The routing decision drives whether we rotate to a fresh session or reuse
    // an existing active one. The policy engine itself never mints a session.
    const session = routing.shouldRotateSession
      ? sessionManager.rotateSession(request.compartmentId)
      : sessionManager.getOrCreateSession(request.compartmentId);

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

    const result = await executionEngine.execute(executionRequest);

    // A `blocked` result means no adapter ran (fail-closed); it does not consume
    // the session's request budget. Any other outcome (success/failed) means the
    // transport was actually invoked, so the use is recorded.
    if (result.status !== 'blocked') {
      sessionManager.recordUse(session.sessionId);
    }

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
      execution
    };
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
    handleApprovalDecision(approvalQueue, 'approve', req, res)
  );
  app.all('/v1/approvals/:id/approve', (_req, res) => {
    res
      .status(405)
      .json({ error: 'Method not allowed. Use POST /v1/approvals/:id/approve.' });
  });

  app.post('/v1/approvals/:id/reject', (req, res) =>
    handleApprovalDecision(approvalQueue, 'reject', req, res)
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
  const app = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    maxBodyBytes: config.maxBodyBytes,
    approvalQueue: buildApprovalQueue(config.approvalTtlMs),
    executionEngine: buildMockExecutionEngine(),
    sessionManager: buildBootstrapSessionManager({
      ttlMs: config.sessionTtlMs,
      maxRequests: config.sessionMaxRequests,
      reusePolicy: config.sessionReusePolicy
    }),
    transportPolicyEngine: buildBootstrapTransportPolicyEngine()
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
