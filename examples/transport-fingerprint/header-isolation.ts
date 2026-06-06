/**
 * header-isolation.ts — Sprint 27 example
 *
 * Shows isolated header profiles for different agents.
 */

import { TransportFingerprintEngine } from '../../packages/core/src/index.js'

let id = 0
const engine = new TransportFingerprintEngine({
  generateId: () => `fp-${++id}`
})

const a = engine.assignFingerprint({ agentId: 'agent-a' })
const b = engine.assignFingerprint({ agentId: 'agent-b', forceRotation: true })

console.log('agent-a fingerprint:', a.activeFingerprintId)
console.log(a.assignedHeaders)
console.log()
console.log('agent-b fingerprint:', b.activeFingerprintId)
console.log(b.assignedHeaders)
console.log()
console.log('Header sets stay secret-free and in-memory only.')
