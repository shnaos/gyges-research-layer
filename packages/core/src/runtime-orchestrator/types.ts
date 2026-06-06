/**
 * Agent Runtime Policy Orchestrator & Composite Privacy Policies — types.
 *
 * Sprint 28 introduces a central arbitration layer that collects PolicySignals
 * from every existing gate (capability_graph, trust_reputation, behavioral_
 * privacy, persona_isolation, temporal_obfuscation, transport_fingerprint,
 * adaptive_defense, capability_firewall, privacy_boundary, transport_policy,
 * multi_agent, sandbox), normalises them, resolves conflicts, and produces a
 * single CompositeRuntimeDecision that is surfaced on every execute response.
 *
 * Hard constraints:
 *  - Purely in-memory, deterministic, fail-closed.
 *  - No network, no DB, no AI/ML/NLP, no browser, no cloud sync.
 *  - Never stores tokens, secrets, or raw request input.
 *  - Decisions are always explainable; nothing is opaque.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Every subsystem that can emit a {@link PolicySignal}. */
export type PolicySignalSource =
  | 'capability_graph'
  | 'multi_agent'
  | 'behavioral_privacy'
  | 'persona_isolation'
  | 'temporal_obfuscation'
  | 'transport_fingerprint'
  | 'trust_reputation'
  | 'adaptive_defense'
  | 'capability_firewall'
  | 'privacy_boundary'
  | 'transport_policy'
  | 'sandbox';

/** The normalised privacy/security action vocabulary. */
export type UnifiedPrivacyAction =
  | 'allow'
  | 'delay'
  | 'rotate_session'
  | 'rotate_fragment'
  | 'rotate_fingerprint'
  | 'require_approval'
  | 'cooldown'
  | 'temporary_block'
  | 'deny';

/** Urgency of a {@link PolicySignal}, from least to most critical. */
export type PolicySignalSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

// ---------------------------------------------------------------------------
// PolicySignal
// ---------------------------------------------------------------------------

/**
 * A normalised, secret-free signal emitted by one subsystem.
 *
 * Signals are the inputs to the {@link RuntimePolicyOrchestrator}. Each gate
 * in the execute pipeline produces zero or more signals; the orchestrator
 * collects them and resolves a composite decision.
 *
 * `metadata` MUST be minimal and secret-free — no raw input, no tokens, no
 * credentials. Structural facts (reason codes, risk levels, rotation counts)
 * are acceptable.
 */
export interface PolicySignal {
  /** Unique identifier (UUID). */
  id: string;
  /** The subsystem that emitted this signal. */
  source: PolicySignalSource;
  /** Recommended privacy/security action. */
  action: UnifiedPrivacyAction;
  /** Urgency of this signal. */
  severity: PolicySignalSeverity;
  /** Human-readable description of why this signal was raised. */
  reason: string;
  /** Unix-ms timestamp when the signal was created. */
  createdAt: number;
  /** Optional structured metadata (no secrets, no raw input). */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// PolicyConflict
// ---------------------------------------------------------------------------

/** A conflict detected between two or more {@link PolicySignal}s. */
export interface PolicyConflict {
  /** Unique identifier (UUID). */
  id: string;
  /** IDs of the signals involved in this conflict. */
  signalIds: string[];
  /**
   * Type of conflict:
   *  - `action_conflict`    — signals recommend incompatible actions
   *  - `severity_conflict`  — signals have incompatible severity levels
   *  - `timing_conflict`    — delay vs. block timing clash
   *  - `rotation_conflict`  — incompatible rotation actions
   *  - `approval_vs_deny`   — require_approval vs. deny
   *  - `delay_vs_block`     — delay vs. cooldown/block
   */
  conflictType:
    | 'action_conflict'
    | 'severity_conflict'
    | 'timing_conflict'
    | 'rotation_conflict'
    | 'approval_vs_deny'
    | 'delay_vs_block';
  /**
   * How the conflict was resolved:
   *  - `most_restrictive_wins`          — highest-precedence action chosen
   *  - `deny_wins`                      — deny always beats everything
   *  - `approval_wins_over_delay`       — require_approval > delay
   *  - `cooldown_wins_over_delay`       — cooldown > delay
   *  - `merge_non_conflicting`          — non-exclusive actions are cumulated
   */
  resolution:
    | 'most_restrictive_wins'
    | 'deny_wins'
    | 'approval_wins_over_delay'
    | 'cooldown_wins_over_delay'
    | 'merge_non_conflicting';
  /** Human-readable explanation of why this resolution was chosen. */
  reason: string;
}

// ---------------------------------------------------------------------------
// CompositePrivacyPolicy
// ---------------------------------------------------------------------------

/**
 * A policy that governs how the orchestrator evaluates a set of signals.
 *
 * Multiple policies can be registered; the orchestrator picks the first
 * enabled policy. A disabled policy is silently skipped.
 */
export interface CompositePrivacyPolicy {
  /** Unique identifier for this policy (e.g. `"default-composite-privacy-policy"`). */
  id: string;
  /** Whether this policy is active. A disabled policy is never applied. */
  enabled: boolean;
  /**
   * Ordered list of signal sources by decreasing priority.
   *
   * When `mergeStrategy` is `"source_precedence"`, the action recommended by
   * the first source that appears in this list wins.
   */
  precedence: PolicySignalSource[];
  /**
   * Action to apply when there are no signals (or all signals recommend
   * `"allow"`). Defaults to `"allow"`.
   */
  defaultAction: UnifiedPrivacyAction;
  /**
   * When `true` (default), any unknown or unrecognised critical signal causes
   * the orchestrator to `deny` the request rather than allow it. Fail-closed.
   */
  failClosed: boolean;
  /**
   * Strategy to use when merging signals:
   *  - `most_restrictive` — most-restrictive action from the precedence table wins
   *  - `source_precedence` — highest-priority source's action wins
   *  - `deny_first`        — deny if ANY signal recommends deny
   */
  mergeStrategy: 'most_restrictive' | 'source_precedence' | 'deny_first';
}

// ---------------------------------------------------------------------------
// CompositeRuntimeDecision
// ---------------------------------------------------------------------------

/**
 * The composite decision produced by the {@link RuntimePolicyOrchestrator}.
 *
 * This is the single, explainable output of the orchestration layer.
 * It reflects every signal that was considered and every conflict that was
 * detected and resolved.
 */
export interface CompositeRuntimeDecision {
  /** The single unified action to take. */
  action: UnifiedPrivacyAction;
  /** Whether the request is permitted to proceed (action !== 'deny' / 'temporary_block' / 'cooldown'). */
  allowed: boolean;
  /** Whether the request should be delayed before execution. */
  requiresDelay: boolean;
  /** Suggested delay in milliseconds (only meaningful when `requiresDelay` is true). */
  delayMs?: number;
  /** Whether human approval is required before execution. */
  requiresApproval: boolean;
  /** Whether a full session rotation is required. */
  requiresSessionRotation: boolean;
  /** Whether an identity fragment rotation is required. */
  requiresFragmentRotation: boolean;
  /** Whether a transport fingerprint rotation is required. */
  requiresFingerprintRotation: boolean;
  /**
   * Human-readable explanation of how the final action was selected.
   *
   * Always present; never opaque. Cites the winning signal(s) and the
   * conflict resolution strategy that was applied.
   */
  reason: string;
  /** All signals that were evaluated (defensive copies). */
  signals: PolicySignal[];
  /** All conflicts detected (and their resolutions). */
  conflicts: PolicyConflict[];
}
