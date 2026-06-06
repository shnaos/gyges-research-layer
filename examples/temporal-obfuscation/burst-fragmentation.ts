/**
 * Burst Fragmentation Example — Sprint 26
 *
 * Demonstrates how BurstFragmentationEngine detects rapid request spikes
 * and enforces cooldown periods to reduce temporal correlation risk.
 *
 * Entirely in-memory, no network, no persistence, no AI/ML.
 * No secrets, tokens, or raw queries are stored.
 */

import { BurstFragmentationEngine, DEFAULT_BURST_POLICY } from '../../packages/core/src/index.js'

const engine = new BurstFragmentationEngine({
  ...DEFAULT_BURST_POLICY,
  burstThreshold: 5,
  burstWindowMs: 10_000,
  cooldownMs: 30_000
})

const BASE = 200_000

console.log('=== Burst Fragmentation Example ===\n')

// Simulate 4 requests quickly — below threshold.
for (let i = 0; i < 4; i++) {
  const result = engine.evaluate('agent-a', BASE + i * 100)
  console.log(`Request ${i + 1} at t+${i * 100}ms:`, {
    isBurst: result.isBurst,
    requiresFragmentation: result.requiresFragmentation,
    burstCount: result.burstCount,
    cadenceRisk: result.cadenceRisk,
    reason: result.reason
  })
  engine.record('agent-a', BASE + i * 100)
}

console.log()

// 5th request crosses the burst threshold.
const burstResult = engine.evaluate('agent-a', BASE + 400)
console.log('Request 5 — burst threshold reached:')
console.log('  isBurst:', burstResult.isBurst)
console.log('  requiresFragmentation:', burstResult.requiresFragmentation)
console.log('  requiresSchedulingEscalation:', burstResult.requiresSchedulingEscalation)
console.log('  cooldownMs:', burstResult.cooldownMs)
console.log('  cadenceRisk:', burstResult.cadenceRisk)
console.log('  reason:', burstResult.reason)
engine.record('agent-a', BASE + 400)

console.log()

// During cooldown — any subsequent request is still escalated.
const duringCooldown = engine.evaluate('agent-a', BASE + 5_000)
console.log('Request during cooldown (t+5s):')
console.log('  isBurst:', duringCooldown.isBurst)
console.log('  requiresSchedulingEscalation:', duringCooldown.requiresSchedulingEscalation)
console.log('  cooldownMs:', duringCooldown.cooldownMs)
console.log()

// After cooldown — back to normal.
const afterCooldown = engine.evaluate('agent-a', BASE + 40_000)
console.log('Request after cooldown (t+40s):')
console.log('  isBurst:', afterCooldown.isBurst)
console.log('  requiresSchedulingEscalation:', afterCooldown.requiresSchedulingEscalation)
console.log('  cadenceRisk:', afterCooldown.cadenceRisk)
console.log()

console.log('NOTE: GRL does not prevent all burst patterns at network level.')
console.log('Burst fragmentation reduces detectable spikes in request timing only.')
