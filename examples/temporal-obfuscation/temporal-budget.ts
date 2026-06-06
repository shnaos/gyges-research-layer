/**
 * Temporal Budget Example — Sprint 26
 *
 * Demonstrates how TemporalBudgetManager enforces a per-agent request budget
 * within a rolling time window to reduce temporal density correlations.
 *
 * Entirely in-memory, no network, no persistence, no AI/ML.
 * No secrets, tokens, or raw queries are stored.
 */

import { TemporalBudgetManager, DEFAULT_BUDGET_POLICY } from '../../packages/core/src/index.js'

const manager = new TemporalBudgetManager({
  ...DEFAULT_BUDGET_POLICY,
  maxRequestsPerWindow: 5,
  windowMs: 60_000,
  forceDelayOnExhaustion: true
})

const BASE = 300_000

console.log('=== Temporal Budget Example ===\n')

// Consume budget one by one.
for (let i = 0; i < 5; i++) {
  const result = manager.consumeBudget('agent-a', BASE + i * 1_000)
  console.log(`Request ${i + 1}:`, {
    allowed: result.allowed,
    remaining: result.remaining,
    consumed: result.consumed,
    exhausted: result.exhausted
  })
}

console.log()

// 6th request — budget exhausted.
const exhausted = manager.consumeBudget('agent-a', BASE + 5_000)
console.log('Request 6 (budget exhausted):')
console.log('  allowed:', exhausted.allowed)
console.log('  exhausted:', exhausted.exhausted)
console.log('  forceDelayMs:', exhausted.forceDelayMs)
console.log()

// Inspect the current budget.
const budget = manager.getBudget('agent-a', BASE + 5_000)
console.log('Current budget state:')
console.log('  maxRequestsPerWindow:', budget.maxRequestsPerWindow)
console.log('  consumed:', budget.consumed)
console.log('  remaining:', budget.remaining)
console.log('  resetsAt:', new Date(budget.resetsAt).toISOString())
console.log()

// Reset expired budgets (simulating time passage past the window).
manager.resetExpiredBudgets(BASE + 65_000)
const budgetAfterReset = manager.getBudget('agent-a', BASE + 65_000)
console.log('After window reset:')
console.log('  consumed:', budgetAfterReset.consumed)
console.log('  remaining:', budgetAfterReset.remaining)
console.log()

// Independent budget per agent.
manager.consumeBudget('agent-b', BASE)
const budgetB = manager.getBudget('agent-b', BASE + 1_000)
console.log('Independent agent-b budget:')
console.log('  consumed:', budgetB.consumed)
console.log('  remaining:', budgetB.remaining)
console.log()

console.log('NOTE: Temporal budgets do not prevent all request density analysis.')
console.log('They reduce exploitable accumulation patterns within a local window.')
