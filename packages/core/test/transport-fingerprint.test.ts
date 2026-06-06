import { beforeEach, describe, expect, it } from 'vitest'
import {
  HeaderOrderingEngine,
  HeaderRandomizationEngine,
  LanguageIsolationEngine,
  TransportFingerprintEngine,
  UserAgentIsolationEngine,
  permuteHeaders
} from '../src/index.js'

function makeEngine(maxRequestsPerFingerprint = 5): TransportFingerprintEngine {
  let nowValue = 1000
  let idCounter = 0
  return new TransportFingerprintEngine({
    now: () => nowValue++,
    generateId: () => `fp-${++idCounter}`,
    policy: { maxRequestsPerFingerprint }
  })
}

describe('TransportFingerprintEngine', () => {
  let engine: TransportFingerprintEngine

  beforeEach(() => {
    engine = makeEngine()
  })

  it('getOrCreateProfile creates a profile', () => {
    const uaEngine = new UserAgentIsolationEngine()
    const langEngine = new LanguageIsolationEngine()
    const profile = engine.getOrCreateProfile('agent-a')
    expect(profile.agentId).toBe('agent-a')
    expect(profile.activeFingerprintId).toBe('fp-1')
    expect(profile.requestCount).toBe(0)
    // Verify the UA and language come from their respective pools (deterministic)
    expect(uaEngine.listPool()).toContain(profile.assignedUserAgent)
    expect(langEngine.listPool()).toContain(profile.assignedLanguage)
    expect(profile.assignedHeaders['User-Agent']).toBe(profile.assignedUserAgent)
    expect(profile.assignedHeaders['Accept-Language']).toBe(profile.assignedLanguage)
  })

  it('profile assignment is deterministic for the initial fingerprint', () => {
    const first = engine.getOrCreateProfile('agent-a')
    const second = engine.getOrCreateProfile('agent-a')
    expect(second.activeFingerprintId).toBe(first.activeFingerprintId)
    expect(second.assignedHeaders).toEqual(first.assignedHeaders)
  })

  it('evaluateIsolation returns no rotation when fresh', () => {
    const decision = engine.evaluateIsolation({ agentId: 'agent-a' })
    expect(decision.requiresRotation).toBe(false)
    expect(decision.requiresHeaderIsolation).toBe(false)
    expect(decision.correlationRisk).toBe('low')
    expect(decision.reason).toBe('no_rotation_needed')
  })

  it('evaluateIsolation returns rotation when saturated', () => {
    const saturatedEngine = makeEngine(2)
    saturatedEngine.assignFingerprint({ agentId: 'agent-a' })
    saturatedEngine.assignFingerprint({ agentId: 'agent-a' })
    const decision = saturatedEngine.evaluateIsolation({ agentId: 'agent-a' })
    expect(decision.requiresRotation).toBe(true)
    expect(decision.requiresHeaderIsolation).toBe(true)
    expect(decision.correlationRisk).toBe('critical')
    expect(decision.reason).toBe('fingerprint_saturated')
  })

  it('evaluateIsolation returns rotation on persona change', () => {
    const decision = engine.evaluateIsolation({ agentId: 'agent-a', personaChanged: true })
    expect(decision.requiresRotation).toBe(true)
    expect(decision.requiresLanguageIsolation).toBe(true)
    expect(decision.requiresUserAgentIsolation).toBe(true)
    expect(decision.reason).toBe('persona_changed')
  })

  it('evaluateIsolation returns rotation on sensitive category', () => {
    const decision = engine.evaluateIsolation({
      agentId: 'agent-a',
      sensitiveCategoryDetected: true
    })
    expect(decision.requiresRotation).toBe(true)
    expect(decision.reason).toBe('sensitive_category_detected')
  })

  it('rotateFingerprint increments rotationCount and changes UA', () => {
    const uaEngine = new UserAgentIsolationEngine()
    const before = engine.getOrCreateProfile('agent-a')
    const rotated = engine.rotateFingerprint('agent-a')
    expect(rotated.rotationCount).toBe(1)
    expect(rotated.activeFingerprintId).toBe('fp-2')
    // UA should change (rotation 0 vs rotation 1 use different pool indices)
    expect(uaEngine.listPool()).toContain(rotated.assignedUserAgent)
    expect(rotated.assignedUserAgent).not.toBe(before.assignedUserAgent)
  })

  it('assignFingerprint increments requestCount', () => {
    const assigned = engine.assignFingerprint({ agentId: 'agent-a' })
    expect(assigned.requestCount).toBe(1)
    expect(assigned.correlationRisk).toBe('low')
  })

  it('assignFingerprint auto-rotates when saturated', () => {
    const saturatedEngine = makeEngine(1)
    const first = saturatedEngine.assignFingerprint({ agentId: 'agent-a' })
    const second = saturatedEngine.assignFingerprint({ agentId: 'agent-a' })
    expect(first.activeFingerprintId).toBe('fp-1')
    expect(second.activeFingerprintId).toBe('fp-2')
    expect(second.rotationCount).toBe(1)
    expect(second.requestCount).toBe(0)
  })

  it('listProfiles returns defensive copies', () => {
    const [profile] = [engine.assignFingerprint({ agentId: 'agent-a' })]
    const listed = engine.listProfiles()
    listed[0].assignedHeaders['X-Test'] = 'mutated'
    expect(engine.getProfile('agent-a')?.assignedHeaders['X-Test']).toBeUndefined()
    expect(listed[0].activeFingerprintId).toBe(profile.activeFingerprintId)
  })

  it('keeps separate profiles per agent without cross-agent leakage', () => {
    const a = engine.assignFingerprint({ agentId: 'agent-a' })
    const b = engine.getOrCreateProfile('agent-b')
    expect(a.activeFingerprintId).not.toBe(b.activeFingerprintId)
    expect(a.requestCount).toBe(1)
    expect(b.requestCount).toBe(0)
    expect(engine.listProfiles()).toHaveLength(2)
  })

  it('clear resets everything', () => {
    engine.assignFingerprint({ agentId: 'agent-a' })
    engine.rotateFingerprint('agent-a')
    expect(engine.listProfiles()).toHaveLength(1)
    expect(engine.listHeaderProfiles()).toHaveLength(2)
    engine.clear()
    expect(engine.listProfiles()).toHaveLength(0)
    expect(engine.listHeaderProfiles()).toHaveLength(0)
  })

  it('mutating returned profile does not affect internal state', () => {
    const profile = engine.getOrCreateProfile('agent-a')
    const originalUA = profile.assignedUserAgent
    const originalLang = profile.assignedLanguage
    profile.assignedLanguage = 'mutated'
    profile.assignedHeaders['Accept-Language'] = 'mutated'
    const fresh = engine.getProfile('agent-a')!
    expect(fresh.assignedLanguage).toBe(originalLang)
    expect(fresh.assignedHeaders['Accept-Language']).toBe(originalLang)
    expect(fresh.assignedUserAgent).toBe(originalUA)
  })
})

