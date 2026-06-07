/**
 * RuntimePolicyOrchestrator — Sprint 28 MVP.
 *
 * Central arbitration layer that:
 *  1. Collects {@link PolicySignal}s emitted by every gate in the execute pipeline.
 *  2. Detects and records conflicts between incompatible recommendations.
 *  3. Applies the active {@link CompositePrivacyPolicy}'s merge strategy to
 *     produce a single {@link CompositeRuntimeDecision}.
 *  4. Exposes that decision plus all accumulated signals for inspection.
 *
 * Design constraints (all enforced by construction):
 *  - Purely in-memory. No DB, no Redis, no file, no network, no cloud sync.
 *  - Deterministic: given the same ordered signals and policy the decision is
 *    always the same. No randomness, no clocks in the decision path.
 *  - Fail-closed: if `failClosed` is true (the default) and any signal of
 *    severity `"critical"` carries an unknown action, the orchestrator denies.
 *  - No AI, no ML, no NLP, no heuristics beyond the static precedence table.
 *  - All inputs / outputs are copied defensively — no caller mutation can
 *    corrupt internal state.
 *  - Never stores tokens, secrets, or raw request input.
 *  - The signal inspection buffer is BOUNDED (Sprint 29): it never grows past
 *    `maxSignals` (default 500). Overflow evicts the oldest signals FIFO so
 *    memory can never grow without bound. `lastDecision` is preserved across
 *    eviction.
 */

import { randomUUID } from 'node:crypto';
import type {
  CompositePrivacyPolicy,
  CompositeRuntimeDecision,
  PolicyConflict,
  PolicySignal,
  PolicySignalSource,
  UnifiedPrivacyAction
} from './types.js';
import { DEFAULT_COMPOSITE_PRIVACY_POLICY } from './policies.js';
import {
  ACTION_PRECEDENCE,
  ROTATION_ACTIONS,
  moreRestrictive,
  precedenceOf
} from './precedence.js';
import { detectConflicts } from './conflicts.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Default upper bound on the orchestrator's rolling signal inspection buffer. */
export const DEFAULT_MAX_SIGNALS = 500;

/** Construction options for {@link RuntimePolicyOrchestrator}. */
export interface RuntimePolicyOrchestratorOptions {
  /**
   * Maximum number of signals retained in the rolling inspection buffer.
   * Overflow evicts the oldest signals FIFO. Defaults to {@link DEFAULT_MAX_SIGNALS}.
   * Values below 1 are clamped to 1 (fail-closed: the buffer always retains at
   * least the most recent signal).
   */
  maxSignals?: number;
}

/** Result of recording a batch of signals into the bounded buffer. */
export interface RecordSignalsResult {
  /** Number of signals evicted (FIFO) to keep the buffer within `maxSignals`. */
  evicted: number;
}

// ---------------------------------------------------------------------------
// RuntimePolicyOrchestrator
// ---------------------------------------------------------------------------

/**
 * Central runtime policy orchestrator.
 *
 * Usage:
 *
 * ```ts
 * const orchestrator = new RuntimePolicyOrchestrator();
 * // policies are seeded with the default; call registerPolicy to add more
 *
 * orchestrator.emit(signal);           // called by each gate
 * const decision = orchestrator.flush(); // called at end of pipeline
 * ```
 *
 * The orchestrator is stateful: signals accumulate in an in-memory buffer.
 * Call `flush()` to evaluate all buffered signals, produce a decision, store
 * it as `lastDecision`, and clear the signal buffer. Call `reset()` to clear
 * all accumulated signals WITHOUT producing a decision (use for tests only).
 */
export class RuntimePolicyOrchestrator {
  private readonly _policies: Map<string, CompositePrivacyPolicy> = new Map();
  private _signals: PolicySignal[] = [];
  private _lastDecision: CompositeRuntimeDecision | null = null;
  private readonly _maxSignals: number;

  constructor(options: RuntimePolicyOrchestratorOptions = {}) {
    // Fail-closed: a non-positive or non-finite bound is clamped to 1 so the
    // buffer is always bounded and always retains the most recent signal.
    const requested = options.maxSignals ?? DEFAULT_MAX_SIGNALS;
    this._maxSignals = Number.isFinite(requested) ? Math.max(1, Math.floor(requested)) : DEFAULT_MAX_SIGNALS;
    // Seed with the default bootstrap policy.
    this.registerPolicy(DEFAULT_COMPOSITE_PRIVACY_POLICY);
  }

  /** The maximum number of signals retained in the rolling inspection buffer. */
  get maxSignals(): number {
    return this._maxSignals;
  }

  // ---------------------------------------------------------------------------
  // Policy management
  // ---------------------------------------------------------------------------

