/**
 * PrivacyBoundaryEngine — deterministic, fail-closed anti-correlation decisions.
 *
 * The engine owns a set of {@link PrivacyBoundaryRule}s keyed by
 * `(sourceCompartmentId, targetCompartmentId)` and evaluates a
 * {@link PrivacyBoundaryEvaluationInput} into a single
 * {@link PrivacyBoundaryDecision}. It is intentionally minimal and side-effect
 * free:
 *
 *   - deterministic: identical inputs always produce identical decisions
 *   - fail-closed: an unknown target compartment OR a missing `(source, target)`
 *     rule blocks; there is no dangerous implicit fallback
 *   - no silent overwrite: registering a duplicate rule (same id or same
 *     `(source, target)` pair) throws
 *   - no mutation: the incoming input and the stored rules are never mutated;
 *     `evaluate` returns a fresh decision and `listRules` returns deep copies
 *
 * Separation of concerns (Sprint 9 MVP): the engine NEVER mints a session,
 * NEVER rotates a session, NEVER opens a connection, and NEVER runs an
 * execution. It only decides. No real network, browser, DNS, socket,
 * persistence, or AI/semantic classification is performed.
 */

import {
  BoundaryViolation,
  CorrelationRiskLevel,
  CorrelationSignal,
  PrivacyBoundaryAction,
  PrivacyBoundaryDecision,
  PrivacyBoundaryErrorKind,
  PrivacyBoundaryEvaluationInput,
  PrivacyBoundaryRule
} from './types.js';

/** Typed error raised by {@link PrivacyBoundaryEngine} on a misuse. */
export class PrivacyBoundaryError extends Error {
  constructor(
    readonly kind: PrivacyBoundaryErrorKind,
    message: string
  ) {
    super(message);
    this.name = 'PrivacyBoundaryError';
  }
}

/** Build the deterministic map key for a `(source, target)` compartment pair. */
function ruleKey(sourceCompartmentId: string, targetCompartmentId: string): string {
  return `${sourceCompartmentId}\u0000${targetCompartmentId}`;
}

/** Ordinal ranking of a correlation risk level (higher = more dangerous). */
const RISK_RANK: Record<CorrelationRiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3
};

/** Ordinal ranking of a boundary action (higher = more restrictive). */
const ACTION_RANK: Record<PrivacyBoundaryAction, number> = {
  allow: 0,
  rotate_session: 1,
  require_approval: 2,
  block: 3
};

/** Map a capability `RiskLevel` onto its correlation-risk equivalent. */
function toCorrelationRisk(riskLevel: 'low' | 'medium' | 'high'): CorrelationRiskLevel {
  return riskLevel;
}

/** Return the more dangerous of two correlation risk levels. */
function maxRisk(a: CorrelationRiskLevel, b: CorrelationRiskLevel): CorrelationRiskLevel {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}

/** Return the more restrictive of two actions. */
function maxAction(a: PrivacyBoundaryAction, b: PrivacyBoundaryAction): PrivacyBoundaryAction {
  return ACTION_RANK[a] >= ACTION_RANK[b] ? a : b;
}

export class PrivacyBoundaryEngine {
  /** Registered rules keyed by `(source, target)`, in insertion order. */
  private readonly rules = new Map<string, PrivacyBoundaryRule>();
  /** Rule ids already registered, for duplicate-id detection. */
  private readonly ruleIds = new Set<string>();
  /** Every compartment id known to the engine (as source or target). */
  private readonly knownCompartments = new Set<string>();

  /**
   * Register a privacy boundary rule.
   *
   * Throws {@link PrivacyBoundaryError} (`duplicate_rule`) when a rule with the
   * same id, or for the same `(source, target)` pair, already exists — a rule
   * can never be silently replaced. The stored rule is a deep copy, so later
   * mutation of the caller's object can never affect the engine.
   */
  registerRule(rule: PrivacyBoundaryRule): void {
    const key = ruleKey(rule.sourceCompartmentId, rule.targetCompartmentId);
    if (this.ruleIds.has(rule.id)) {
      throw new PrivacyBoundaryError(
        'duplicate_rule',
        `A privacy boundary rule with id "${rule.id}" is already registered.`
      );
    }
    if (this.rules.has(key)) {
      throw new PrivacyBoundaryError(
        'duplicate_rule',
        `A privacy boundary rule for "${rule.sourceCompartmentId}" -> "${rule.targetCompartmentId}" is already registered.`
      );
    }
    this.rules.set(key, this.cloneRule(rule));
    this.ruleIds.add(rule.id);
    this.knownCompartments.add(rule.sourceCompartmentId);
    this.knownCompartments.add(rule.targetCompartmentId);
  }

