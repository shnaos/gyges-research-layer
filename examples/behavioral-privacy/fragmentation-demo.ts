import { BehavioralPrivacyEngine } from '../../packages/core/src/index.js'

let now = 1000
let seq = 0
const engine = new BehavioralPrivacyEngine({
  now: () => now,
  generateId: () => `fragment-${++seq}`
})

for (let i = 0; i < 11; i++) {
  engine.evaluateRequest({ agentId: 'demo-agent' })
  engine.recordBehavior({ agentId: 'demo-agent' })
  now += 1000
}

console.log(
  JSON.stringify(
    {
      profile: engine.getProfile('demo-agent'),
      fragments: engine.fragmentManager.listFragments('demo-agent')
    },
    null,
    2
  )
)
