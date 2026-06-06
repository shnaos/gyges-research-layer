import type { CadenceRisk, CadenceSmoothingPolicy } from './types.js'
import { computeAdaptiveDelay, deterministicSpacing } from './timing.js'

export const DEFAULT_CADENCE_POLICY: CadenceSmoothingPolicy = {
  enabled: true,
  minSpacingMs: 200,
  adaptiveSpacing: true,
  burstPenaltyMs: 300
}

export interface CadenceSmoothingResult {
  requiresSmoothing: boolean
  recommendedDelayMs: number
  cadenceRisk: CadenceRisk
  reason: string
}

/**
 * CadenceSmoothingEngine — prevents fixed cadence and repetitive rhythms.
 *
 * Evaluates inter-request spacing and applies adaptive delays.
 * No real waits, no persistence, no AI. Deterministic.
 */
export class CadenceSmoothingEngine {
  private readonly policy: CadenceSmoothingPolicy
  /** Last execution timestamps, keyed by agentId. */
  private readonly lastTs = new Map<string, number>()

  constructor(policy: CadenceSmoothingPolicy = DEFAULT_CADENCE_POLICY) {
    this.policy = { ...policy }
  }

  /**
   * Evaluate cadence risk for an agent given its recent execution timestamps.
   * Returns smoothing recommendations without mutating state.
   */
  evaluate(
    agentId: string,
    recentTimestamps: number[],
    now: number
  ): CadenceSmoothingResult {
    if (!this.policy.enabled) {
      return { requiresSmoothing: false, recommendedDelayMs: 0, cadenceRisk: 'low', reason: 'cadence_smoothing_disabled' }
    }

    const storedLast = this.lastTs.get(agentId)
    const inferredLast =
      recentTimestamps.length > 0 ? recentTimestamps[recentTimestamps.length - 1] : undefined
    const last = storedLast ?? inferredLast
    const timeSinceLast = last !== undefined ? now - last : Infinity

    const risk = this.assessCadenceRisk(recentTimestamps, timeSinceLast)

    if (timeSinceLast >= this.policy.minSpacingMs && risk === 'low') {
      return { requiresSmoothing: false, recommendedDelayMs: 0, cadenceRisk: risk, reason: 'cadence_ok' }
    }

    const seed = `${agentId}:${Math.floor(now / 500)}`
    const delay = this.policy.adaptiveSpacing
      ? computeAdaptiveDelay(seed, risk, this.policy.minSpacingMs, this.policy.burstPenaltyMs)
      : deterministicSpacing(seed, this.policy.minSpacingMs, this.policy.minSpacingMs * 2)

    return {
      requiresSmoothing: true,
      recommendedDelayMs: delay,
      cadenceRisk: risk,
      reason: `cadence_smoothing_required:${risk}`
    }
  }

  /** Record that a request has been executed at the given timestamp. */
  recordExecution(agentId: string, at: number): void {
    this.lastTs.set(agentId, at)
  }

  getPolicy(): CadenceSmoothingPolicy {
    return { ...this.policy }
  }

  clear(): void {
    this.lastTs.clear()
  }

  private assessCadenceRisk(timestamps: number[], timeSinceLast: number): CadenceRisk {
    // Time-since-last checks are independent of history length
    if (timeSinceLast < 100) return 'critical'
    if (timeSinceLast < this.policy.minSpacingMs * 0.5) return 'high'

    if (timestamps.length < 2) return 'low'

    // Detect fixed cadence: look at variance in inter-request gaps
    const gaps: number[] = []
    for (let i = 1; i < timestamps.length; i++) {
      gaps.push(timestamps[i] - timestamps[i - 1])
    }
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
    const variance = gaps.reduce((s, g) => s + Math.pow(g - mean, 2), 0) / gaps.length
    const stdDev = Math.sqrt(variance)
    const coefficientOfVariation = mean > 0 ? stdDev / mean : 0

    // Very regular cadence (low variation) is higher risk
    if (coefficientOfVariation < 0.05 && timestamps.length >= 5) return 'high'
    if (coefficientOfVariation < 0.15 && timestamps.length >= 4) return 'medium'
    if (timeSinceLast < this.policy.minSpacingMs) return 'medium'

    return 'low'
  }
}
