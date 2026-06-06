import type { BurstFragmentationPolicy, CadenceRisk } from './types.js'

export const DEFAULT_BURST_POLICY: BurstFragmentationPolicy = {
  enabled: true,
  burstThreshold: 5,
  burstWindowMs: 10_000,
  cooldownMs: 5_000
}

export interface BurstDetectionResult {
  isBurst: boolean
  requiresFragmentation: boolean
  requiresSchedulingEscalation: boolean
  cooldownMs: number
  burstCount: number
  cadenceRisk: CadenceRisk
  reason: string
}

/**
 * BurstFragmentationEngine — detects rapid request spikes and imposes cooldowns.
 *
 * Tracks request timestamps within a rolling window per agent and raises
 * escalation flags when burst thresholds are crossed.
 * No persistence, no AI. Deterministic.
 */
export class BurstFragmentationEngine {
  private readonly policy: BurstFragmentationPolicy
  private readonly executionWindows = new Map<string, number[]>()
  /** Number of detected bursts per agent (never decremented). */
  private readonly detectedBursts = new Map<string, number>()
  /** Cooldown expiry timestamps per agent. */
  private readonly cooldownUntil = new Map<string, number>()

  constructor(policy: BurstFragmentationPolicy = DEFAULT_BURST_POLICY) {
    this.policy = { ...policy }
  }

  /**
   * Evaluate whether adding a request at `now` would constitute a burst.
   * Does NOT mutate state — call recordExecution separately.
   */
  evaluate(agentId: string, now: number): BurstDetectionResult {
    if (!this.policy.enabled) {
      return { isBurst: false, requiresFragmentation: false, requiresSchedulingEscalation: false, cooldownMs: 0, burstCount: 0, cadenceRisk: 'low', reason: 'burst_detection_disabled' }
    }

    const cooldownExpiry = this.cooldownUntil.get(agentId) ?? 0
    if (now < cooldownExpiry) {
      const remaining = cooldownExpiry - now
      return {
        isBurst: true,
        requiresFragmentation: true,
        requiresSchedulingEscalation: true,
        cooldownMs: remaining,
        burstCount: this.detectedBursts.get(agentId) ?? 0,
        cadenceRisk: 'critical',
        reason: 'burst_cooldown_active'
      }
    }

    const window = this.getWindow(agentId, now)
    const burstCount = window.length

    if (burstCount >= this.policy.burstThreshold) {
      return {
        isBurst: true,
        requiresFragmentation: true,
        requiresSchedulingEscalation: true,
        cooldownMs: this.policy.cooldownMs,
        burstCount,
        cadenceRisk: 'critical',
        reason: `burst_threshold_exceeded:${burstCount}`
      }
    }

    if (burstCount >= Math.ceil(this.policy.burstThreshold * 0.6)) {
      return {
        isBurst: true,
        requiresFragmentation: false,
        requiresSchedulingEscalation: true,
        cooldownMs: 0,
        burstCount,
        cadenceRisk: 'high',
        reason: `burst_approaching_threshold:${burstCount}`
      }
    }

    if (burstCount >= Math.ceil(this.policy.burstThreshold * 0.4)) {
      return {
        isBurst: false,
        requiresFragmentation: false,
        requiresSchedulingEscalation: false,
        cooldownMs: 0,
        burstCount,
        cadenceRisk: 'medium',
        reason: `burst_window_moderate:${burstCount}`
      }
    }

    return {
      isBurst: false,
      requiresFragmentation: false,
      requiresSchedulingEscalation: false,
      cooldownMs: 0,
      burstCount,
      cadenceRisk: 'low',
      reason: 'burst_ok'
    }
  }

  /**
   * Record an execution at `now`. Prunes old entries and activates cooldown
   * if the burst threshold is crossed.
   */
  recordExecution(agentId: string, now: number): void {
    const window = this.getWindow(agentId, now)
    window.push(now)

    if (window.length >= this.policy.burstThreshold) {
      this.cooldownUntil.set(agentId, now + this.policy.cooldownMs)
      const prev = this.detectedBursts.get(agentId) ?? 0
      this.detectedBursts.set(agentId, prev + 1)
    }

    this.executionWindows.set(agentId, window)
  }

  getDetectedBursts(agentId: string): number {
    return this.detectedBursts.get(agentId) ?? 0
  }

  getPolicy(): BurstFragmentationPolicy {
    return { ...this.policy }
  }

  clear(): void {
    this.executionWindows.clear()
    this.detectedBursts.clear()
    this.cooldownUntil.clear()
  }

  private getWindow(agentId: string, now: number): number[] {
    const cutoff = now - this.policy.burstWindowMs
    const existing = this.executionWindows.get(agentId) ?? []
    return existing.filter((ts) => ts >= cutoff)
  }
}
