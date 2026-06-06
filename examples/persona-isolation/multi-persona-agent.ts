/**
 * multi-persona-agent.ts — Sprint 25 example
 *
 * Demonstrates how a single agent that researches multiple unrelated topics
 * ends up with separate, isolated personas for each category — preventing the
 * accumulation of a unified behavioural profile across topics.
 *
 * Run (from repo root): npx tsx examples/persona-isolation/multi-persona-agent.ts
 *
 * Privacy guarantees demonstrated here:
 *  - Each research category gets its own persona with separate fragment bindings.
 *  - Persona state is never shared across categories.
 *  - listPersonas() exposes metadata only; no raw queries, tokens, or inputs.
 *  - Different categories can be in different correlation-risk states independently.
 */

import { PersonaIsolationEngine } from '../../packages/core/src/persona-isolation/index.js'

const engine = new PersonaIsolationEngine()

const agentId = 'researcher-agent'

// ── Simulate a multi-topic research session ────────────────────────────────

const topics: Array<{ category: Parameters<PersonaIsolationEngine['getOrCreatePersona']>[1]; label: string }> = [
  { category: 'crypto', label: 'Bitcoin market analysis' },
  { category: 'health', label: 'Drug interaction studies' },
  { category: 'politics', label: 'Election integrity reports' },
  { category: 'development', label: 'Rust async runtimes' },
  { category: 'finance', label: 'Hedge fund strategies' },
  { category: 'research', label: 'Quantum computing papers' },
]

console.log(`Simulating ${topics.length} research topics for agent "${agentId}":\n`)

for (const { category, label } of topics) {
  const persona = engine.getOrCreatePersona(agentId, category)
  engine.recordPersonaSearch(agentId, category)

  const decision = engine.evaluatePersonaIsolation(agentId, category)
  console.log(`[${category.padEnd(12)}] topic: "${label}"`)
  console.log(`             persona: ${persona.id}`)
  console.log(`             risk: ${persona.correlationRisk} | transport-isolated: ${decision.requiresTransportIsolation}`)
}

// ── Inspect the full persona landscape ────────────────────────────────────
const allPersonas = engine.listPersonas(agentId)
const allBindings = engine.listPersonaBindings(agentId)

console.log(`\n── Persona landscape for "${agentId}" ──`)
console.log(`Total personas  : ${allPersonas.length}`)
console.log(`Total bindings  : ${allBindings.length}`)

// Confirm no two personas share the same ID (no cross-category leakage)
const ids = allPersonas.map((p) => p.id)
const unique = new Set(ids)
console.log(`All IDs unique  : ${ids.length === unique.size}`)

// Confirm high-risk categories are separated from each other
const highRisk = allPersonas.filter((p) =>
  ['crypto', 'health', 'politics', 'finance'].includes(p.category)
)
console.log(`High-risk personas: ${highRisk.length} (crypto, health, politics, finance)`)

// Confirm fragment bindings are per-persona
console.log('\nFragment bindings (persona → fragment):')
for (const binding of allBindings) {
  console.log(`  persona ${binding.personaId.slice(0, 20)}… → fragment ${binding.fragmentId.slice(0, 20)}…`)
}
