/**
 * PolicyEngine — the minimal, deny-by-default decision core.
 *
 * Every request is denied unless a matching policy explicitly authorises it.
 * The engine applies, in order, the MVP rules:
 *
 *   - malformed / invalid request   => deny
 *   - unknown tool                  => deny
 *   - no policy (agent/compartment) => deny
 *   - tool not in allowedTools      => deny
 *   - risk above policy ceiling     => deny
 *   - input rejected by sanitizer   => deny
 *
 * Only when all checks pass is the request allowed, with the sanitized input
 * and an optional confirmation flag.
 */

import {
  CapabilityDecision,
  CapabilityRequest,
  RISK_RANK,
  isKnownRiskLevel,
  isKnownTool
} from '../capability-firewall/types.js';
import {
  DEFAULT_SANITIZER_OPTIONS,
  SanitizerOptions,
  sanitizeInput
} from '../sanitizer/index.js';
import { PolicyStore } from './policy-store.js';

export interface PolicyEngineOptions {
  sanitizer?: SanitizerOptions;
}

function deny(reason: string): CapabilityDecision {
  return { allowed: false, reason, requiresConfirmation: false };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export class PolicyEngine {
  private readonly sanitizerOptions: SanitizerOptions;

  constructor(
    private readonly store: PolicyStore,
    options: PolicyEngineOptions = {}
  ) {
    this.sanitizerOptions = options.sanitizer ?? DEFAULT_SANITIZER_OPTIONS;
  }

  evaluate(request: CapabilityRequest): CapabilityDecision {
    // 1. Structural validation of the request itself (malformed input => deny).
    if (request === null || typeof request !== 'object') {
      return deny('Malformed request.');
    }
    if (!isNonEmptyString(request.agentId)) {
      return deny('Malformed request: missing agentId.');
    }
    if (!isNonEmptyString(request.compartmentId)) {
      return deny('Malformed request: missing compartmentId.');
    }
    if (!isKnownTool(request.tool)) {
      return deny('Unknown tool.');
    }
    if (!isKnownRiskLevel(request.riskLevel)) {
      return deny('Malformed request: invalid riskLevel.');
    }

    // 2. Policy lookup. A missing policy covers unknown agent, unknown
    //    compartment, and absent policy — all deny-by-default.
    const policy = this.store.get(request.agentId, request.compartmentId);
    if (!policy) {
      return deny('Denied by default: no matching policy.');
    }

    // 3. The tool must be explicitly allowed by the policy.
    if (!policy.allowedTools.includes(request.tool)) {
      return deny('Denied: tool not permitted by policy.');
    }

    // 4. Risk ceiling enforcement (risk above policy => deny).
    if (RISK_RANK[request.riskLevel] > RISK_RANK[policy.maxRiskLevel]) {
      return deny('Denied: risk level exceeds policy maximum.');
    }

    // 5. Sanitize the input (invalid / oversized payload => deny).
    const sanitized = sanitizeInput(request.input, this.sanitizerOptions);
    if (!sanitized.ok) {
      return deny(`Denied: ${sanitized.reason}`);
    }

    // 6. Confirmation threshold.
    const requiresConfirmation =
      policy.requiresConfirmationAbove !== undefined &&
      RISK_RANK[request.riskLevel] > RISK_RANK[policy.requiresConfirmationAbove];

    return {
      allowed: true,
      reason: 'Allowed by policy.',
      requiresConfirmation,
      sanitizedInput: sanitized.value
    };
  }
}