  /**
   * Evaluate a request into a deterministic {@link PrivacyBoundaryDecision}.
   *
   * Evaluation order (fail-closed throughout):
   *   1. unknown target compartment            → `block` / `high`
   *   2. missing `(source, target)` rule       → `block` / `high` (fail-closed)
   *   3. correlation signals against the rule  → `allow` / `rotate_session` /
   *      `require_approval` / `block`, with the most restrictive action winning
   *
   * The input is never mutated; the returned decision is freshly built.
   */
  evaluate(input: PrivacyBoundaryEvaluationInput): PrivacyBoundaryDecision {
    const target = input.targetCompartmentId;
    // Self-access when no source is supplied: a fresh request enters its target.
    const source = input.sourceCompartmentId ?? target;

    // 1. Unknown target compartment → hard block (fail-closed).
    if (!this.knownCompartments.has(target)) {
      return {
        action: 'block',
        riskLevel: 'high',
        signals: ['unknown_compartment'],
        reason: `Target compartment "${target}" is unknown; blocked fail-closed.`
      };
    }

    // 2. No rule for this exact (source, target) flow → fail-closed block.
    const rule = this.rules.get(ruleKey(source, target));
    if (!rule) {
      const signal: CorrelationSignal =
        source === target ? 'unknown_compartment' : 'cross_compartment';
      return {
        action: 'block',
        riskLevel: 'high',
        signals: [signal],
        reason: `No privacy boundary rule for "${source}" -> "${target}"; blocked fail-closed.`
      };
    }

    // 3. A rule authorises this flow up to maxAllowedRisk; gather correlation
    //    signals and let the most restrictive resulting action win.
    const signals: CorrelationSignal[] = [];
    const violations: BoundaryViolation[] = [];

    const isSameCompartment = source === target;
    signals.push(isSameCompartment ? 'same_compartment' : 'cross_compartment');

    const requestRisk = toCorrelationRisk(input.riskLevel);

    // Cross-compartment access is itself a boundary crossing: even with an
    // explicit rule it is escalated to the rule's violation action.
    if (!isSameCompartment) {
      violations.push({
        ruleId: rule.id,
        signal: 'cross_compartment',
        riskLevel: 'high',
        reason: `Cross-compartment flow "${source}" -> "${target}".`
      });
    }

    // Risk escalation: the request risk exceeds the rule's allowed ceiling.
    if (RISK_RANK[requestRisk] > RISK_RANK[rule.maxAllowedRisk]) {
      if (!signals.includes('risk_escalation')) signals.push('risk_escalation');
      violations.push({
        ruleId: rule.id,
        signal: 'risk_escalation',
        riskLevel: requestRisk === 'high' ? 'high' : 'medium',
        reason: `Request risk "${requestRisk}" exceeds allowed "${rule.maxAllowedRisk}".`
      });
    }

    // Cross-tool reuse: a tool change while cross-tool reuse is forbidden.
    const toolChanged =
      input.previousTool !== undefined && input.previousTool !== input.tool;
    if (toolChanged && input.allowCrossToolReuse === false) {
      if (!signals.includes('cross_tool_reuse')) signals.push('cross_tool_reuse');
      violations.push({
        ruleId: rule.id,
        signal: 'cross_tool_reuse',
        riskLevel: 'medium',
        reason: `Context reuse across tools "${input.previousTool}" -> "${input.tool}" is forbidden.`
      });
    }

    // Strict isolation demanded by the routing layer: force a fresh session.
    if (input.routingIsolationLevel === 'strict') {
      if (!signals.includes('strict_isolation_required')) {
        signals.push('strict_isolation_required');
      }
      violations.push({
        ruleId: rule.id,
        signal: 'strict_isolation_required',
        riskLevel: 'medium',
        reason: 'Routing demands strict isolation; a fresh session is required.'
      });
    }

    // No violation → allow within the boundary.
    if (violations.length === 0) {
      return {
        action: 'allow',
        riskLevel: maxRisk('low', requestRisk),
        signals,
        reason: `Access within privacy boundary "${source}" -> "${target}"; no correlation violation.`
      };
    }

    // Resolve the most restrictive action and highest risk across violations.
    let action: PrivacyBoundaryAction = 'allow';
    let riskLevel: CorrelationRiskLevel = 'none';
    for (const violation of violations) {
      action = maxAction(action, this.actionForViolation(violation, rule));
      riskLevel = maxRisk(riskLevel, violation.riskLevel);
    }

    return {
      action,
      riskLevel,
      signals,
      reason: this.describe(action, violations, source, target)
    };
  }

  /** List every registered rule. Returns deep copies — never internal state. */
  listRules(): PrivacyBoundaryRule[] {
    return [...this.rules.values()].map((rule) => this.cloneRule(rule));
  }

  /** Remove every registered rule and forget all known compartments. */
  clearRules(): void {
    this.rules.clear();
    this.ruleIds.clear();
    this.knownCompartments.clear();
  }

  /** Number of registered rules. */
  size(): number {
    return this.rules.size;
  }

  /**
   * Map a single violation onto a concrete action.
   *
   * - `strict_isolation_required` always rotates (anti-correlation), unless the
   *   rule mandates a stricter `block`.
   * - `cross_tool_reuse` rotates by default, unless the rule mandates `block`.
   * - every other violation (`risk_escalation`, `cross_compartment`) defers to
   *   the rule's `actionOnViolation`.
   */
  private actionForViolation(
    violation: BoundaryViolation,
    rule: PrivacyBoundaryRule
  ): PrivacyBoundaryAction {
    switch (violation.signal) {
      case 'strict_isolation_required':
        return rule.actionOnViolation === 'block' ? 'block' : 'rotate_session';
      case 'cross_tool_reuse':
        return rule.actionOnViolation === 'block' ? 'block' : 'rotate_session';
      default:
        return rule.actionOnViolation;
    }
  }

  /** Build a deterministic human-readable reason for a violating decision. */
  private describe(
    action: PrivacyBoundaryAction,
    violations: BoundaryViolation[],
    source: string,
    target: string
  ): string {
    const signalList = violations.map((violation) => violation.signal).join(', ');
    return `Privacy boundary "${source}" -> "${target}" enforced "${action}" due to correlation signals: ${signalList}.`;
  }

  /** Deep copy a rule so internal state and caller objects never alias. */
  private cloneRule(rule: PrivacyBoundaryRule): PrivacyBoundaryRule {
    return {
      id: rule.id,
      sourceCompartmentId: rule.sourceCompartmentId,
      targetCompartmentId: rule.targetCompartmentId,
      maxAllowedRisk: rule.maxAllowedRisk,
      actionOnViolation: rule.actionOnViolation
    };
  }
}
