import { BehavioralPrivacyEngine } from '../../packages/core/src/index.js'

let now = 1000
const engine = new BehavioralPrivacyEngine({
  now: () => now,
  generateId: () => 'frag-demo'
})

for (let i = 0; i < 5; i++) {
  engine.recordBehavior({
    agentId: 'demo-agent',
    topicLabel: 'privacy-guides',
    timestamp: now
  })
  now += 1000
}

const decision = engine.evaluateRequest({ agentId: 'demo-agent', timestamp: now })
console.log(JSON.stringify({ profile: engine.getProfile('demo-agent'), decision }, null, 2))
