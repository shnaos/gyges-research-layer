/**
 * user-agent-rotation.ts — Sprint 27 example
 *
 * Demonstrates deterministic User-Agent rotation across fingerprint assignments.
 */

import { TransportFingerprintEngine } from '../../packages/core/src/index.js'

let id = 0
const engine = new TransportFingerprintEngine({
  generateId: () => `fp-${++id}`
})

const agentId = 'demo-agent'

for (let i = 0; i < 3; i++) {
  const profile = i === 0
    ? engine.assignFingerprint({ agentId })
    : engine.rotateFingerprint(agentId)

  console.log(
    `rotation=${profile.rotationCount} fingerprint=${profile.activeFingerprintId} ua=${profile.assignedUserAgent}`
  )
}

console.log('Pool rotation is deterministic: same rotation count -> same User-Agent.')