describe('UserAgentIsolationEngine', () => {
  it('selectUserAgent is deterministic', () => {
    const engine = new UserAgentIsolationEngine()
    // Same index → same result (determinism)
    expect(engine.selectUserAgent(0)).toBe(engine.selectUserAgent(0))
    expect(engine.selectUserAgent(1)).toBe(engine.selectUserAgent(1))
    // Different indices → different results (rotation)
    expect(engine.selectUserAgent(0)).not.toBe(engine.selectUserAgent(1))
    expect(engine.listPool()).toHaveLength(engine.poolSize)
  })
})

describe('LanguageIsolationEngine', () => {
  it('selectLanguage is deterministic', () => {
    const engine = new LanguageIsolationEngine()
    // Same index → same result (determinism)
    expect(engine.selectLanguage(0)).toBe(engine.selectLanguage(0))
    expect(engine.selectLanguage(1)).toBe(engine.selectLanguage(1))
    // Different indices → different results (rotation)
    expect(engine.selectLanguage(0)).not.toBe(engine.selectLanguage(1))
    expect(engine.listPool()).toHaveLength(engine.poolSize)
  })
})

describe('HeaderOrderingEngine', () => {
  it('permuteHeaders is deterministic and reproducible', () => {
    const headers = { A: '1', B: '2', C: '3', D: '4' }
    const first = permuteHeaders(headers, 3)
    const second = permuteHeaders(headers, 3)
    const third = permuteHeaders(headers, 4)
    expect(first).toEqual(second)
    expect(first).not.toEqual(third)
  })

  it('applyOrdering returns a permuted record', () => {
    const engine = new HeaderOrderingEngine()
    const ordered = engine.applyOrdering({ A: '1', B: '2', C: '3' }, 2)
    expect(Object.keys(ordered)).toHaveLength(3)
    expect(ordered).toEqual({ ...ordered })
  })
})

describe('HeaderRandomizationEngine', () => {
  it('selectHeaders varies with rotation', () => {
    const engine = new HeaderRandomizationEngine()
    const first = engine.selectHeaders(0, 'ua-a', 'lang-a')
    const second = engine.selectHeaders(1, 'ua-b', 'lang-b')
    expect(first).not.toEqual(second)
    expect(first['User-Agent']).toBe('ua-a')
    expect(second['Accept-Language']).toBe('lang-b')
  })
})
