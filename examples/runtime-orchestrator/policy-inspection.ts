/**
 * Sprint 28 — Example: inspecting the Runtime Policy Orchestrator.
 *
 * Demonstrates how to inspect registered policies, accumulated signals,
 * and the last produced decision — all without any network or side effects.
 *
 * No network, no AI, no ML, no tokens, no secrets.
 */

import {
  RuntimePolicyOrchestrator,
  createSignal,
  DEFAULT_COMPOSITE_PRIVACY_POLICY
} from '../../packages/core/src/runtime-orchestrator/index.js';

// ── 1. Inspect registered policies ──────────────────────────────────────────

const orchestrator = new RuntimePolicyOrchestrator();

console.log('=== Registered Policies ===\n');
for (const policy of orchestrator.listPolicies()) {
  console.log(`Policy ID        : ${policy.id}`);
  console.log(`Enabled          : ${policy.enabled}`);
  console.log(`failClosed       : ${policy.failClosed}`);
  console.log(`mergeStrategy    : ${policy.mergeStrategy}`);
  console.log(`defaultAction    : ${policy.defaultAction}`);
  console.log(`Precedence order :`);
  for (let i = 0; i < policy.precedence.length; i++) {
    console.log(`  ${String(i + 1).padStart(2)}. ${policy.precedence[i]}`);
  }
  console.log();
}

// ── 2. Register a custom policy ──────────────────────────────────────────────

orchestrator.registerPolicy({
  id: 'research-strict-policy',
  enabled: false, // disabled — will not be used in evaluation
  precedence: ['capability_firewall', 'trust_reputation'],
  defaultAction: 'deny',
  failClosed: true,
  mergeStrategy: 'deny_first'
});

console.log('After registering "research-strict-policy":');
console.log(`  Total policies: ${orchestrator.listPolicies().length}`);
console.log();

// ── 3. Emit signals and inspect them ─────────────────────────────────────────

const sampleSignals = [
  createSignal({
    source: 'capability_firewall',
    action: 'allow',
    severity: 'info',
    reason: 'No firewall rule matched.'
  }),
  createSignal({
    source: 'trust_reputation',
    action: 'require_approval',
    severity: 'high',
    reason: 'Score 61/100 — approval required.'
  }),
  createSignal({
    source: 'behavioral_privacy',
    action: 'rotate_fragment',
    severity: 'medium',
    reason: 'Correlation threshold exceeded.'
  })
];

for (const s of sampleSignals) orchestrator.emit(s);

console.log('=== Accumulated Signals ===\n');
for (const s of orchestrator.listSignals()) {
  console.log(
    `  [${s.severity.padEnd(8)}] ${s.source.padEnd(24)} → ${s.action.padEnd(20)} | ${s.reason}`
  );
}
console.log();

// ── 4. Evaluate and inspect the last decision ─────────────────────────────────

orchestrator.evaluate(sampleSignals);

const last = orchestrator.lastDecision;
if (last) {
  console.log('=== Last Decision ===\n');
  console.log(`Action           : ${last.action}`);
  console.log(`Allowed          : ${last.allowed}`);
  console.log(`Requires approval: ${last.requiresApproval}`);
  console.log(`Fragment rotation: ${last.requiresFragmentRotation}`);
  console.log(`Reason           : ${last.reason}`);
  console.log(`Conflicts        : ${last.conflicts.length}`);
  console.log();
}

// ── 5. Default policy constants are inspectable ───────────────────────────────

console.log('=== DEFAULT_COMPOSITE_PRIVACY_POLICY (bootstrap) ===\n');
console.log(JSON.stringify(DEFAULT_COMPOSITE_PRIVACY_POLICY, null, 2));
