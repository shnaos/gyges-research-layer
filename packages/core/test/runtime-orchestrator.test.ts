/**
 * Sprint 28 — RuntimePolicyOrchestrator unit tests.
 *
 * Covers: register policy, duplicate rejected, no signal → default action,
 * deny wins, rotations merge, fail-closed, conflict detection, defensive copies,
 * precedence determinism, source_precedence strategy, and signal emission.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RuntimePolicyOrchestrator,
  createSignal,
  DEFAULT_COMPOSITE_PRIVACY_POLICY,
  type CompositePrivacyPolicy,
  type PolicySignal
} from '../src/runtime-orchestrator/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sig(
  source: PolicySignal['source'],
  action: PolicySignal['action'],
  severity: PolicySignal['severity'] = 'info',
  reason = 'test'
): PolicySignal {
  return createSignal({ source, action, severity, reason });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RuntimePolicyOrchestrator', () => {
  let orchestrator: RuntimePolicyOrchestrator;

  beforeEach(() => {
    orchestrator = new RuntimePolicyOrchestrator();
  });

  // ── Policy management ──────────────────────────────────────────────────────

  it('seeds with the default composite privacy policy', () => {
    const policies = orchestrator.listPolicies();
    expect(policies).toHaveLength(1);
    expect(policies[0].id).toBe('default-composite-privacy-policy');
  });

  it('registers a new policy', () => {
    const custom: CompositePrivacyPolicy = {
      id: 'custom-policy',
      enabled: false,
      precedence: ['capability_firewall', 'sandbox'],
      defaultAction: 'allow',
      failClosed: true,
      mergeStrategy: 'deny_first'
    };
    orchestrator.registerPolicy(custom);
    expect(orchestrator.listPolicies()).toHaveLength(2);
  });

  it('rejects a duplicate policy id', () => {
    const dup: CompositePrivacyPolicy = {
      ...DEFAULT_COMPOSITE_PRIVACY_POLICY
    };
    expect(() => orchestrator.registerPolicy(dup)).toThrow(
      /already registered/
    );
  });

  it('clearPolicies removes all policies', () => {
    orchestrator.clearPolicies();
    expect(orchestrator.listPolicies()).toHaveLength(0);
  });

  it('listPolicies returns defensive copies', () => {
    const [policy] = orchestrator.listPolicies();
    const originalLength = policy.precedence.length;
    // Push a duplicate entry to mutate the returned copy.
    policy.precedence.push(policy.precedence[0] as never);
    // Internal state must not be mutated: length should be unchanged.
    const [unchanged] = orchestrator.listPolicies();
    expect(unchanged.precedence).toHaveLength(originalLength);
  });

  // ── No signals → default action ───────────────────────────────────────────

  it('returns defaultAction when no signals are provided', () => {
    const decision = orchestrator.evaluate([]);
    expect(decision.action).toBe(DEFAULT_COMPOSITE_PRIVACY_POLICY.defaultAction);
    expect(decision.allowed).toBe(true);
    expect(decision.signals).toHaveLength(0);
    expect(decision.conflicts).toHaveLength(0);
  });

  // ── deny wins ─────────────────────────────────────────────────────────────

  it('deny wins over all other actions', () => {
    const signals: PolicySignal[] = [
      sig('capability_firewall', 'deny', 'critical'),
      sig('temporal_obfuscation', 'delay', 'low'),
      sig('trust_reputation', 'require_approval', 'high'),
      sig('adaptive_defense', 'cooldown', 'medium')
    ];
    const decision = orchestrator.evaluate(signals);
    expect(decision.action).toBe('deny');
    expect(decision.allowed).toBe(false);
  });

  it('temporary_block beats cooldown', () => {
    const signals: PolicySignal[] = [
      sig('adaptive_defense', 'temporary_block', 'high'),
      sig('temporal_obfuscation', 'cooldown', 'medium')
    ];
    const decision = orchestrator.evaluate(signals);
    expect(decision.action).toBe('temporary_block');
    expect(decision.allowed).toBe(false);
  });

  it('cooldown beats require_approval', () => {
    const signals: PolicySignal[] = [
      sig('adaptive_defense', 'cooldown', 'high'),
      sig('capability_firewall', 'require_approval', 'high')
    ];
    const decision = orchestrator.evaluate(signals);
    expect(decision.action).toBe('cooldown');
    expect(decision.allowed).toBe(false);
  });

  it('require_approval beats delay', () => {
    const signals: PolicySignal[] = [
      sig('trust_reputation', 'require_approval', 'high'),
      sig('temporal_obfuscation', 'delay', 'low')
    ];
    const decision = orchestrator.evaluate(signals);
    expect(decision.action).toBe('require_approval');
    expect(decision.requiresApproval).toBe(true);
  });

  // ── Rotation accumulation ─────────────────────────────────────────────────

  it('rotation actions accumulate (all three can be set simultaneously)', () => {
    const signals: PolicySignal[] = [
      sig('persona_isolation', 'rotate_session', 'medium'),
      sig('behavioral_privacy', 'rotate_fragment', 'medium'),
      sig('transport_fingerprint', 'rotate_fingerprint', 'low')
    ];
    const decision = orchestrator.evaluate(signals);
    // With all rotations and no blocking action, the merge strategy uses the
    // default action (all signals are rotation actions, so no non-allow non-rotation
    // action is present).
    expect(decision.requiresSessionRotation).toBe(true);
    expect(decision.requiresFragmentRotation).toBe(true);
    expect(decision.requiresFingerprintRotation).toBe(true);
  });

  it('delay is preserved when rotations are also present', () => {
    const signals: PolicySignal[] = [
      sig('temporal_obfuscation', 'delay', 'low'),
      sig('persona_isolation', 'rotate_fragment', 'medium')
    ];
    const decision = orchestrator.evaluate(signals);
    expect(decision.requiresDelay).toBe(true);
    expect(decision.requiresFragmentRotation).toBe(true);
  });

  // ── fail-closed ───────────────────────────────────────────────────────────

  it('fail-closed: unknown critical action → deny', () => {
    // Inject a signal with an action not in ACTION_PRECEDENCE.
    const signal: PolicySignal = {
      ...createSignal({
        source: 'sandbox',
        action: 'allow',
        severity: 'critical',
        reason: 'unknown'
      }),
      action: 'unknown_future_action' as PolicySignal['action']
    };
    const decision = orchestrator.evaluate([signal]);
    expect(decision.action).toBe('deny');
    expect(decision.allowed).toBe(false);
  });

  // ── Conflict detection ────────────────────────────────────────────────────

  it('detects action conflict between deny and delay signals', () => {
    const signals: PolicySignal[] = [
      sig('capability_firewall', 'deny', 'critical'),
      sig('temporal_obfuscation', 'delay', 'low')
    ];
    const decision = orchestrator.evaluate(signals);
    expect(decision.conflicts.length).toBeGreaterThan(0);
    expect(decision.conflicts[0].conflictType).toBe('approval_vs_deny');
  });

  it('conflict reason is non-empty and informative', () => {
    const signals: PolicySignal[] = [
      sig('capability_firewall', 'deny', 'critical'),
      sig('temporal_obfuscation', 'delay', 'low')
    ];
    const decision = orchestrator.evaluate(signals);
    expect(decision.conflicts[0].reason.length).toBeGreaterThan(0);
  });

  // ── Source precedence strategy ────────────────────────────────────────────

  it('source_precedence strategy picks the highest-precedence source', () => {
    const customPolicy: CompositePrivacyPolicy = {
      id: 'source-prec-test',
      enabled: false,
      precedence: ['capability_firewall', 'trust_reputation', 'temporal_obfuscation'],
      defaultAction: 'allow',
      failClosed: false,
      mergeStrategy: 'source_precedence'
    };
    orchestrator.registerPolicy(customPolicy);

    // Disable the default policy to make the custom one win.
    orchestrator.clearPolicies();
    orchestrator.registerPolicy({ ...customPolicy, enabled: true });

    const signals: PolicySignal[] = [
      sig('temporal_obfuscation', 'delay', 'low'),
      sig('trust_reputation', 'require_approval', 'high'),
      sig('capability_firewall', 'deny', 'critical')
    ];
    const decision = orchestrator.evaluate(signals);
    expect(decision.action).toBe('deny');
    expect(decision.reason).toContain('capability_firewall');
  });

  it('source_precedence is deterministic for the same input', () => {
    orchestrator.clearPolicies();
    orchestrator.registerPolicy({
      id: 'det-test',
      enabled: true,
      precedence: ['trust_reputation', 'adaptive_defense', 'temporal_obfuscation'],
      defaultAction: 'allow',
      failClosed: false,
      mergeStrategy: 'source_precedence'
    });

    const signals: PolicySignal[] = [
      sig('adaptive_defense', 'cooldown', 'high'),
      sig('temporal_obfuscation', 'delay', 'low')
    ];
    const d1 = orchestrator.evaluate(signals);
    const d2 = orchestrator.evaluate(signals);
    expect(d1.action).toBe(d2.action);
    expect(d1.reason).toBe(d2.reason);
  });

  // ── Defensive copies ──────────────────────────────────────────────────────

  it('evaluate() returns a defensive copy (mutation does not affect lastDecision)', () => {
    const signals = [sig('capability_firewall', 'allow', 'info')];
    const decision = orchestrator.evaluate(signals);
    const original = decision.reason;
    // Mutate the returned decision.
    (decision as { reason: string }).reason = 'mutated';
    // lastDecision should still have the original.
    const last = orchestrator.lastDecision;
    expect(last?.reason).toBe(original);
  });

  it('emit() stores signals defensively', () => {
    const signal = sig('sandbox', 'allow', 'info');
    orchestrator.emit(signal);
    signal.reason = 'mutated after emit';
    const [stored] = orchestrator.listSignals();
    expect(stored.reason).toBe('test');
  });

  it('listSignals returns defensive copies', () => {
    orchestrator.emit(sig('capability_firewall', 'deny', 'critical'));
    const [s] = orchestrator.listSignals();
    s.reason = 'mutated';
    const [fresh] = orchestrator.listSignals();
    expect(fresh.reason).not.toBe('mutated');
  });

  // ── lastDecision ──────────────────────────────────────────────────────────

  it('lastDecision is null before any evaluate()', () => {
    const orch = new RuntimePolicyOrchestrator();
    expect(orch.lastDecision).toBeNull();
  });

  it('lastDecision is set after evaluate()', () => {
    orchestrator.evaluate([sig('capability_firewall', 'allow', 'info')]);
    expect(orchestrator.lastDecision).not.toBeNull();
    expect(orchestrator.lastDecision?.action).toBeDefined();
  });

  // ── Signal accumulation ───────────────────────────────────────────────────

  it('emit accumulates signals accessible via listSignals()', () => {
    orchestrator.emit(sig('capability_firewall', 'deny', 'critical'));
    orchestrator.emit(sig('temporal_obfuscation', 'delay', 'low'));
    expect(orchestrator.listSignals()).toHaveLength(2);
  });

  it('createSignal generates unique ids', () => {
    const a = createSignal({ source: 'sandbox', action: 'allow', severity: 'info', reason: 'r' });
    const b = createSignal({ source: 'sandbox', action: 'allow', severity: 'info', reason: 'r' });
    expect(a.id).not.toBe(b.id);
  });

  it('createSignal sets createdAt to a recent timestamp', () => {
    const before = Date.now();
    const signal = createSignal({ source: 'sandbox', action: 'allow', severity: 'info', reason: 'r' });
    const after = Date.now();
    expect(signal.createdAt).toBeGreaterThanOrEqual(before);
    expect(signal.createdAt).toBeLessThanOrEqual(after);
  });

  // ── deny_first strategy ───────────────────────────────────────────────────

  it('deny_first strategy: deny wins immediately regardless of precedence order', () => {
    orchestrator.clearPolicies();
    orchestrator.registerPolicy({
      id: 'deny-first',
      enabled: true,
      precedence: ['capability_firewall'],
      defaultAction: 'allow',
      failClosed: false,
      mergeStrategy: 'deny_first'
    });
    const signals: PolicySignal[] = [
      sig('temporal_obfuscation', 'delay', 'low'),
      sig('trust_reputation', 'deny', 'critical'),
      sig('capability_firewall', 'require_approval', 'high')
    ];
    const decision = orchestrator.evaluate(signals);
    expect(decision.action).toBe('deny');
  });
});
