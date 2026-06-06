/**
 * sensitive-category-isolation.ts — Sprint 27 example
 *
 * Demonstrates how a sensitive category can trigger immediate fingerprint rotation.
 */

import { TransportFingerprintEngine } from '../../packages/core/src/index.js'

let id = 0
const engine = new TransportFingerprintEngine({
  generateId: () => `fp-${++id}`
})

const agentId = 'demo-agent'
const before = engine.assignFingerprint({ agentId })
const decision = engine.evaluateIsolation({
  agentId,
  sensitiveCategoryDetected: true
})
if (decision.requiresRotation) {
  engine.rotateFingerprint(agentId)
}
const after = engine.assignFingerprint({ agentId })

console.log('before:', before.activeFingerprintId, before.assignedLanguage)
console.log('decision:', decision.reason, decision.requiresRotation)
console.log('after:', after.activeFingerprintId, after.assignedLanguage)
console.log('GRL reduces trivial header correlation; it does not guarantee anonymity.')
