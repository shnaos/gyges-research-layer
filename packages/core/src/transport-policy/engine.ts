/**
 * TransportPolicyEngine — deterministic, fail-closed routing/isolation decisions.
 *
 * The engine owns a set of {@link TransportPolicyRule}s keyed by
 * `(tool, riskLevel)` and resolves an {@link ExecutionRequest} into a single
 * {@link RoutingDecision}. It is intentionally minimal and side-effect free:
 *
 *   - deterministic: identical inputs always produce identical decisions
 *   - fail-closed: a missing rule throws; there is no dangerous implicit fallback
 *   - no silent overwrite: registering a duplicate `(tool, riskLevel)` throws
 *   - no mutation: the incoming request and the stored rules are never mutated;
 *     `resolve` returns a fresh decision and `listRules` returns deep copies
 *
 * Separation of concerns (Sprint 8 MVP): the engine NEVER mints a session,
 * NEVER opens a connection, and NEVER runs an execution. It only decides.
 */

import { ExecutionRequest } from '../execution/types.js';
import {
  IsolationPolicy,
  RoutingDecision,
  RoutingReason,
  TransportPolicyErrorKind,
  TransportPolicyRule
} from './types.js';

/** Typed error raised by {@link TransportPolicyEngine} on a misuse. */
export class TransportPolicyError extends Error {
  constructor(
    readonly kind: TransportPolicyErrorKind,
    message: string
  ) {
    super(message);
    this.name = 'TransportPolicyError';
  }
}

/** Build the deterministic map key for a `(tool, riskLevel)` pair. */
function ruleKey(tool: string, riskLevel: string): string {
  return `${tool}:${riskLevel}`;
}

export class TransportPolicyEngine {
  /** Registered rules keyed by `(tool, riskLevel)`, in insertion order. */
  private readonly rules = new Map<string, TransportPolicyRule>();

  /**
   * Register a routing rule.
   *
   * Throws {@link TransportPolicyError} (`duplicate_rule`) when a rule for the
   * same `(tool, riskLevel)` already exists — a rule's routing/isolation policy
   * can never be silently replaced. The stored rule is a deep copy, so later
   * mutation of the caller's object can never affect the engine.
   */
  registerRule(rule: TransportPolicyRule): void {
    const key = ruleKey(rule.tool, rule.riskLevel);
    if (this.rules.has(key)) {
      throw new TransportPolicyError(
        'duplicate_rule',
        `A transport policy rule for tool "${rule.tool}" at risk "${rule.riskLevel}" is already registered.`
      );
    }
    this.rules.set(key, this.cloneRule(rule));
  }

  /**
   * Resolve an execution into a deterministic {@link RoutingDecision}.
   *
   * Only `request.tool` and `request.riskLevel` are consulted; the session
   * identity is decided by the caller AFTER this decision. Throws
   * {@link TransportPolicyError} (`no_rule`) when no rule matches — the engine
   * is fail-closed and never invents a default transport.
   */
  resolve(request: ExecutionRequest): RoutingDecision {
    const key = ruleKey(request.tool, request.riskLevel);
    const rule = this.rules.get(key);
    if (!rule) {
      throw new TransportPolicyError(
        'no_rule',
        `No transport policy rule for tool "${request.tool}" at risk "${request.riskLevel}".`
      );
    }

    const isolation = rule.isolationPolicy;
    const isHighRisk = request.riskLevel === 'high';
    const isStrict = isolation.level === 'strict';

    let shouldRotateSession: boolean;
    let reason: RoutingReason;

    if (isolation.forbidSessionReuse) {
      // Reuse is forbidden outright → always a fresh session.
      shouldRotateSession = true;
      reason = 'forced_rotation';
    } else if (isHighRisk && isolation.forceRotateOnHighRisk) {
      // High-risk request explicitly configured to rotate.
      shouldRotateSession = true;
      reason = 'forced_rotation';
    } else if (isStrict) {
      // Strict isolation forces a fresh, non-reusable session.
      shouldRotateSession = true;
      reason = 'strict_isolation';
    } else if (isHighRisk) {
      // High-risk but rotation not forced — surface as an escalation, no rotate.
      shouldRotateSession = false;
      reason = 'risk_escalation';
    } else if (isolation.level === 'none') {
      // No isolation requirement: plain default routing, reuse untouched.
      shouldRotateSession = false;
      reason = 'default_transport';
    } else {
      // Session/compartment isolation, low/medium risk, reuse permitted.
      shouldRotateSession = false;
      reason = 'reuse_allowed';
    }

    return {
      transportKind: rule.preferredTransport,
      shouldRotateSession,
      isolationLevel: isolation.level,
      reason
    };
  }

  /** List every registered rule. Returns deep copies — never internal state. */
  listRules(): TransportPolicyRule[] {
    return [...this.rules.values()].map((rule) => this.cloneRule(rule));
  }

  /** Remove every registered rule. */
  clearRules(): void {
    this.rules.clear();
  }

  /** Number of registered rules. */
  size(): number {
    return this.rules.size;
  }

  /** Deep copy a rule so internal state and caller objects never alias. */
  private cloneRule(rule: TransportPolicyRule): TransportPolicyRule {
    const isolationPolicy: IsolationPolicy = { ...rule.isolationPolicy };
    return {
      tool: rule.tool,
      riskLevel: rule.riskLevel,
      preferredTransport: rule.preferredTransport,
      isolationPolicy
    };
  }
}
