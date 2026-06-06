import { describe, expect, it } from 'vitest'
import {
  BehavioralPrivacyEngine,
  CorrelationEngine,
  DEFAULT_CORRELATION_POLICY,
  DEFAULT_FRAGMENTATION_POLICY,
  DEFAULT_JITTER_POLICY,
  IdentityFragmentManager,
  TemporalPrivacyScheduler,
  deterministicJitter
} from '../src/index.js'

function mutableClock(start = 1000): { now: () => number; set: (value: number) => void } {
  let current = start
  return {
    now: () => current,
    set: (value: number) => {
      current = value
    }
  }
}

describe('behavioral privacy jitter', () => {
  it('computes deterministic jitter within range', () => {
    const first = deterministicJitter('agent-a:1', 50, 200)
    const second = deterministicJitter('agent-a:1', 50, 200)
    const third = deterministicJitter('agent-b:1', 50, 200)
    expect(first).toBe(second)
    expect(first).toBeGreaterThanOrEqual(50)
    expect(first).toBeLessThanOrEqual(200)
    expect(third).toBeGreaterThanOrEqual(50)
    expect(third).toBeLessThanOrEqual(200)
  })

  it('scales scheduler delays adaptively by score and risk', () => {
    const scheduler = new TemporalPrivacyScheduler({
      now: () => 5000,
      jitterPolicy: { ...DEFAULT_JITTER_POLICY, minDelayMs: 100, maxDelayMs: 200 }
    })
    const result = scheduler.computeDelay({
      agentId: 'agent-a',
      repeatedBehaviorScore: 50,
      correlationRisk: 'high'
    })
    expect(result.delayMs).toBeGreaterThanOrEqual(100)
    expect(result.delayMs).toBeLessThanOrEqual(400)
    expect(result.adaptive).toBe(true)
    expect(result.reason).toBe('adaptive_jitter')
  })
})

describe('CorrelationEngine', () => {
  it('tracks repeated topics and temporal patterns', () => {
    const engine = new CorrelationEngine()

    for (let i = 0; i < 5; i++) {
      engine.recordTopic('agent-a', 'privacy-tools', 1000 + i)
    }
    engine.recordAccess('agent-a', 1000)
    engine.recordAccess('agent-a', 1050)
    engine.recordAccess('agent-a', 2000)
    engine.recordAccess('agent-a', 2050)

    expect(engine.repeatedTopicCount('agent-a')).toBe(1)
    expect(engine.temporalPatternCount('agent-a')).toBe(2)
    expect(engine.recentTopics('agent-a')).toEqual(['privacy-tools'])
    expect(engine.updateBehaviorScore('agent-a')).toBe(20)
    expect(engine.classifyRisk(20)).toBe('low')
  })

  it('returns a defensive copy of policy and applies decay', () => {
    const engine = new CorrelationEngine()
    const policy = engine.getPolicy()
    policy.maxBehaviorScore = 1
    expect(engine.getPolicy()).toEqual(DEFAULT_CORRELATION_POLICY)

    for (let i = 0; i < 20; i++) {
      engine.recordAccess('agent-a', i)
    }
    expect(engine.updateBehaviorScore('agent-a')).toBe(95)
    engine.applyDecay('agent-a', 10)
    expect(engine.getBehaviorScore('agent-a')).toBe(85)
  })
})

describe('IdentityFragmentManager', () => {
  it('creates, rotates, expires, and defensively clones fragments', () => {
    const clock = mutableClock(1000)
    let seq = 0
    const manager = new IdentityFragmentManager(
      {
        ...DEFAULT_FRAGMENTATION_POLICY,
        maxRequestsPerFragment: 2,
        fragmentTtlMs: 100
      },
      { now: clock.now, generateId: () => `frag-${++seq}` }
    )

    const first = manager.getActiveFragment('agent-a')
    expect(first.id).toBe('frag-1')
    manager.recordRequest('agent-a', first.id)
    manager.recordRequest('agent-a', first.id)

    const second = manager.getActiveFragment('agent-a')
    expect(second.id).toBe('frag-2')

    const rotated = manager.rotateFragment('agent-a')
    expect(rotated.id).toBe('frag-3')
    expect(manager.activeCount('agent-a')).toBe(1)

    const listed = manager.listFragments('agent-a')
    listed[2].requestCount = 99
    expect(manager.listFragments('agent-a')[2].requestCount).toBe(0)

    clock.set(1200)
    const expired = manager.expireFragments()
    expect(expired.map((fragment) => fragment.id)).toContain('frag-3')
    expect(manager.activeCount('agent-a')).toBe(0)
  })
})

