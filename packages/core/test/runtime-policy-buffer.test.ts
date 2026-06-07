/**
 * Sprint 29 — RuntimePolicyOrchestrator bounded signal buffer &
 * PolicySignalCollector unit tests.
 *
 * Covers: maxSignals bound, FIFO eviction with eviction count, lastDecision
 * preserved across eviction, default bound, clamping, per-request collector
 * isolation (no cross-request contamination), defensive copies / no mutation
 * leaks, and the secret-free metadata contract.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RuntimePolicyOrchestrator,
  PolicySignalCollector,
  createSignal,
  DEFAULT_MAX_SIGNALS,
  type PolicySignal
} from '../src/runtime-orchestrator/index.js';

function sig(
  source: PolicySignal['source'],
  action: PolicySignal['action'],
  severity: PolicySignal['severity'] = 'info',
  reason = 'test'
): PolicySignal {
  return createSignal({ source, action, severity, reason });
}

describe('RuntimePolicyOrchestrator bounded signal buffer', () => {
  it('defaults to DEFAULT_MAX_SIGNALS (500)', () => {
    const o = new RuntimePolicyOrchestrator();
    expect(o.maxSignals).toBe(DEFAULT_MAX_SIGNALS);
    expect(DEFAULT_MAX_SIGNALS).toBe(500);
  });

  it('honours a custom maxSignals', () => {
    const o = new RuntimePolicyOrchestrator({ maxSignals: 3 });
    expect(o.maxSignals).toBe(3);
  });

  it('clamps a non-positive maxSignals to 1 (fail-closed, always bounded)', () => {
    expect(new RuntimePolicyOrchestrator({ maxSignals: 0 }).maxSignals).toBe(1);
    expect(new RuntimePolicyOrchestrator({ maxSignals: -10 }).maxSignals).toBe(1);
  });

  it('never grows past maxSignals and evicts FIFO', () => {
    const o = new RuntimePolicyOrchestrator({ maxSignals: 3 });
    for (let i = 0; i < 5; i++) {
      o.emit(sig('multi_agent', 'allow', 'info', `s${i}`));
    }
    const retained = o.listSignals();
    expect(retained).toHaveLength(3);
    // FIFO: the three most recent survive, oldest two evicted.
    expect(retained.map((s) => s.reason)).toEqual(['s2', 's3', 's4']);
    expect(o.signalCount()).toBe(3);
  });

  it('emit() reports the number of evicted signals', () => {
    const o = new RuntimePolicyOrchestrator({ maxSignals: 2 });
    expect(o.emit(sig('multi_agent', 'allow'))).toBe(0);
    expect(o.emit(sig('multi_agent', 'allow'))).toBe(0);
    expect(o.emit(sig('multi_agent', 'allow'))).toBe(1); // overflow → 1 evicted
  });

  it('recordSignals() returns the evicted count for a batch', () => {
    const o = new RuntimePolicyOrchestrator({ maxSignals: 2 });
    const { evicted } = o.recordSignals([
      sig('multi_agent', 'allow'),
      sig('trust_reputation', 'allow'),
      sig('sandbox', 'allow')
    ]);
    expect(evicted).toBe(1);
    expect(o.signalCount()).toBe(2);
  });

  it('preserves lastDecision across eviction', () => {
    const o = new RuntimePolicyOrchestrator({ maxSignals: 2 });
    const decision = o.evaluate([sig('capability_firewall', 'deny', 'critical', 'blocked')]);
    expect(decision.action).toBe('deny');
    expect(o.lastDecision?.action).toBe('deny');
    // Now overflow the buffer; lastDecision must remain unchanged.
    for (let i = 0; i < 5; i++) o.emit(sig('multi_agent', 'allow'));
    expect(o.signalCount()).toBe(2);
    expect(o.lastDecision?.action).toBe('deny');
  });

  it('clearSignals() empties the buffer but keeps lastDecision', () => {
    const o = new RuntimePolicyOrchestrator({ maxSignals: 5 });
    o.evaluate([sig('capability_firewall', 'require_approval', 'high')]);
    o.emit(sig('multi_agent', 'allow'));
    o.clearSignals();
    expect(o.signalCount()).toBe(0);
    expect(o.lastDecision?.action).toBe('require_approval');
  });

  it('listSignals() returns defensive copies (no mutation leak)', () => {
    const o = new RuntimePolicyOrchestrator({ maxSignals: 5 });
    o.emit(createSignal({ source: 'multi_agent', action: 'allow', severity: 'info', reason: 'r', metadata: { k: 1 } }));
    const first = o.listSignals();
    (first[0].metadata as Record<string, unknown>).k = 999;
    first[0].reason = 'mutated';
    const second = o.listSignals();
    expect(second[0].reason).toBe('r');
    expect((second[0].metadata as Record<string, unknown>).k).toBe(1);
  });
});

describe('PolicySignalCollector', () => {
  let orchestrator: RuntimePolicyOrchestrator;

  beforeEach(() => {
    orchestrator = new RuntimePolicyOrchestrator({ maxSignals: 500 });
  });

  it('collects signals and evaluates them into one decision', () => {
    const c = new PolicySignalCollector(orchestrator);
    c.emit({ source: 'capability_graph', action: 'allow', severity: 'info', reason: 'ok' });
    c.emit({ source: 'capability_firewall', action: 'deny', severity: 'critical', reason: 'blocked' });
    expect(c.size()).toBe(2);
    const { decision } = c.evaluate();
    expect(decision.action).toBe('deny');
    expect(decision.signals).toHaveLength(2);
  });

  it('isolates per-request signals (no cross-request contamination)', () => {
    const c1 = new PolicySignalCollector(orchestrator);
    c1.emit({ source: 'capability_firewall', action: 'deny', severity: 'critical', reason: 'r1' });
    const r1 = c1.evaluate();
    expect(r1.decision.action).toBe('deny');

    // A second request that only allows must NOT inherit the first's deny.
    const c2 = new PolicySignalCollector(orchestrator);
    c2.emit({ source: 'capability_graph', action: 'allow', severity: 'info', reason: 'r2' });
    const r2 = c2.evaluate();
    expect(r2.decision.action).toBe('allow');
    expect(r2.decision.signals).toHaveLength(1);
  });

  it('feeds the orchestrator rolling buffer and reports eviction', () => {
    const small = new RuntimePolicyOrchestrator({ maxSignals: 2 });
    const c = new PolicySignalCollector(small);
    c.emit({ source: 'capability_graph', action: 'allow', severity: 'info', reason: 'a' });
    c.emit({ source: 'multi_agent', action: 'allow', severity: 'info', reason: 'b' });
    c.emit({ source: 'sandbox', action: 'allow', severity: 'info', reason: 'c' });
    const { evicted } = c.evaluate();
    expect(evicted).toBe(1);
    expect(small.signalCount()).toBe(2);
  });

  it('clear() discards collected signals without a decision', () => {
    const c = new PolicySignalCollector(orchestrator);
    c.emit({ source: 'multi_agent', action: 'allow', severity: 'info', reason: 'x' });
    c.clear();
    expect(c.size()).toBe(0);
  });

  it('listSignals() returns defensive copies', () => {
    const c = new PolicySignalCollector(orchestrator);
    c.emit({ source: 'multi_agent', action: 'allow', severity: 'info', reason: 'r', metadata: { a: 1 } });
    const copy = c.listSignals();
    (copy[0].metadata as Record<string, unknown>).a = 42;
    expect((c.listSignals()[0].metadata as Record<string, unknown>).a).toBe(1);
  });

  it('only stores the structural fields it was given — no token/raw-input fields', () => {
    const c = new PolicySignalCollector(orchestrator);
    c.emit({
      source: 'multi_agent',
      action: 'allow',
      severity: 'info',
      reason: 'within quota',
      metadata: { agentStatus: 'idle' }
    });
    const [s] = c.listSignals();
    const serialized = JSON.stringify(s);
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('secret');
    // metadata holds only the explicit structural key.
    expect(Object.keys(s.metadata ?? {})).toEqual(['agentStatus']);
  });

  it('caps the per-request buffer defensively (runaway-loop backstop)', () => {
    const c = new PolicySignalCollector(orchestrator, { maxCollectedSignals: 4 });
    for (let i = 0; i < 10; i++) {
      c.emit({ source: 'multi_agent', action: 'allow', severity: 'info', reason: `r${i}` });
    }
    expect(c.size()).toBe(4);
    // Most-recent retained.
    expect(c.listSignals().map((s) => s.reason)).toEqual(['r6', 'r7', 'r8', 'r9']);
  });
});
