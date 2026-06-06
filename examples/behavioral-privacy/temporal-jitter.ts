import {
  DEFAULT_JITTER_POLICY,
  TemporalPrivacyScheduler
} from '../../packages/core/src/index.js'

const scheduler = new TemporalPrivacyScheduler({
  now: () => 12345,
  jitterPolicy: { ...DEFAULT_JITTER_POLICY, minDelayMs: 100, maxDelayMs: 500 }
})

const result = scheduler.computeDelay({
  agentId: 'demo-agent',
  repeatedBehaviorScore: 45,
  correlationRisk: 'medium'
})

console.log(JSON.stringify(result, null, 2))