describe('BehavioralPrivacyEngine', () => {
  it('tracks topic labels only and exposes defensive copies', () => {
    const engine = new BehavioralPrivacyEngine({
      now: () => 1000,
      generateId: () => 'frag-1'
    })
    const profile = engine.recordBehavior({
      agentId: 'agent-a',
      topicLabel: 'crypto-research'
    })
    expect(profile.recentSearchTopics).toEqual(['crypto-research'])

    const fetched = engine.getProfile('agent-a')
    expect(fetched?.recentSearchTopics).toEqual(['crypto-research'])
    fetched?.recentSearchTopics.push('mutated')
    expect(engine.getProfile('agent-a')?.recentSearchTopics).toEqual(['crypto-research'])
  })

  it('escalates from low to high to critical across repeated patterned access', () => {
    const clock = mutableClock(1000)
    let seq = 0
    const engine = new BehavioralPrivacyEngine({
      now: clock.now,
      generateId: () => `frag-${++seq}`
    })

    for (let i = 1; i <= 10; i++) {
      clock.set(i * 1000)
      expect(engine.evaluateRequest({ agentId: 'agent-a' }).allowed).toBe(true)
      engine.recordBehavior({ agentId: 'agent-a' })
    }

    clock.set(11000)
    const high = engine.evaluateRequest({ agentId: 'agent-a' })
    expect(high.allowed).toBe(true)
    expect(high.requiresFragmentation).toBe(true)
    expect(high.requiresDelay).toBe(true)
    expect(high.requiresTransportRotation).toBe(true)
    engine.recordBehavior({ agentId: 'agent-a' })
    expect(engine.getProfile('agent-a')?.correlationRisk).toBe('high')

    for (let i = 12; i <= 16; i++) {
      clock.set(i * 1000)
      expect(engine.evaluateRequest({ agentId: 'agent-a' }).allowed).toBe(true)
      engine.recordBehavior({ agentId: 'agent-a' })
    }

    clock.set(17000)
    const critical = engine.evaluateRequest({ agentId: 'agent-a' })
    expect(critical.allowed).toBe(false)
    expect(critical.reason).toBe('critical_correlation_risk')
    expect(engine.getProfile('agent-a')?.correlationRisk).toBe('critical')
  })

  it('refreshes fragment counts, returns defensive policies, decays, and clears', () => {
    const clock = mutableClock(1000)
    let seq = 0
    const engine = new BehavioralPrivacyEngine({
      now: clock.now,
      generateId: () => `frag-${++seq}`
    })

    engine.recordBehavior({ agentId: 'agent-a', topicLabel: 'privacy' })
    const fragment = engine.fragmentManager.getActiveFragment('agent-a')
    engine.fragmentManager.recordRequest('agent-a', fragment.id)
    const refreshed = engine.refreshProfile('agent-a')
    expect(refreshed.activeIdentityFragments).toBe(1)

    const jitterPolicy = engine.getJitterPolicy()
    const fragmentationPolicy = engine.getFragmentationPolicy()
    const correlationPolicy = engine.getCorrelationPolicy()
    jitterPolicy.enabled = false
    fragmentationPolicy.enabled = false
    correlationPolicy.enabled = false
    expect(engine.getJitterPolicy()).toEqual(DEFAULT_JITTER_POLICY)
    expect(engine.getFragmentationPolicy()).toEqual(DEFAULT_FRAGMENTATION_POLICY)
    expect(engine.getCorrelationPolicy()).toEqual(DEFAULT_CORRELATION_POLICY)

    for (let i = 0; i < 20; i++) {
      clock.set(2000 + i)
      engine.recordBehavior({ agentId: 'agent-b' })
    }
    const before = engine.getProfile('agent-b')?.repeatedBehaviorScore ?? 0
    const changed = engine.applyTemporalDecay(10)
    expect(changed.some((profile) => profile.agentId === 'agent-b')).toBe(true)
    expect(engine.getProfile('agent-b')?.repeatedBehaviorScore ?? 0).toBeLessThan(before)

    engine.clear()
    expect(engine.listProfiles()).toEqual([])
    expect(engine.fragmentManager.listAllFragments()).toEqual([])
  })
})
