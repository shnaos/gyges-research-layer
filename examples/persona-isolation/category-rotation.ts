/**
 * category-rotation.ts — Sprint 25 example
 *
 * Demonstrates how GRL's PersonaIsolationEngine triggers persona rotation when
 * the research category changes. Different categories produce different personas,
 * preventing cross-category correlation of an agent's interest graph.
 *
 * Run (from repo root): npx tsx examples/persona-isolation/category-rotation.ts
 *
 * Privacy guarantees demonstrated here:
 *  - Each category gets its own isolated persona.
 *  - Switching categories triggers a new persona (forceRotationOnCategoryChange).
 *  - No raw queries are stored — only structural metadata.
 *  - Personas never share fragment IDs across categories.
 */

import { PersonaIsolationEngine } from '../../packages/core/src/persona-isolation/index.js'

const engine = new PersonaIsolationEngine()

const agentId = 'demo-agent'

// ── Step 1: general research ──────────────────────────────────────────────
const generalPersona = engine.getOrCreatePersona(agentId, 'general')
console.log('[general] persona created:', generalPersona.id, '| category:', generalPersona.category)

engine.recordPersonaSearch(agentId, 'general')
engine.recordPersonaSearch(agentId, 'general')

// ── Step 2: switch to finance ─────────────────────────────────────────────
const financePersona = engine.getOrCreatePersona(agentId, 'finance')
console.log('[finance] persona created:', financePersona.id, '| category:', financePersona.category)

console.log('\nAre they the same persona?', generalPersona.id === financePersona.id)
// → false: category rotation created a new isolated persona.

// ── Step 3: evaluate isolation decision ───────────────────────────────────
const decision = engine.evaluatePersonaIsolation(agentId, 'crypto')
console.log('\n[crypto] isolation decision:')
console.log('  requiresNewFragment      :', decision.requiresNewFragment)
console.log('  requiresSessionIsolation  :', decision.requiresSessionIsolation)
console.log('  requiresTransportIsolation:', decision.requiresTransportIsolation)
console.log('  reason                   :', decision.reason)

// ── Step 4: inspect all personas ──────────────────────────────────────────
const all = engine.listPersonas(agentId)
console.log('\nAll personas for', agentId, ':')
for (const p of all) {
  console.log(`  ${p.category} | id=${p.id} | active=${p.active} | searches=${p.searchCount}`)
}
