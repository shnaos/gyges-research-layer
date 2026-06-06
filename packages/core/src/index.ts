export type CapabilityTool = 'search' | 'fetch_html' | 'fetch_json';
export type RiskLevel = 'low' | 'medium' | 'high';

/**
 * Supported transports. The transport is never chosen by the agent: it is
 * resolved internally from policy + compartment + session configuration.
 * `direct` uses the system resolver; `tor` and `proxy` route over SOCKS5 with
 * remote DNS resolution. No VPN / multi-hop placeholders.
 */
export type TransportType = 'direct' | 'tor' | 'proxy';

export type DnsPolicy = 'system' | 'remote';

export interface CapabilityRequest {
  agentId: string;
  compartment: string;
  tool: CapabilityTool;
  riskLevel: RiskLevel;
  input: unknown;
  /**
   * Optional asserted transport. Agents normally omit this — the transport is
   * decided by policy. When present it is validated against the policy and a
   * mismatch denies execution (no silent transport escalation).
   */
  transport?: TransportType;
}

export interface CapabilityDecision {
  allowed: boolean;
  reason: string;
  requiresConfirmation: boolean;
  delayMs?: number;
  sanitizedInput?: unknown;
  /** Transport the policy binds this capability to. Resolved deterministically. */
  transport?: TransportType;
}

export interface CapabilityPolicyEvaluator {
  evaluate(request: CapabilityRequest): CapabilityDecision;
}

export class CapabilityFirewall {
  constructor(private readonly evaluator: CapabilityPolicyEvaluator) {}

  evaluate(request: CapabilityRequest): CapabilityDecision {
    return this.evaluator.evaluate(request);
  }
}

export * from './execution/index.js';

export * from './session-manager/index.js';

export * from './transport-policy/index.js';

export * from './privacy-boundary/index.js';

export * from './transport-registry/index.js';

export * from './audit/index.js';

export * from './capability-graph/index.js';

export * from './runtime-security/index.js';

export * from './adaptive-defense/index.js';

export * from './trust-reputation/index.js';

export * from './runtime-config/index.js';

export * from './transports/searxng/index.js';

export * from './runtime-profiles/index.js';

export * from './multi-agent/index.js';

export * from './behavioral-privacy/index.js';

export * from './persona-isolation/index.js';

export * from './temporal-obfuscation/index.js';

export * from './transport-fingerprint/index.js';

export {
  ApprovalQueue,
  DEFAULT_APPROVAL_TTL_MS
} from './approval-queue/index.js';
export type {
  ApprovalQueueOptions,
  ApprovalStatus,
  ApprovalRequest,
  ApprovalToken,
  CreateApprovalRequestInput,
  CreatedApproval,
  ApprovalActionError,
  ApprovalActionResult
} from './approval-queue/index.js';