  /**
   * Register a {@link CompositePrivacyPolicy}.
   *
   * Throws if a policy with the same `id` is already registered.
   */
  registerPolicy(policy: CompositePrivacyPolicy): void {
    if (this._policies.has(policy.id)) {
      throw new Error(
        `RuntimePolicyOrchestrator: policy with id "${policy.id}" is already registered.`
      );
    }
    // Defensive copy — the caller must not mutate it.
    this._policies.set(policy.id, {
      ...policy,
      precedence: [...policy.precedence]
    });
  }

  /** Return all registered policies (defensive copies). */
  listPolicies(): CompositePrivacyPolicy[] {
    return Array.from(this._policies.values()).map((p) => ({
      ...p,
      precedence: [...p.precedence]
    }));
  }

  /** Remove all registered policies. The default policy is NOT re-added automatically. */
  clearPolicies(): void {
    this._policies.clear();
  }

  // ---------------------------------------------------------------------------
  // Signal accumulation
  // ---------------------------------------------------------------------------

  /**
   * Emit a single signal into the orchestrator's rolling inspection buffer.
   *
   * The signal is copied defensively. The buffer is bounded: if appending the
   * signal would exceed `maxSignals`, the oldest signal is evicted FIFO.
   *
   * Returns the number of signals evicted (0 or 1).
   */
  emit(signal: PolicySignal): number {
    return this.recordSignals([signal]).evicted;
  }

  /**
   * Record a batch of signals into the rolling inspection buffer.
   *
   * Signals are copied defensively and appended in order. If the buffer would
   * exceed `maxSignals`, the oldest signals are evicted FIFO until it fits.
   * `lastDecision` is never affected by recording or eviction.
   *
   * Returns how many signals were evicted to stay within `maxSignals`.
   */
  recordSignals(signals: PolicySignal[]): RecordSignalsResult {
    for (const signal of signals) {
      this._signals.push({
        ...signal,
        ...(signal.metadata !== undefined ? { metadata: { ...signal.metadata } } : {})
      });
    }
    let evicted = 0;
    if (this._signals.length > this._maxSignals) {
      evicted = this._signals.length - this._maxSignals;
      // FIFO eviction: drop the oldest signals.
      this._signals.splice(0, evicted);
    }
    return { evicted };
  }

  /** Return all signals currently retained in the bounded buffer (defensive copies). */
  listSignals(): PolicySignal[] {
    return this._signals.map((s) => ({
      ...s,
      ...(s.metadata !== undefined ? { metadata: { ...s.metadata } } : {})
    }));
  }

  /** Number of signals currently retained in the bounded buffer. */
  signalCount(): number {
    return this._signals.length;
  }

  /** Clear the rolling inspection buffer. `lastDecision` is preserved. */
  clearSignals(): void {
    this._signals = [];
  }

  // ---------------------------------------------------------------------------
  // Decision
  // ---------------------------------------------------------------------------

  /** Return the last decision produced by `flush()`, or `null` if none yet. */
  get lastDecision(): CompositeRuntimeDecision | null {
    if (!this._lastDecision) return null;
    return copyDecision(this._lastDecision);
  }

  /**
   * Evaluate the accumulated signals, produce a {@link CompositeRuntimeDecision},
   * store it as `lastDecision`, clear the signal buffer, and return the decision.
   *
   * This is deterministic: given the same signals and policies the result is
   * always the same regardless of call order.
   */
  evaluate(signals: PolicySignal[]): CompositeRuntimeDecision {
    const snapshotSignals = signals.map((s) => ({
      ...s,
      ...(s.metadata !== undefined ? { metadata: { ...s.metadata } } : {})
    }));

    const policy = this._activePolicy();
    const decision = this._decide(snapshotSignals, policy);
    this._lastDecision = decision;
    return copyDecision(decision);
  }

  // ---------------------------------------------------------------------------
  // Internal evaluation
  // ---------------------------------------------------------------------------

  private _activePolicy(): CompositePrivacyPolicy {
    for (const policy of this._policies.values()) {
      if (policy.enabled) return policy;
    }
    // No enabled policy — use a minimal fail-closed default.
    return {
      ...DEFAULT_COMPOSITE_PRIVACY_POLICY,
      id: '__fallback__'
    };
  }

  private _decide(
    signals: PolicySignal[],
    policy: CompositePrivacyPolicy
  ): CompositeRuntimeDecision {
    // No signals → use the policy's default action.
    if (signals.length === 0) {
      return buildDecision(
        policy.defaultAction,
        [],
        [],
        `No signals; default action "${policy.defaultAction}" applied.`
      );
    }

    // Detect conflicts.
    const conflicts = detectConflicts(signals);

    // Merge signals according to the policy's strategy.
    let finalAction: UnifiedPrivacyAction;
    let reason: string;

    switch (policy.mergeStrategy) {
      case 'deny_first':
        ({ action: finalAction, reason } = this._mergeByDenyFirst(signals, policy));
        break;
      case 'source_precedence':
        ({ action: finalAction, reason } = this._mergeBySourcePrecedence(signals, policy));
        break;
      case 'most_restrictive':
      default:
        ({ action: finalAction, reason } = this._mergeByMostRestrictive(signals, policy));
    }

    // Collect all rotation actions (they accumulate).
    const rotations = new Set<UnifiedPrivacyAction>(
      signals.filter((s) => ROTATION_ACTIONS.has(s.action)).map((s) => s.action)
    );

    return buildDecision(finalAction, signals, conflicts, reason, rotations);
  }

