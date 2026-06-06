import type { CadenceRisk, TemporalSchedulingDecision } from './types.js'
import type { CadenceSmoothingResult } from './cadence.js'
import type { BurstDetectionResult } from './burst.js'

export interface ComputeTemporalSchedulingDecisionInput {
  agentId: string
  cadenceResult: CadenceSmoothingResult
  burstResult: BurstDetectionResult
  budgetExhausted: boolean
  budgetDelayMs: number
  now: number
}

/**
 * TemporalScheduler — produces scheduling decisions (delays, pacing metadata,
 * escalation flags) without executing any real waits.
 *
 * Pure computation: takes cadence + burst + budget signals and returns
 * a unified scheduling recommendation. No mutations, no persistence, no AI.
 */
export class TemporalScheduler {
  /**
   * Compute a unified scheduling decision from cadence, burst, and budget inputs.
   *
   * Precedence (highest to lowest):
   *   1. Burst cooldown active → critical, max delay
   *   2. Budget exhausted → high, budget delay
   *   3. Burst approaching → high delay + escalation
   *   4. Cadence smoothing → delay from cadence
   *   5. No action needed → zero delay
   */
  computeTemporalSchedulingDecision(input: ComputeTemporalSchedulingDecisionInput): TemporalSchedulingDecision {
    const { cadenceResult, burstResult, budgetExhausted, budgetDelayMs } = input

    // 1. Burst cooldown
    if (burstResult.isBurst && burstResult.cadenceRisk === 'critical') {
      return {
        recommendedDelayMs: Math.max(burstResult.cooldownMs, cadenceResult.recommendedDelayMs),
        requiresCadenceSmoothing: true,
        requiresBurstFragmentation: true,
        requiresSchedulingEscalation: true,
        cadenceRisk: 'critical',
        reason: burstResult.reason
      }
    }

    // 2. Budget exhausted
    if (budgetExhausted) {
      return {
        recommendedDelayMs: Math.max(budgetDelayMs, cadenceResult.recommendedDelayMs),
        requiresCadenceSmoothing: cadenceResult.requiresSmoothing,
        requiresBurstFragmentation: burstResult.requiresFragmentation,
        requiresSchedulingEscalation: true,
        cadenceRisk: this.maxRisk('high', cadenceResult.cadenceRisk),
        reason: 'temporal_budget_exhausted'
      }
    }

    // 3. Burst approaching (scheduling escalation but no cooldown)
    if (burstResult.requiresSchedulingEscalation) {
      return {
        recommendedDelayMs: Math.max(burstResult.cooldownMs, cadenceResult.recommendedDelayMs),
        requiresCadenceSmoothing: cadenceResult.requiresSmoothing,
        requiresBurstFragmentation: burstResult.requiresFragmentation,
        requiresSchedulingEscalation: true,
        cadenceRisk: this.maxRisk(burstResult.cadenceRisk, cadenceResult.cadenceRisk),
        reason: burstResult.reason
      }
    }

    // 4. Cadence smoothing
    if (cadenceResult.requiresSmoothing) {
      return {
        recommendedDelayMs: cadenceResult.recommendedDelayMs,
        requiresCadenceSmoothing: true,
        requiresBurstFragmentation: false,
        requiresSchedulingEscalation: false,
        cadenceRisk: cadenceResult.cadenceRisk,
        reason: cadenceResult.reason
      }
    }

    // 5. No action
    return {
      recommendedDelayMs: 0,
      requiresCadenceSmoothing: false,
      requiresBurstFragmentation: false,
      requiresSchedulingEscalation: false,
      cadenceRisk: burstResult.cadenceRisk,
      reason: 'temporal_ok'
    }
  }

  private maxRisk(a: CadenceRisk, b: CadenceRisk): CadenceRisk {
    const order: CadenceRisk[] = ['low', 'medium', 'high', 'critical']
    return order[Math.max(order.indexOf(a), order.indexOf(b))]
  }
}
