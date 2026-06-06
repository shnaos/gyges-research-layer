/**
 * finance-isolation.ts — Sprint 25 example
 *
 * Demonstrates high-risk category isolation for finance/crypto searches.
 * Finance and crypto are HIGH_RISK_CATEGORIES in GRL: they receive stricter
 * isolation decisions and earlier correlation-risk escalation than general
 * research categories.
 *
 * Run (from repo root): npx tsx examples/persona-isolation/finance-isolation.ts
 *
 * Privacy guarantees demonstrated here:
 *  - High-risk categories trigger transport isolation by default.
 *  - Correlation risk escalates faster for sensitive categories.
 *  - Saturated personas rotate automatically; no fragment reuse across rotations.
 */

import {
  PersonaIsolationEngine,
  HIGH_RISK_CATEGORIES,
} from '../../packages/core/src/persona-isolation/index.js'

const engine = new PersonaIsolationEngine()

const agentId = 'finance-agent'

console.log('HIGH_RISK_CATEGORIES:', HIGH_RISK_CATEGORIES)

// ── Step 1: create a finance persona ────────────────────────────────────────
const financePersona = engine.getOrCreatePersona(agentId, 'finance')
console.log('\n[finance] persona id:', financePersona.id)
console.log('[finance] initial correlation risk:', financePersona.correlationRisk)

// ── Step 2: check isolation decision for high-risk ───────────────────────
const isolationDecision = engine.evaluatePersonaIsolation(agentId, 'finance')
console.log('\n[finance] isolation decision:')
console.log('  requiresTransportIsolation:', isolationDecision.requiresTransportIsolation)
console.log('  requiresSessionIsolation  :', isolationDecision.requiresSessionIsolation)
console.log('  reason                   :', isolationDecision.reason)

// ── Step 3: simulate saturation ───────────────────────────────────────────
// Each recordPersonaSearch updates the search count and correlation risk.
const policy = engine.getSegmentationPolicy()
console.log('\nMax searches per persona:', policy.maxSearchesPerPersona)

// Push the persona to saturation (maxSearchesPerPersona exceeded)
for (let i = 0; i < policy.maxSearchesPerPersona; i++) {
  engine.recordPersonaSearch(agentId, 'finance')
}

const saturatedPersona = engine.getOrCreatePersona(agentId, 'finance')
console.log('\n[finance] persona after saturation:')
console.log('  original id  :', financePersona.id)
console.log('  new id       :', saturatedPersona.id)
console.log('  rotated?     :', financePersona.id !== saturatedPersona.id)
// → true: a saturated persona is automatically rotated.

// ── Step 4: crypto isolation ──────────────────────────────────────────────
const cryptoDecision = engine.evaluatePersonaIsolation(agentId, 'crypto')
console.log('\n[crypto] isolation decision:')
console.log('  requiresTransportIsolation:', cryptoDecision.requiresTransportIsolation)
console.log('  requiresNewFragment       :', cryptoDecision.requiresNewFragment)
console.log('  reason                   :', cryptoDecision.reason)
