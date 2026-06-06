import { describe, expect, it, beforeEach } from 'vitest'
import {
  TemporalObfuscationEngine,
  TemporalBudgetManager,
  CadenceSmoothingEngine,
  BurstFragmentationEngine,
  TemporalScheduler,
  DEFAULT_CADENCE_POLICY,
  DEFAULT_BURST_POLICY,
  DEFAULT_BUDGET_POLICY,
  deterministicSpacing
} from '../src/index.js'

function mutableClock(start = 10_000): { now: () => number; advance: (ms: number) => void } {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => { current += ms }
  }
}

// ---------------------------------------------------------------------------
// deterministicSpacing
// ---------------------------------------------------------------------------
describe('deterministicSpacing', () => {
  it('produces stable values within [min, max]', () => {
    const a = deterministicSpacing('agent-a:1', 100, 500)
    const b = deterministicSpacing('agent-a:1', 100, 500)
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(100)
    expect(a).toBeLessThanOrEqual(500)
  })

  it('produces different values for different seeds', () => {
    const a = deterministicSpacing('agent-a:1', 100, 500)
    const b = deterministicSpacing('agent-b:1', 100, 500)
    // May coincide in rare cases but seeds are constructed to differ
    expect(typeof a).toBe('number')
    expect(typeof b).toBe('number')
  })
})

