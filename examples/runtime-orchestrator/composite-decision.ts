/**
 * Sprint 28 — Example: composite runtime decision produced by the orchestrator.
 *
 * Demonstrates a scenario where multiple gates each produce signals and the
 * orchestrator merges them into one explainable CompositeRuntimeDecision.
 *
 * Scenario: persona isolation wants a fragment rotation, transport fingerprint
 * wants a header rotation, temporal obfuscation requests a delay, and trust
 * reputation requires approval. No gate denies the request outright.
 *
 * Expected composite action: require_approval (wins over delay).
 * Rotations: requiresFragmentRotation=true, requiresFingerprintRotation=true.
 * Delay: requiresDelay=true (preserved alongside rotation).
 *
 * No network, no AI, no ML, no tokens, no secrets.
 */

import {
  RuntimePolicyOrchestrator,
  createSignal,
  type CompositeRuntimeDecision
} from '../../packages/core/src/runtime-orchestrator/index.js';

const orchestrator = new RuntimePolicyOrchestrator();

const signals = [
  createSignal({
    source: 'persona_isolation',
    action: 'rotate_fragment',
    severity: 'medium',
    reason: 'Fragment rotation schedule triggered (cycle #7).'
  }),
  createSignal({
    source: 'transport_fingerprint',
    action: 'rotate_fingerprint',
    severity: 'low',
    reason: 'Header pool rotation due after 50 requests.'
  }),
  createSignal({
    source: 'temporal_obfuscation',
    action: 'delay',
    severity: 'low',
    reason: 'Scheduled jitter: 300 ms.'
  }),
  createSignal({
    source: 'trust_reputation',
    action: 'require_approval',
    severity: 'high',
    reason: 'Compartment score 58/100 — requires human approval.'
  })
];

for (const signal of signals) orchestrator.emit(signal);

const decision: CompositeRuntimeDecision = orchestrator.evaluate(signals);

console.log('--- Composite Decision Example ---\n');

function flag(label: string, value: boolean): string {
  return `${label.padEnd(32)}: ${value ? '✓' : '✗'}`;
}

console.log('Final action     :', decision.action);
console.log('Reason           :', decision.reason);
console.log();
console.log(flag('allowed', decision.allowed));
console.log(flag('requiresApproval', decision.requiresApproval));
console.log(flag('requiresDelay', decision.requiresDelay));
if (decision.delayMs !== undefined) {
  console.log('  delayMs        :', decision.delayMs);
}
console.log(flag('requiresSessionRotation', decision.requiresSessionRotation));
console.log(flag('requiresFragmentRotation', decision.requiresFragmentRotation));
console.log(flag('requiresFingerprintRotation', decision.requiresFingerprintRotation));
console.log();
console.log('Signals :', decision.signals.length);
console.log('Conflicts:', decision.conflicts.length);
for (const c of decision.conflicts) {
  console.log(`  → ${c.reason}`);
}
console.log();
console.log(JSON.stringify(decision, null, 2));
