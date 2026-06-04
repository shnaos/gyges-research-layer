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
  RiskLevel
} from '../../../packages/core/src/index.js';
import {
  PolicyDocument,
  PolicyRule,
  YamlPolicyEngine
} from '../../../packages/policy-engine/src/index.js';
import {
  ApprovalDecisionHttpResponse,
  EvaluateCapabilityHttpRequest,
  EvaluateCapabilityHttpResponse,
  HealthHttpResponse,
  PendingApprovalsHttpResponse,
  PendingApprovalView,
  RequestCapabilityHttpResponse
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

export interface LocalApiOptions {
  firewall: CapabilityFirewall;
  /** Maximum accepted request body size in bytes. */
  maxBodyBytes?: number;
  /**
   * In-memory approval queue backing the human-in-the-loop endpoints. When
   * omitted, a fresh queue with the default TTL is created.
   */
  approvalQueue?: ApprovalQueue;
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
}

/**
 * Resolve the server configuration from an environment map.
 *
 * Reads `GRL_HOST`, `GRL_PORT`, `GRL_MAX_BODY_BYTES`, and `GRL_APPROVAL_TTL_MS`.
 * The `env` argument is injectable so configuration can be tested without
 * mutating global state.
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
  return {
    host: env.GRL_HOST || DEFAULT_HOST,
    port: Number.isFinite(port) ? port : DEFAULT_PORT,
    maxBodyBytes: Number.isFinite(maxBodyBytes) ? maxBodyBytes : DEFAULT_MAX_BODY_BYTES,
    approvalTtlMs:
      Number.isFinite(approvalTtlMs) && approvalTtlMs > 0
        ? approvalTtlMs
        : DEFAULT_APPROVAL_TTL_MS
  };
}

function startLocalApiServer(): void {
  const config = resolveServerConfig();
  const app = createLocalApiApp({
    firewall: buildBootstrapFirewall(),
    maxBodyBytes: config.maxBodyBytes,
    approvalQueue: buildApprovalQueue(config.approvalTtlMs)
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
