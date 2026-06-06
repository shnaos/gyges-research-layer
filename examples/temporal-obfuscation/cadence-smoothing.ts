/**
 * Cadence Smoothing Example — Sprint 26
 *
 * Demonstrates how CadenceSmoothingEngine detects regular cadence patterns
 * and recommends delays to reduce temporal fingerprinting.
 *
 * This example is entirely in-memory and performs no network, persistence,
 * AI/ML, or browser work. No secrets, tokens, or raw queries are stored.
 */

import { CadenceSmoothingEngine, DEFAULT_CADENCE_POLICY } from '../../packages/core/src/index.js'

const engine = new CadenceSmoothingEngine({
  ...DEFAULT_CADENCE_POLICY,
  minSpacingMs: 500,
  adaptiveSpacing: true,
  burstPenaltyMs: 200
})

const NOW = 100_000

// Simulate a perfectly regular cadence (100 ms apart) — high correlation risk.
const regularTimestamps = [
  NOW - 500,
  NOW - 400,
  NOW - 300,
  NOW - 200,
  NOW - 100
]

console.log('=== Cadence Smoothing Example ===\n')

// Evaluate cadence risk for regular pattern.
const regularResult = engine.evaluate('agent-a', regularTimestamps, NOW)
console.log('Regular 100ms cadence (5 requests):')
console.log('  cadenceRisk:', regularResult.cadenceRisk)
console.log('  requiresSmoothing:', regularResult.requiresSmoothing)
console.log('  recommendedDelayMs:', regularResult.recommendedDelayMs)
console.log('  reason:', regularResult.reason)
console.log()

// Record the execution so the engine knows the last timestamp.
engine.recordExecution('agent-a', NOW)

// Simulate a request immediately after — very fast spacing.
const immediateResult = engine.evaluate('agent-a', [...regularTimestamps, NOW], NOW + 50)
console.log('Request 50ms after last (too fast):')
console.log('  cadenceRisk:', immediateResult.cadenceRisk)
console.log('  requiresSmoothing:', immediateResult.requiresSmoothing)
console.log('  recommendedDelayMs:', immediateResult.recommendedDelayMs)
console.log()

// Simulate well-spaced requests (irregular timing — lower risk).
const irregularTimestamps = [NOW - 2000, NOW - 900, NOW - 300]
const irregularResult = engine.evaluate('agent-b', irregularTimestamps, NOW + 1000)
console.log('Irregular spacing (lower risk):')
console.log('  cadenceRisk:', irregularResult.cadenceRisk)
console.log('  requiresSmoothing:', irregularResult.requiresSmoothing)
console.log()

console.log('Policy:', engine.getPolicy())
console.log()
console.log('NOTE: GRL does not guarantee prevention of all temporal correlation.')
console.log('Cadence smoothing reduces predictable patterns only.')
