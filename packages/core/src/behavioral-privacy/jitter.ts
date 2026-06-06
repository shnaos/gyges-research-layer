import type {
  ComputeDelayInput,
  ComputeDelayResult,
  CorrelationRisk,
  TemporalJitterPolicy
} from './types.js'

export const DEFAULT_JITTER_POLICY: TemporalJitterPolicy = {
  enabled: true,
  minDelayMs: 50,
  maxDelayMs: 2000,
  adaptive: true
}

/**
 * Deterministic jitter using a simple hash of agentId + timestamp bucket.
 * No crypto, no random — purely deterministic so tests are reproducible.
 */
export function deterministicJitter(seed: string, min: number, max: number): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0
  }
  // Normalise the raw i32 hash to [0, 1] using the maximum positive i32 value
  // (0x7fffffff = 2^31 − 1). Math.abs ensures we handle negative hash outputs.
  const normalized = Math.abs(hash) / 0x7fffffff
  return Math.round(min + normalized * (max - min))
}

export function computeJitter(
  input: ComputeDelayInput,
  policy: TemporalJitterPolicy,
  now: number
): ComputeDelayResult {
  if (!policy.enabled) {
    return { delayMs: 0, adaptive: false, reason: 'jitter_disabled' }
  }

  const riskMultiplier = riskToMultiplier(input.correlationRisk)
  const seed = `${input.agentId}:${Math.floor(now / 1000)}`
  const base = deterministicJitter(seed, policy.minDelayMs, policy.maxDelayMs)

  let delayMs = base
  let adaptive = false

  if (policy.adaptive && input.repeatedBehaviorScore > 0) {
    const factor = 1 + (input.repeatedBehaviorScore / 100) * riskMultiplier
    delayMs = Math.min(Math.round(base * factor), policy.maxDelayMs * 2)
    adaptive = true
  } else {
    delayMs = Math.min(Math.round(base * riskMultiplier), policy.maxDelayMs * 2)
  }

  return {
    delayMs,
    adaptive,
    reason: adaptive ? 'adaptive_jitter' : 'base_jitter'
  }
}

function riskToMultiplier(risk: CorrelationRisk): number {
  switch (risk) {
    case 'low':
      return 1
    case 'medium':
      return 1.5
    case 'high':
      return 2
    case 'critical':
      return 3
  }
}
