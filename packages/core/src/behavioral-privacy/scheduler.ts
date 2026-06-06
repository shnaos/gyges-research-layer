import { computeJitter, DEFAULT_JITTER_POLICY } from './jitter.js'
import type {
  ComputeDelayInput,
  ComputeDelayResult,
  TemporalJitterPolicy
} from './types.js'

export interface TemporalPrivacySchedulerOptions {
  now?: () => number
  jitterPolicy?: TemporalJitterPolicy
}

/**
 * TemporalPrivacyScheduler — reduces temporal patterns by computing recommended
 * delays. Does NOT sleep, does NOT queue, and does NOT perform async work.
 */
export class TemporalPrivacyScheduler {
  private readonly jitterPolicy: TemporalJitterPolicy
  private readonly now: () => number

  constructor(options: TemporalPrivacySchedulerOptions = {}) {
    this.jitterPolicy = options.jitterPolicy ?? { ...DEFAULT_JITTER_POLICY }
    this.now = options.now ?? Date.now
  }

  computeDelay(input: ComputeDelayInput): ComputeDelayResult {
    return computeJitter(input, this.jitterPolicy, this.now())
  }

  getPolicy(): TemporalJitterPolicy {
    return { ...this.jitterPolicy }
  }
}