  private _mergeByMostRestrictive(
    signals: PolicySignal[],
    policy: CompositePrivacyPolicy
  ): { action: UnifiedPrivacyAction; reason: string } {
    let winner: UnifiedPrivacyAction = 'allow';
    let winnerSource: PolicySignalSource | null = null;
    let winnerReason = '';

    for (const signal of signals) {
      if (signal.action === 'allow') continue;
      if (ROTATION_ACTIONS.has(signal.action)) continue;

      const isMore = precedenceOf(signal.action) > precedenceOf(winner);
      if (isMore) {
        winner = signal.action;
        winnerSource = signal.source;
        winnerReason = signal.reason;
      }
    }

    // fail-closed: critical severity from unknown action → deny
    if (policy.failClosed) {
      for (const signal of signals) {
        if (
          signal.severity === 'critical' &&
          !ACTION_PRECEDENCE.includes(signal.action)
        ) {
          return {
            action: 'deny',
            reason: `Fail-closed: unknown critical signal from "${signal.source}" caused deny.`
          };
        }
      }
    }

    if (winner === 'allow') {
      return {
        action: policy.defaultAction !== 'allow' ? policy.defaultAction : 'allow',
        reason: `All signals allow; default action "${policy.defaultAction}" applied.`
      };
    }

    const sourceLabel = winnerSource ? ` from ${winnerSource}` : '';
    return {
      action: winner,
      reason: `Composite policy selected "${winner}"${sourceLabel}: ${winnerReason}`
    };
  }

  private _mergeByDenyFirst(
    signals: PolicySignal[],
    policy: CompositePrivacyPolicy
  ): { action: UnifiedPrivacyAction; reason: string } {
    const deny = signals.find((s) => s.action === 'deny');
    if (deny) {
      return {
        action: 'deny',
        reason: `deny_first: deny signal from "${deny.source}": ${deny.reason}`
      };
    }
    return this._mergeByMostRestrictive(signals, policy);
  }

  private _mergeBySourcePrecedence(
    signals: PolicySignal[],
    policy: CompositePrivacyPolicy
  ): { action: UnifiedPrivacyAction; reason: string } {
    // Walk the precedence list; pick the first source that has a non-allow signal.
    for (const source of policy.precedence) {
      const signal = signals.find(
        (s) => s.source === source && s.action !== 'allow' && !ROTATION_ACTIONS.has(s.action)
      );
      if (signal) {
        return {
          action: signal.action,
          reason: `source_precedence: "${signal.source}" (highest priority) recommended "${signal.action}": ${signal.reason}`
        };
      }
    }
    return this._mergeByMostRestrictive(signals, policy);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDecision(
  action: UnifiedPrivacyAction,
  signals: PolicySignal[],
  conflicts: PolicyConflict[],
  reason: string,
  rotations?: Set<UnifiedPrivacyAction>
): CompositeRuntimeDecision {
  const blocking: readonly UnifiedPrivacyAction[] = ['deny', 'temporary_block', 'cooldown'];
  const allowed = !blocking.includes(action);

  // Delay is required when the primary action is explicitly "delay", OR when
  // rotations are active alongside a non-blocking action (rotations imply a
  // brief pipeline pause even if the primary action is not "delay").
  const hasRotations = rotations !== undefined && rotations.size > 0;
  const isBlocking = blocking.includes(action);
  const requiresDelay = action === 'delay' || (hasRotations && !isBlocking);

  return {
    action,
    allowed,
    requiresDelay,
    requiresApproval: action === 'require_approval',
    requiresSessionRotation: rotations?.has('rotate_session') ?? false,
    requiresFragmentRotation: rotations?.has('rotate_fragment') ?? false,
    requiresFingerprintRotation: rotations?.has('rotate_fingerprint') ?? false,
    reason,
    signals: signals.map((s) => ({
      ...s,
      ...(s.metadata !== undefined ? { metadata: { ...s.metadata } } : {})
    })),
    conflicts: conflicts.map((c) => ({ ...c, signalIds: [...c.signalIds] }))
  };
}

function copyDecision(d: CompositeRuntimeDecision): CompositeRuntimeDecision {
  return {
    ...d,
    signals: d.signals.map((s) => ({
      ...s,
      ...(s.metadata !== undefined ? { metadata: { ...s.metadata } } : {})
    })),
    conflicts: d.conflicts.map((c) => ({ ...c, signalIds: [...c.signalIds] }))
  };
}
