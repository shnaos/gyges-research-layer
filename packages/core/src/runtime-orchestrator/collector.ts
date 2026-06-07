/**
 * PolicySignalCollector — Sprint 29.
 *
 * A per-request collector that gathers {@link PolicySignal}s from the gates in
 * a single execute / execute-mock pipeline run, then evaluates them into one
 * {@link CompositeRuntimeDecision} via a shared {@link RuntimePolicyOrchestrator}.
 *
 * Why this exists:
 *   - It removes the duplication between the `/v1/capabilities/execute` and
 *     `/v1/capabilities/execute-mock` handlers: both build a collector, emit the
 *     same signal categories from the same gates, and call `evaluate()`.
 *   - It isolates per-request signals. The previous design emitted directly into
 *     the orchestrator's shared buffer and evaluated the WHOLE buffer, so signals
 *     leaked across requests (and across concurrent in-flight requests). The
 *     collector scopes signals to one request; only this request's signals drive
 *     the decision.
 *
 * Design constraints (all enforced by construction):
 *   - Purely in-memory, deterministic, fail-closed.
 *   - No network, no DB, no AI/ML/NLP, no browser, no cloud sync.
 *   - Never stores tokens, secrets, or raw request input — `metadata` must be
 *     minimal and secret-free (the same rule as {@link PolicySignal}).
 *   - All inputs / outputs are copied defensively.
 *   - The per-request buffer is itself bounded by a large defensive cap so a
 *     runaway gate loop cannot grow it without bound. This cap is independent of
 *     the orchestrator's rolling inspection buffer (which owns FIFO eviction and
 *     the eviction audit event).
 */

import type { CompositeRuntimeDecision, PolicySignal } from './types.js';
import { createSignal, type CreateSignalInput } from './signals.js';
import { RuntimePolicyOrchestrator } from './orchestrator.js';

/** Defensive upper bound on the number of signals one request may emit. */
export const DEFAULT_MAX_COLLECTED_SIGNALS = 256;

/** Result of evaluating a request's collected signals. */
export interface CollectorEvaluation {
  /** The composite decision derived from this request's signals only. */
  decision: CompositeRuntimeDecision;
  /**
   * Number of signals the orchestrator's rolling inspection buffer evicted
   * (FIFO) when these signals were recorded. 0 when nothing was evicted.
   */
  evicted: number;
}

export interface PolicySignalCollectorOptions {
  /** Injectable clock for deterministic tests. Defaults to {@link Date.now}. */
  now?: () => number;
  /** Defensive per-request cap. Defaults to {@link DEFAULT_MAX_COLLECTED_SIGNALS}. */
  maxCollectedSignals?: number;
}

/**
 * Collects the signals emitted by one request's gate pipeline.
 *
 * Usage:
 *
 * ```ts
 * const collector = new PolicySignalCollector(orchestrator);
 * collector.emit({ source: 'capability_graph', action: 'allow', severity: 'info', reason: '...' });
 * // ... more gates ...
 * const { decision, evicted } = collector.evaluate();
 * ```
 */
export class PolicySignalCollector {
  private _signals: PolicySignal[] = [];
  private readonly orchestrator: RuntimePolicyOrchestrator;
  private readonly now: () => number;
  private readonly maxCollectedSignals: number;

  constructor(orchestrator: RuntimePolicyOrchestrator, options: PolicySignalCollectorOptions = {}) {
    this.orchestrator = orchestrator;
    this.now = options.now ?? Date.now;
    const requested = options.maxCollectedSignals ?? DEFAULT_MAX_COLLECTED_SIGNALS;
    this.maxCollectedSignals = Number.isFinite(requested)
      ? Math.max(1, Math.floor(requested))
      : DEFAULT_MAX_COLLECTED_SIGNALS;
  }

  /**
   * Emit one normalised signal into this request's buffer.
   *
   * `metadata` MUST be minimal and secret-free (reason codes, risk levels,
   * structural flags only — NO raw input, NO tokens, NO credentials). The
   * signal is created with a fresh UUID and the current timestamp, then stored
   * as a defensive copy. If the per-request defensive cap is reached the oldest
   * collected signal is dropped FIFO (this cap is far above any real pipeline
   * and exists only as a runaway-loop backstop).
   */
  emit(input: CreateSignalInput): void {
    this._signals.push(createSignal(input, this.now));
    if (this._signals.length > this.maxCollectedSignals) {
      this._signals.splice(0, this._signals.length - this.maxCollectedSignals);
    }
  }

  /** Return defensive copies of every signal collected so far. */
  listSignals(): PolicySignal[] {
    return this._signals.map((s) => ({
      ...s,
      ...(s.metadata !== undefined ? { metadata: { ...s.metadata } } : {})
    }));
  }

  /** Number of signals collected so far. */
  size(): number {
    return this._signals.length;
  }

  /** Discard all collected signals without producing a decision. */
  clear(): void {
    this._signals = [];
  }

  /**
   * Record this request's signals into the orchestrator's rolling inspection
   * buffer (bounded; may evict FIFO) and evaluate them into a single composite
   * decision. The decision is derived ONLY from this request's signals, so the
   * rolling buffer's eviction can never change decision correctness.
   *
   * Returns the decision plus how many signals were evicted from the rolling
   * inspection buffer (so the caller can emit an eviction audit event).
   */
  evaluate(): CollectorEvaluation {
    const snapshot = this.listSignals();
    const { evicted } = this.orchestrator.recordSignals(snapshot);
    const decision = this.orchestrator.evaluate(snapshot);
    return { decision, evicted };
  }
}
