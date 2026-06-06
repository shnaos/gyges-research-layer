/**
 * Sprint 28 — Example: conflict resolution in the RuntimePolicyOrchestrator.
 *
 * Demonstrates how conflicting signals from different privacy gates are
 * detected and resolved deterministically by the most_restrictive strategy.
 *
 * No network, no AI, no ML, no tokens, no secrets.
 */

import {
  RuntimePolicyOrchestrator,
  createSignal
} from '../../packages/core/src/runtime-orchestrator/index.js';

const orchestrator = new RuntimePolicyOrchestrator();

// Simulate signals arriving from several gates simultaneously:
// - Temporal obfuscation wants a small delay.
// - Trust reputation engine requires approval for this compartment.
// - Adaptive defense engine has triggered a cooldown.
// - Capability firewall outright denies the request.
const signals = [
  createSignal({
    source: 'temporal_obfuscation',
    action: 'delay',
    severity: 'low',
    reason: 'Jitter schedule active for this agent.'
  }),
  createSignal({
    source: 'trust_reputation',
    action: 'require_approval',
    severity: 'high',
    reason: 'Compartment trust score is below threshold (42/100).'
  }),
  createSignal({
    source: 'adaptive_defense',
    action: 'cooldown',
    severity: 'medium',
    reason: 'Rate limit exceeded — cooldown window active.'
  }),
  createSignal({
    source: 'capability_firewall',
    action: 'deny',
    severity: 'critical',
    reason: 'Firewall rule "block-rogue-agents" matched.'
  })
];

// Emit them into the orchestrator buffer.
for (const signal of signals) {
  orchestrator.emit(signal);
}

// Evaluate — returns a single, explainable composite decision.
const decision = orchestrator.evaluate(signals);

console.log('--- Conflict Resolution Example ---\n');
console.log('Final action  :', decision.action);
console.log('Allowed       :', decision.allowed);
console.log('Reason        :', decision.reason);
console.log('\nConflicts detected:');
for (const c of decision.conflicts) {
  console.log(`  [${c.conflictType}] ${c.reason}  (resolution: ${c.resolution})`);
}
console.log('\nSignals contributed:');
for (const s of decision.signals) {
  console.log(`  ${s.source.padEnd(24)} action=${s.action.padEnd(18)} severity=${s.severity}`);
}
console.log();
console.log(JSON.stringify(decision, null, 2));
