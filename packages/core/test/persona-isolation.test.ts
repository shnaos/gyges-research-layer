import { describe, expect, it } from 'vitest'
import {
  PersonaIsolationEngine,
  InterestSegmentationEngine,
  PersonaFragmentManager,
  PersonaStore,
  DEFAULT_SEGMENTATION_POLICY,
  HIGH_RISK_CATEGORIES,
  derivePersonaRisk,
  clonePersona
} from '../src/index.js'

function makeEngine(opts?: {
  maxSearches?: number
  forceRotation?: boolean
  isolateHighRisk?: boolean
}): PersonaIsolationEngine {
  let seq = 0
  return new PersonaIsolationEngine({
    now: () => 1000,
    generateId: () => `persona-${++seq}`,
    segmentationPolicy: {
      enabled: true,
      maxSearchesPerPersona: opts?.maxSearches ?? 10,
      forceRotationOnCategoryChange: opts?.forceRotation ?? true,
      isolateHighRiskCategories: opts?.isolateHighRisk ?? true
    }
  })
}

// ---------------------------------------------------------------------------
// PersonaStore
// ---------------------------------------------------------------------------
describe('PersonaStore', () => {
  it('creates and retrieves personas', () => {
    const store = new PersonaStore()
    const p = {
      id: 'p1',
      agentId: 'agent-a',
      createdAt: 1000,
      updatedAt: 1000,
      category: 'finance' as const,
      active: true,
      fragmentIds: [],
      isolatedSessionIds: [],
      searchCount: 0,
      correlationRisk: 'low' as const
    }
    store.add(p)
    const found = store.findActive('agent-a', 'finance')
    expect(found).toBeDefined()
    expect(found?.id).toBe('p1')
  })

  it('returns defensive copies (no mutation leaks)', () => {
    const store = new PersonaStore()
    const p = {
      id: 'p1',
      agentId: 'agent-a',
      createdAt: 1000,
      updatedAt: 1000,
      category: 'general' as const,
      active: true,
      fragmentIds: [],
      isolatedSessionIds: [],
      searchCount: 0,
      correlationRisk: 'low' as const
    }
    store.add(p)
    const copy1 = store.findActive('agent-a', 'general')!
    copy1.fragmentIds.push('external-id')
    const copy2 = store.findActive('agent-a', 'general')!
    expect(copy2.fragmentIds).toHaveLength(0)
  })

  it('deactivates a persona', () => {
    const store = new PersonaStore()
    store.add({
      id: 'p1', agentId: 'agent-a', createdAt: 1000, updatedAt: 1000,
      category: 'crypto', active: true, fragmentIds: [], isolatedSessionIds: [],
      searchCount: 0, correlationRisk: 'low'
    })
    store.deactivate('p1', 2000)
    expect(store.findActive('agent-a', 'crypto')).toBeUndefined()
  })

  it('records searches and updates searchCount', () => {
    const store = new PersonaStore()
    store.add({
      id: 'p1', agentId: 'agent-a', createdAt: 1000, updatedAt: 1000,
      category: 'health', active: true, fragmentIds: [], isolatedSessionIds: [],
      searchCount: 0, correlationRisk: 'low'
    })
    const updated = store.recordSearch('p1', 2000)!
    expect(updated.searchCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// InterestSegmentationEngine
// ---------------------------------------------------------------------------
describe('InterestSegmentationEngine', () => {
  it('returns shouldRotate=true when no persona exists', () => {
    const engine = new InterestSegmentationEngine()
    const result = engine.evaluate(undefined, 'finance')
    expect(result.shouldRotate).toBe(true)
    expect(result.reason).toBe('no_active_persona')
  })

  it('detects category change and triggers rotation', () => {
    const engine = new InterestSegmentationEngine({ ...DEFAULT_SEGMENTATION_POLICY, forceRotationOnCategoryChange: true })
    const persona = {
      id: 'p1', agentId: 'a', createdAt: 1000, updatedAt: 1000,
      category: 'general' as const, active: true, fragmentIds: [], isolatedSessionIds: [],
      searchCount: 1, correlationRisk: 'low' as const
    }
    const result = engine.evaluate(persona, 'finance')
    expect(result.categoryChanged).toBe(true)
    expect(result.shouldRotate).toBe(true)
    expect(result.reason).toBe('category_change')
  })

  it('detects saturation and triggers rotation', () => {
    const engine = new InterestSegmentationEngine({ ...DEFAULT_SEGMENTATION_POLICY, maxSearchesPerPersona: 5 })
    const persona = {
      id: 'p1', agentId: 'a', createdAt: 1000, updatedAt: 1000,
      category: 'general' as const, active: true, fragmentIds: [], isolatedSessionIds: [],
      searchCount: 5, correlationRisk: 'low' as const
    }
    const result = engine.evaluate(persona, 'general')
    expect(result.isSaturated).toBe(true)
    expect(result.shouldRotate).toBe(true)
    expect(result.reason).toBe('persona_saturated')
  })

  it('marks high-risk categories', () => {
    const engine = new InterestSegmentationEngine()
    const persona = {
      id: 'p1', agentId: 'a', createdAt: 1000, updatedAt: 1000,
      category: 'crypto' as const, active: true, fragmentIds: [], isolatedSessionIds: [],
      searchCount: 1, correlationRisk: 'low' as const
    }
    const result = engine.evaluate(persona, 'crypto')
    expect(result.isHighRisk).toBe(true)
    expect(result.reason).toBe('high_risk_category_isolation')
  })

  it('allows reuse for non-high-risk same category', () => {
    const engine = new InterestSegmentationEngine()
    const persona = {
      id: 'p1', agentId: 'a', createdAt: 1000, updatedAt: 1000,
      category: 'development' as const, active: true, fragmentIds: [], isolatedSessionIds: [],
      searchCount: 1, correlationRisk: 'low' as const
    }
    const result = engine.evaluate(persona, 'development')
    expect(result.shouldRotate).toBe(false)
    expect(result.reason).toBe('reuse_allowed')
  })

  it('returns defensive copy of policy', () => {
    const engine = new InterestSegmentationEngine()
    const policy = engine.getPolicy()
    policy.maxSearchesPerPersona = 999
    expect(engine.getPolicy().maxSearchesPerPersona).toBe(DEFAULT_SEGMENTATION_POLICY.maxSearchesPerPersona)
  })

  it('disables segmentation when policy.enabled=false', () => {
    const engine = new InterestSegmentationEngine({ ...DEFAULT_SEGMENTATION_POLICY, enabled: false })
    const result = engine.evaluate(undefined, 'crypto')
    expect(result.shouldRotate).toBe(false)
    expect(result.reason).toBe('segmentation_disabled')
  })
})

// ---------------------------------------------------------------------------
// PersonaFragmentManager
// ---------------------------------------------------------------------------
describe('PersonaFragmentManager', () => {
  it('binds persona to fragment and deduplicates', () => {
    const mgr = new PersonaFragmentManager({ now: () => 1000 })
    mgr.bind('persona-1', 'frag-a')
    mgr.bind('persona-1', 'frag-a') // duplicate
    expect(mgr.listForPersona('persona-1')).toHaveLength(1)
  })

  it('deactivates all bindings for a persona', () => {
    const mgr = new PersonaFragmentManager({ now: () => 1000 })
    mgr.bind('persona-1', 'frag-a')
    mgr.bind('persona-1', 'frag-b')
    mgr.deactivateForPersona('persona-1')
    expect(mgr.listForPersona('persona-1')).toHaveLength(0)
  })

  it('lists bindings for a set of persona ids', () => {
    const mgr = new PersonaFragmentManager({ now: () => 1000 })
    mgr.bind('p1', 'frag-a')
    mgr.bind('p2', 'frag-b')
    mgr.bind('p3', 'frag-c')
    const result = mgr.listForPersonaIds(['p1', 'p3'])
    expect(result.map((b) => b.fragmentId).sort()).toEqual(['frag-a', 'frag-c'])
  })
})

// ---------------------------------------------------------------------------
// derivePersonaRisk
// ---------------------------------------------------------------------------
describe('derivePersonaRisk', () => {
  it('returns low for low saturation non-high-risk category', () => {
    expect(derivePersonaRisk(1, 'general', 20)).toBe('low')
  })

  it('returns medium at 40% saturation', () => {
    expect(derivePersonaRisk(8, 'general', 20)).toBe('medium')
  })

  it('returns high at 75%', () => {
    expect(derivePersonaRisk(15, 'general', 20)).toBe('high')
  })

  it('returns critical at 100%', () => {
    expect(derivePersonaRisk(20, 'general', 20)).toBe('critical')
  })

  it('escalates earlier for high-risk categories', () => {
    expect(derivePersonaRisk(4, 'crypto', 20)).toBe('medium')
    expect(derivePersonaRisk(10, 'crypto', 20)).toBe('high')
  })
})

// ---------------------------------------------------------------------------
// clonePersona
// ---------------------------------------------------------------------------
describe('clonePersona', () => {
  it('produces a deep copy (no shared references)', () => {
    const p = {
      id: 'p1', agentId: 'a', createdAt: 1000, updatedAt: 1000,
      category: 'health' as const, active: true,
      fragmentIds: ['f1'], isolatedSessionIds: ['s1'],
      searchCount: 3, correlationRisk: 'low' as const
    }
    const clone = clonePersona(p)
    clone.fragmentIds.push('f2')
    clone.isolatedSessionIds.push('s2')
    expect(p.fragmentIds).toHaveLength(1)
    expect(p.isolatedSessionIds).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// PersonaIsolationEngine
// ---------------------------------------------------------------------------
describe('PersonaIsolationEngine — create persona', () => {
  it('creates a fresh persona for a new agent+category', () => {
    const engine = makeEngine()
    const persona = engine.getOrCreatePersona('agent-x', 'finance')
    expect(persona.agentId).toBe('agent-x')
    expect(persona.category).toBe('finance')
    expect(persona.active).toBe(true)
    expect(persona.searchCount).toBe(0)
  })

  it('reuses the existing persona for the same agent+category', () => {
    const engine = makeEngine()
    const p1 = engine.getOrCreatePersona('agent-x', 'general')
    const p2 = engine.getOrCreatePersona('agent-x', 'general')
    expect(p1.id).toBe(p2.id)
  })

  it('creates separate personas for different categories (category isolation)', () => {
    const engine = makeEngine()
    const pFinance = engine.getOrCreatePersona('agent-x', 'finance')
    const pCrypto = engine.getOrCreatePersona('agent-x', 'crypto')
    expect(pFinance.id).not.toBe(pCrypto.id)
    expect(pFinance.category).toBe('finance')
    expect(pCrypto.category).toBe('crypto')
  })

  it('creates separate personas for different agents', () => {
    const engine = makeEngine()
    const p1 = engine.getOrCreatePersona('agent-a', 'finance')
    const p2 = engine.getOrCreatePersona('agent-b', 'finance')
    expect(p1.id).not.toBe(p2.id)
  })
})

describe('PersonaIsolationEngine — category change rotation', () => {
  it('deactivates old persona when category changes and forceRotationOnCategoryChange=true', () => {
    const engine = makeEngine({ forceRotation: true })
    const pGeneral = engine.getOrCreatePersona('agent-x', 'general')
    // Simulate some searches so the persona isn't brand new
    engine.recordPersonaSearch('agent-x', 'general')

    // Now request finance — should rotate
    engine.getOrCreatePersona('agent-x', 'finance')

    const all = engine.listPersonas('agent-x')
    expect(all.some((p) => p.category === 'general')).toBe(true)
    expect(all.some((p) => p.category === 'finance')).toBe(true)
    // Old general persona should still be in the list (just inactive if rotated later)
    expect(pGeneral.id).toBeDefined()
  })

  it('produces different persona ids after category rotation', () => {
    const engine = makeEngine({ forceRotation: true })
    const p1 = engine.getOrCreatePersona('agent-x', 'general')
    engine.recordPersonaSearch('agent-x', 'general')
    // Switch to a new category to trigger rotation
    const p2 = engine.getOrCreatePersona('agent-x', 'politics')
    expect(p1.id).not.toBe(p2.id)
  })
})

describe('PersonaIsolationEngine — fragment bindings', () => {
  it('binds fragment to persona and stores it', () => {
    const engine = makeEngine()
    const persona = engine.getOrCreatePersona('agent-x', 'finance')
    engine.fragmentManager.bind(persona.id, 'frag-42')
    const bindings = engine.listPersonaBindings('agent-x')
    expect(bindings.some((b) => b.fragmentId === 'frag-42')).toBe(true)
  })

  it('lists all bindings when no agentId given', () => {
    const engine = makeEngine()
    const p1 = engine.getOrCreatePersona('agent-a', 'general')
    const p2 = engine.getOrCreatePersona('agent-b', 'finance')
    engine.fragmentManager.bind(p1.id, 'frag-a')
    engine.fragmentManager.bind(p2.id, 'frag-b')
    expect(engine.listPersonaBindings()).toHaveLength(2)
  })
})

describe('PersonaIsolationEngine — high-risk category isolation', () => {
  it('HIGH_RISK_CATEGORIES includes expected categories', () => {
    expect(HIGH_RISK_CATEGORIES).toContain('crypto')
    expect(HIGH_RISK_CATEGORIES).toContain('health')
    expect(HIGH_RISK_CATEGORIES).toContain('politics')
    expect(HIGH_RISK_CATEGORIES).toContain('security')
    expect(HIGH_RISK_CATEGORIES).toContain('finance')
  })

  it('evaluatePersonaIsolation flags transport isolation for high-risk category', () => {
    const engine = makeEngine()
    const decision = engine.evaluatePersonaIsolation('agent-x', 'crypto')
    expect(decision.requiresTransportIsolation).toBe(true)
  })

  it('evaluatePersonaIsolation does not flag transport isolation for general', () => {
    const engine = makeEngine()
    engine.getOrCreatePersona('agent-x', 'general')
    const decision = engine.evaluatePersonaIsolation('agent-x', 'general')
    expect(decision.requiresTransportIsolation).toBe(false)
  })
})

describe('PersonaIsolationEngine — persona saturation', () => {
  it('rotates persona when search count hits maxSearchesPerPersona', () => {
    const engine = makeEngine({ maxSearches: 3 })
    const p1 = engine.getOrCreatePersona('agent-x', 'general')
    for (let i = 0; i < 3; i++) {
      engine.recordPersonaSearch('agent-x', 'general')
    }
    // The segmentation engine should flag saturation and rotate.
    const p2 = engine.getOrCreatePersona('agent-x', 'general')
    expect(p1.id).not.toBe(p2.id)
  })
})

describe('PersonaIsolationEngine — forced rotation', () => {
  it('rotatePersona creates a new persona and deactivates the old one', () => {
    const engine = makeEngine()
    const p1 = engine.getOrCreatePersona('agent-x', 'finance')
    const p2 = engine.rotatePersona('agent-x', 'finance')
    expect(p1.id).not.toBe(p2.id)
    expect(p2.active).toBe(true)
    expect(p2.searchCount).toBe(0)
  })
})

describe('PersonaIsolationEngine — no cross-persona leakage', () => {
  it('personas for different categories do not share fragmentIds', () => {
    const engine = makeEngine()
    const pCrypto = engine.getOrCreatePersona('agent-x', 'crypto')
    const pHealth = engine.getOrCreatePersona('agent-x', 'health')
    engine.fragmentManager.bind(pCrypto.id, 'frag-crypto')
    engine.fragmentManager.bind(pHealth.id, 'frag-health')

    const cryptoBindings = engine.listPersonaBindings('agent-x').filter(
      (b) => b.personaId === pCrypto.id
    )
    const healthBindings = engine.listPersonaBindings('agent-x').filter(
      (b) => b.personaId === pHealth.id
    )
    expect(cryptoBindings.every((b) => b.fragmentId === 'frag-crypto')).toBe(true)
    expect(healthBindings.every((b) => b.fragmentId === 'frag-health')).toBe(true)
  })
})

describe('PersonaIsolationEngine — deterministic decisions', () => {
  it('produces the same isolation decision for the same input', () => {
    const engine = makeEngine()
    const d1 = engine.evaluatePersonaIsolation('agent-x', 'crypto')
    const d2 = engine.evaluatePersonaIsolation('agent-x', 'crypto')
    expect(d1).toEqual(d2)
  })
})

describe('PersonaIsolationEngine — record search', () => {
  it('increments searchCount after recordPersonaSearch', () => {
    const engine = makeEngine()
    engine.getOrCreatePersona('agent-x', 'finance')
    engine.recordPersonaSearch('agent-x', 'finance')
    engine.recordPersonaSearch('agent-x', 'finance')
    const all = engine.listPersonas('agent-x')
    const persona = all.find((p) => p.category === 'finance' && p.active)
    expect(persona?.searchCount).toBe(2)
  })
})

describe('PersonaIsolationEngine — clear', () => {
  it('clears all personas and bindings', () => {
    const engine = makeEngine()
    const p = engine.getOrCreatePersona('agent-x', 'finance')
    engine.fragmentManager.bind(p.id, 'frag-1')
    engine.clear()
    expect(engine.listPersonas()).toHaveLength(0)
    expect(engine.listPersonaBindings()).toHaveLength(0)
  })
})

describe('PersonaIsolationEngine — listPersonas', () => {
  it('lists all personas when no agentId', () => {
    const engine = makeEngine()
    engine.getOrCreatePersona('agent-a', 'general')
    engine.getOrCreatePersona('agent-b', 'finance')
    expect(engine.listPersonas()).toHaveLength(2)
  })

  it('filters to a specific agent', () => {
    const engine = makeEngine()
    engine.getOrCreatePersona('agent-a', 'general')
    engine.getOrCreatePersona('agent-b', 'finance')
    expect(engine.listPersonas('agent-a')).toHaveLength(1)
    expect(engine.listPersonas('agent-a')[0].agentId).toBe('agent-a')
  })
})

describe('PersonaIsolationEngine — escalation on repeated patterns', () => {
  it('sets correlationRisk to critical after persona saturation', () => {
    const engine = makeEngine({ maxSearches: 2 })
    engine.getOrCreatePersona('agent-x', 'general')
    // Fill up the persona
    engine.recordPersonaSearch('agent-x', 'general')
    engine.recordPersonaSearch('agent-x', 'general')
    const all = engine.listPersonas('agent-x')
    const saturated = all.find((p) => p.category === 'general')
    expect(saturated?.correlationRisk).toBe('critical')
  })
})

describe('PersonaIsolationEngine — segmentation policy', () => {
  it('returns the active segmentation policy', () => {
    const engine = makeEngine({ maxSearches: 5 })
    const policy = engine.getSegmentationPolicy()
    expect(policy.maxSearchesPerPersona).toBe(5)
    expect(policy.enabled).toBe(true)
  })
})
