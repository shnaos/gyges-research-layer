import type {
  CadenceRisk,
  RecordExecutionInput,
  TemporalObfuscationDecision,
  TemporalObfuscationEngineOptions,
  TemporalPrivacyBudget,
  TemporalProfile
} from './types.js'
import { DEFAULT_CADENCE_POLICY, CadenceSmoothingEngine } from './cadence.js'
import { DEFAULT_BURST_POLICY, BurstFragmentationEngine } from './burst.js'
import { DEFAULT_BUDGET_POLICY, TemporalBudgetManager } from './budget.js'
import { TemporalScheduler } from './scheduler.js'

const MAX_RECENT_TIMESTAMPS = 20
const BUDGET_DELAY_ON_EXHAUSTION_MS = 2000

function cloneProfile(p: TemporalProfile): TemporalProfile {
  return {
    agentId: p.agentId,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    cadenceRisk: p.cadenceRisk,
    recentExecutionTimestamps: [...p.recentExecutionTimestamps],
    detectedBursts: p.detectedBursts,
    smoothedRequests: p.smoothedRequests,
    temporalBudget: { ...p.temporalBudget },
    currentDelayMs: p.currentDelayMs
  }
}

/**
 * TemporalObfuscationEngine — Sprint 26 core engine.
 *
 * Orchestrates cadence smoothing, burst fragmentation, and temporal privacy
 * budgets to reduce the temporal correlation fingerprint of AI agents.
 *
 * Design constraints:
 *  - deterministic, in-memory only
 *  - no AI / NLP / ML
 *  - no cloud sync, no persistence, no browser, no network
 *  - fail-closed
 *  - defensive copies at every public boundary
 *  - no real sleeps — produces delay recommendations only
 */
export class TemporalObfuscationEngine {
  private readonly now: () => number
  private readonly profiles = new Map<string, TemporalProfile>()
  readonly cadenceEngine: CadenceSmoothingEngine
  readonly burstEngine: BurstFragmentationEngine
  readonly budgetManager: TemporalBudgetManager
  readonly scheduler: TemporalScheduler

  constructor(options: TemporalObfuscationEngineOptions = {}) {
    this.now = options.now ?? Date.now
    this.cadenceEngine = new CadenceSmoothingEngine(options.cadencePolicy ?? DEFAULT_CADENCE_POLICY)
    this.burstEngine = new BurstFragmentationEngine(options.burstPolicy ?? DEFAULT_BURST_POLICY)
    this.budgetManager = new TemporalBudgetManager(options.budgetPolicy ?? DEFAULT_BUDGET_POLICY, this.now)
    this.scheduler = new TemporalScheduler()
  }

  // ---------------------------------------------------------------------------
  // Core API
  // ---------------------------------------------------------------------------

  /** Get or create the temporal profile for agentId. Returns a defensive copy. */
  getOrCreateProfile(agentId: string): TemporalProfile {
    return cloneProfile(this.ensureProfile(agentId))
  }

  /** Get the profile for agentId if it exists. Returns a defensive copy or undefined. */
  getProfile(agentId: string): TemporalProfile | undefined {
    const p = this.profiles.get(agentId)
    return p ? cloneProfile(p) : undefined
  }

  /** List all temporal profiles (defensive copies). */
  listProfiles(): TemporalProfile[] {
    return [...this.profiles.values()].map(cloneProfile)
  }

  /**
   * Evaluate temporal obfuscation risk and return a decision.
   * Does NOT mutate any state — use recordExecution afterwards.
   */
  evaluateTemporalRisk(agentId: string, at?: number): TemporalObfuscationDecision {
    const ts = at ?? this.now()
    const profile = this.ensureProfile(agentId)

    const cadenceResult = this.cadenceEngine.evaluate(agentId, profile.recentExecutionTimestamps, ts)
    const burstResult = this.burstEngine.evaluate(agentId, ts)
    const budgetExhausted = this.budgetManager.isExhausted(agentId, ts)

    const decision = this.scheduler.computeTemporalSchedulingDecision({
      agentId,
      cadenceResult,
      burstResult,
      budgetExhausted,
      budgetDelayMs: BUDGET_DELAY_ON_EXHAUSTION_MS,
      now: ts
    })

    const allowed = !budgetExhausted || !this.budgetManager.getPolicy().forceDelayOnExhaustion

    return {
      allowed,
      requiresDelay: decision.recommendedDelayMs > 0,
      delayMs: decision.recommendedDelayMs,
      requiresCadenceSmoothing: decision.requiresCadenceSmoothing,
      requiresBurstFragmentation: decision.requiresBurstFragmentation,
      requiresSchedulingEscalation: decision.requiresSchedulingEscalation,
      reason: decision.reason
    }
  }

  /**
   * Record that a request was executed at the given timestamp.
   * Updates profile state: timestamps, burst counters, budget, cadence.
   * Returns the updated profile (defensive copy).
   */
  recordExecution(input: RecordExecutionInput): TemporalProfile {
    const ts = input.timestamp ?? this.now()
    const profile = this.ensureProfile(input.agentId)

    // Update sub-engines.
    this.cadenceEngine.recordExecution(input.agentId, ts)
    this.burstEngine.recordExecution(input.agentId, ts)
    const budget = this.budgetManager.consumeBudget(input.agentId, ts)

    // Update profile state.
    profile.recentExecutionTimestamps.push(ts)
    if (profile.recentExecutionTimestamps.length > MAX_RECENT_TIMESTAMPS) {
      profile.recentExecutionTimestamps.shift()
    }
    profile.detectedBursts = this.burstEngine.getDetectedBursts(input.agentId)
    profile.smoothedRequests++
    profile.temporalBudget = { ...budget }
    profile.updatedAt = ts

    // Recompute cadence risk from current timestamps.
    const cadenceResult = this.cadenceEngine.evaluate(
      input.agentId,
      profile.recentExecutionTimestamps,
      ts
    )
    profile.cadenceRisk = cadenceResult.cadenceRisk
    profile.currentDelayMs = cadenceResult.recommendedDelayMs

    return cloneProfile(profile)
  }

  /**
   * Apply decay to cadence patterns: prune timestamps older than windowMs.
   * Used for long-running agents to avoid unbounded memory growth.
   */
  applyDecay(agentId: string, windowMs: number): void {
    const profile = this.profiles.get(agentId)
    if (!profile) return
    const cutoff = this.now() - windowMs
    profile.recentExecutionTimestamps = profile.recentExecutionTimestamps.filter(
      (ts) => ts >= cutoff
    )
    profile.updatedAt = this.now()
  }

  /** Remove all profiles and sub-engine state. */
  clear(): void {
    this.profiles.clear()
    this.cadenceEngine.clear()
    this.burstEngine.clear()
    this.budgetManager.clear()
  }

  // ---------------------------------------------------------------------------
  // Policy accessors
  // ---------------------------------------------------------------------------

  getCadencePolicy() { return this.cadenceEngine.getPolicy() }
  getBurstPolicy() { return this.burstEngine.getPolicy() }
  getBudgetPolicy() { return this.budgetManager.getPolicy() }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private ensureProfile(agentId: string): TemporalProfile {
    if (!this.profiles.has(agentId)) {
      const ts = this.now()
      this.profiles.set(agentId, {
        agentId,
        createdAt: ts,
        updatedAt: ts,
        cadenceRisk: 'low',
        recentExecutionTimestamps: [],
        detectedBursts: 0,
        smoothedRequests: 0,
        temporalBudget: this.budgetManager.getBudget(agentId),
        currentDelayMs: 0
      })
    }
    return this.profiles.get(agentId)!
  }
}