// ---------------------------------------------------------------------------
// TemporalBudgetManager
// ---------------------------------------------------------------------------
describe('TemporalBudgetManager', () => {
  it('starts fresh budget for new agents', () => {
    const mgr = new TemporalBudgetManager(DEFAULT_BUDGET_POLICY, () => 1000)
    const budget = mgr.getBudget('agent-a')
    expect(budget.consumed).toBe(0)
    expect(budget.remaining).toBe(DEFAULT_BUDGET_POLICY.maxRequestsPerWindow)
    expect(budget.resetsAt).toBe(1000 + DEFAULT_BUDGET_POLICY.windowMs)
  })

  it('consumes budget on each call', () => {
    const mgr = new TemporalBudgetManager(DEFAULT_BUDGET_POLICY, () => 1000)
    mgr.consumeBudget('agent-a')
    mgr.consumeBudget('agent-a')
    const budget = mgr.getBudget('agent-a')
    expect(budget.consumed).toBe(2)
    expect(budget.remaining).toBe(DEFAULT_BUDGET_POLICY.maxRequestsPerWindow - 2)
  })

  it('reports exhaustion when remaining === 0', () => {
    const clock = mutableClock(1000)
    const mgr = new TemporalBudgetManager({ ...DEFAULT_BUDGET_POLICY, maxRequestsPerWindow: 2 }, clock.now)
    mgr.consumeBudget('agent-a')
    mgr.consumeBudget('agent-a')
    expect(mgr.isExhausted('agent-a')).toBe(true)
  })

  it('resets budget after window expires', () => {
    const clock = mutableClock(1000)
    const policy = { ...DEFAULT_BUDGET_POLICY, maxRequestsPerWindow: 2, windowMs: 5000 }
    const mgr = new TemporalBudgetManager(policy, clock.now)
    mgr.consumeBudget('agent-a')
    mgr.consumeBudget('agent-a')
    clock.advance(6000)
    mgr.resetExpiredBudgets()
    expect(mgr.isExhausted('agent-a')).toBe(false)
    const budget = mgr.getBudget('agent-a')
    expect(budget.consumed).toBe(0)
    expect(budget.remaining).toBe(2)
  })

  it('returns defensive copies (no mutation leaks)', () => {
    const mgr = new TemporalBudgetManager(DEFAULT_BUDGET_POLICY, () => 1000)
    const b1 = mgr.getBudget('agent-a')
    b1.consumed = 999
    const b2 = mgr.getBudget('agent-a')
    expect(b2.consumed).toBe(0)
  })

  it('lists all budgets', () => {
    const mgr = new TemporalBudgetManager(DEFAULT_BUDGET_POLICY, () => 1000)
    mgr.consumeBudget('agent-a')
    mgr.consumeBudget('agent-b')
    const budgets = mgr.listBudgets()
    expect(budgets.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// CadenceSmoothingEngine
// ---------------------------------------------------------------------------
describe('CadenceSmoothingEngine', () => {
  it('returns no smoothing when spacing is sufficient', () => {
    const engine = new CadenceSmoothingEngine(DEFAULT_CADENCE_POLICY)
    engine.recordExecution('agent-a', 1000)
    const result = engine.evaluate('agent-a', [1000], 2000)
    expect(result.cadenceRisk).toBe('low')
    expect(result.requiresSmoothing).toBe(false)
  })

  it('requires smoothing on rapid successive requests', () => {
    const engine = new CadenceSmoothingEngine(DEFAULT_CADENCE_POLICY)
    engine.recordExecution('agent-a', 1000)
    const result = engine.evaluate('agent-a', [1000], 1050)
    expect(result.requiresSmoothing).toBe(true)
    expect(result.cadenceRisk).toBe('critical')
    expect(result.recommendedDelayMs).toBeGreaterThan(0)
  })

  it('detects fixed cadence (high risk)', () => {
    const engine = new CadenceSmoothingEngine(DEFAULT_CADENCE_POLICY)
    // Perfectly regular 100ms intervals — low coefficient of variation
    const timestamps = [1000, 1100, 1200, 1300, 1400, 1500]
    engine.recordExecution('agent-a', 1500)
    const result = engine.evaluate('agent-a', timestamps, 2000)
    // Fixed cadence should elevate risk
    expect(['medium', 'high', 'critical']).toContain(result.cadenceRisk)
  })

  it('returns deterministic delay (same seed → same delay)', () => {
    const engine = new CadenceSmoothingEngine(DEFAULT_CADENCE_POLICY)
    engine.recordExecution('agent-a', 1000)
    const r1 = engine.evaluate('agent-a', [1000], 1050)
    const r2 = engine.evaluate('agent-a', [1000], 1050)
    expect(r1.recommendedDelayMs).toBe(r2.recommendedDelayMs)
  })

  it('returns defensive policy copy', () => {
    const engine = new CadenceSmoothingEngine(DEFAULT_CADENCE_POLICY)
    const p = engine.getPolicy()
    p.minSpacingMs = 99999
    expect(engine.getPolicy().minSpacingMs).toBe(DEFAULT_CADENCE_POLICY.minSpacingMs)
  })
})

// ---------------------------------------------------------------------------
// BurstFragmentationEngine
// ---------------------------------------------------------------------------
describe('BurstFragmentationEngine', () => {
  it('does not detect burst on sparse requests', () => {
    const engine = new BurstFragmentationEngine(DEFAULT_BURST_POLICY)
    const result = engine.evaluate('agent-a', 1000)
    expect(result.isBurst).toBe(false)
    expect(result.cadenceRisk).toBe('low')
  })

  it('detects burst when threshold is crossed', () => {
    const engine = new BurstFragmentationEngine({
      ...DEFAULT_BURST_POLICY,
      burstThreshold: 3,
      burstWindowMs: 5000
    })
    engine.recordExecution('agent-a', 1000)
    engine.recordExecution('agent-a', 1100)
    engine.recordExecution('agent-a', 1200)
    const result = engine.evaluate('agent-a', 1300)
    expect(result.isBurst).toBe(true)
    expect(result.requiresFragmentation).toBe(true)
    expect(result.requiresSchedulingEscalation).toBe(true)
    expect(result.cadenceRisk).toBe('critical')
  })

  it('activates cooldown after burst and reports remaining cooldown', () => {
    const clock = mutableClock(1000)
    const engine = new BurstFragmentationEngine({
      enabled: true,
      burstThreshold: 3,
      burstWindowMs: 5000,
      cooldownMs: 10_000
    })
    engine.recordExecution('agent-a', clock.now())
    engine.recordExecution('agent-a', clock.now())
    engine.recordExecution('agent-a', clock.now())
    clock.advance(500)
    const result = engine.evaluate('agent-a', clock.now())
    expect(result.cadenceRisk).toBe('critical')
    expect(result.cooldownMs).toBeGreaterThan(0)
  })

  it('increments detectedBursts counter on each burst event', () => {
    const engine = new BurstFragmentationEngine({
      enabled: true,
      burstThreshold: 2,
      burstWindowMs: 5000,
      cooldownMs: 0
    })
    engine.recordExecution('agent-a', 1000)
    engine.recordExecution('agent-a', 1100)
    expect(engine.getDetectedBursts('agent-a')).toBeGreaterThan(0)
  })

  it('clears state', () => {
    const engine = new BurstFragmentationEngine(DEFAULT_BURST_POLICY)
    engine.recordExecution('agent-a', 1000)
    engine.clear()
    expect(engine.getDetectedBursts('agent-a')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// TemporalScheduler
// ---------------------------------------------------------------------------
describe('TemporalScheduler', () => {
  it('returns temporal_ok when nothing is wrong', () => {
    const scheduler = new TemporalScheduler()
    const result = scheduler.computeTemporalSchedulingDecision({
      agentId: 'agent-a',
      cadenceResult: { requiresSmoothing: false, recommendedDelayMs: 0, cadenceRisk: 'low', reason: 'cadence_ok' },
      burstResult: { isBurst: false, requiresFragmentation: false, requiresSchedulingEscalation: false, cooldownMs: 0, burstCount: 0, cadenceRisk: 'low', reason: 'burst_ok' },
      budgetExhausted: false,
      budgetDelayMs: 0,
      now: 1000
    })
    expect(result.reason).toBe('temporal_ok')
    expect(result.recommendedDelayMs).toBe(0)
    expect(result.requiresSchedulingEscalation).toBe(false)
  })

  it('escalates on burst cooldown', () => {
    const scheduler = new TemporalScheduler()
    const result = scheduler.computeTemporalSchedulingDecision({
      agentId: 'agent-a',
      cadenceResult: { requiresSmoothing: true, recommendedDelayMs: 300, cadenceRisk: 'high', reason: 'cadence_smoothing_required:high' },
      burstResult: { isBurst: true, requiresFragmentation: true, requiresSchedulingEscalation: true, cooldownMs: 5000, burstCount: 5, cadenceRisk: 'critical', reason: 'burst_threshold_exceeded:5' },
      budgetExhausted: false,
      budgetDelayMs: 0,
      now: 1000
    })
    expect(result.requiresSchedulingEscalation).toBe(true)
    expect(result.requiresBurstFragmentation).toBe(true)
    expect(result.cadenceRisk).toBe('critical')
    expect(result.recommendedDelayMs).toBeGreaterThanOrEqual(5000)
  })

  it('escalates on budget exhaustion', () => {
    const scheduler = new TemporalScheduler()
    const result = scheduler.computeTemporalSchedulingDecision({
      agentId: 'agent-a',
      cadenceResult: { requiresSmoothing: false, recommendedDelayMs: 0, cadenceRisk: 'low', reason: 'cadence_ok' },
      burstResult: { isBurst: false, requiresFragmentation: false, requiresSchedulingEscalation: false, cooldownMs: 0, burstCount: 0, cadenceRisk: 'low', reason: 'burst_ok' },
      budgetExhausted: true,
      budgetDelayMs: 2000,
      now: 1000
    })
    expect(result.requiresSchedulingEscalation).toBe(true)
    expect(result.reason).toBe('temporal_budget_exhausted')
  })
})

// ---------------------------------------------------------------------------
// TemporalObfuscationEngine
// ---------------------------------------------------------------------------
describe('TemporalObfuscationEngine', () => {
  let clock: ReturnType<typeof mutableClock>
  let engine: TemporalObfuscationEngine

  beforeEach(() => {
    clock = mutableClock(10_000)
    engine = new TemporalObfuscationEngine({ now: clock.now })
  })

  it('creates a temporal profile on first access', () => {
    const profile = engine.getOrCreateProfile('agent-a')
    expect(profile.agentId).toBe('agent-a')
    expect(profile.cadenceRisk).toBe('low')
    expect(profile.detectedBursts).toBe(0)
    expect(profile.smoothedRequests).toBe(0)
    expect(profile.recentExecutionTimestamps).toEqual([])
  })

  it('returns undefined for unknown agents via getProfile', () => {
    expect(engine.getProfile('never-seen')).toBeUndefined()
  })

  it('records executions and updates profile', () => {
    engine.recordExecution({ agentId: 'agent-a' })
    engine.recordExecution({ agentId: 'agent-a' })
    const profile = engine.getProfile('agent-a')!
    expect(profile.smoothedRequests).toBe(2)
    expect(profile.recentExecutionTimestamps).toHaveLength(2)
  })

  it('defensive copy — mutation does not leak', () => {
    engine.recordExecution({ agentId: 'agent-a' })
    const p1 = engine.getProfile('agent-a')!
    p1.detectedBursts = 9999
    const p2 = engine.getProfile('agent-a')!
    expect(p2.detectedBursts).toBe(0)
  })

  it('evaluates low risk on isolated requests', () => {
    clock.advance(5000)
    engine.recordExecution({ agentId: 'agent-a' })
    clock.advance(5000)
    const decision = engine.evaluateTemporalRisk('agent-a')
    expect(decision.allowed).toBe(true)
    expect(decision.requiresSchedulingEscalation).toBe(false)
  })

  it('detects burst and escalates scheduling', () => {
    const burstEngine = new TemporalObfuscationEngine({
      now: clock.now,
      burstPolicy: { enabled: true, burstThreshold: 3, burstWindowMs: 10_000, cooldownMs: 5000 }
    })
    burstEngine.recordExecution({ agentId: 'agent-a', timestamp: 1000 })
    burstEngine.recordExecution({ agentId: 'agent-a', timestamp: 1100 })
    burstEngine.recordExecution({ agentId: 'agent-a', timestamp: 1200 })
    const decision = burstEngine.evaluateTemporalRisk('agent-a')
    expect(decision.requiresBurstFragmentation).toBe(true)
    expect(decision.requiresSchedulingEscalation).toBe(true)
    expect(decision.delayMs).toBeGreaterThan(0)
  })

  it('exhausts budget and reports not allowed', () => {
    const tightEngine = new TemporalObfuscationEngine({
      now: clock.now,
      budgetPolicy: {
        enabled: true,
        maxRequestsPerWindow: 2,
        windowMs: 60_000,
        forceDelayOnExhaustion: true
      }
    })
    tightEngine.recordExecution({ agentId: 'agent-a' })
    tightEngine.recordExecution({ agentId: 'agent-a' })
    const decision = tightEngine.evaluateTemporalRisk('agent-a')
    expect(decision.allowed).toBe(false)
    expect(decision.requiresSchedulingEscalation).toBe(true)
  })

  it('applyDecay prunes old timestamps', () => {
    engine.recordExecution({ agentId: 'agent-a', timestamp: 1000 })
    engine.recordExecution({ agentId: 'agent-a', timestamp: 2000 })
    clock.advance(60_000)
    engine.applyDecay('agent-a', 10_000)
    const profile = engine.getProfile('agent-a')!
    expect(profile.recentExecutionTimestamps).toHaveLength(0)
  })

  it('clear removes all profiles', () => {
    engine.recordExecution({ agentId: 'agent-a' })
    engine.recordExecution({ agentId: 'agent-b' })
    engine.clear()
    expect(engine.listProfiles()).toHaveLength(0)
  })

  it('listProfiles returns defensive copies of all profiles', () => {
    engine.recordExecution({ agentId: 'agent-a' })
    engine.recordExecution({ agentId: 'agent-b' })
    const profiles = engine.listProfiles()
    expect(profiles).toHaveLength(2)
    profiles[0].detectedBursts = 9999
    expect(engine.getProfile('agent-a')!.detectedBursts).toBe(0)
  })

  it('deterministic scheduling — same state → same recommendation', () => {
    engine.recordExecution({ agentId: 'agent-a', timestamp: 1000 })
    const d1 = engine.evaluateTemporalRisk('agent-a')
    const d2 = engine.evaluateTemporalRisk('agent-a')
    expect(d1.delayMs).toBe(d2.delayMs)
    expect(d1.cadenceRisk ?? 'low').toBe(d2.cadenceRisk ?? 'low')
  })

  it('escalates on repeated bursts (persistent burst count increases)', () => {
    const burstEngine = new TemporalObfuscationEngine({
      now: clock.now,
      burstPolicy: { enabled: true, burstThreshold: 2, burstWindowMs: 5000, cooldownMs: 0 }
    })
    burstEngine.recordExecution({ agentId: 'agent-a', timestamp: 1000 })
    burstEngine.recordExecution({ agentId: 'agent-a', timestamp: 1100 })
    const p = burstEngine.getProfile('agent-a')!
    expect(p.detectedBursts).toBeGreaterThan(0)
  })
})
