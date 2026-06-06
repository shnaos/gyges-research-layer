/**
 * Deterministic timing helpers for temporal obfuscation.
 * No crypto, no random — purely deterministic so tests are reproducible.
 */

/**
 * Deterministic spacing using a hash of agentId + time bucket.
 * Produces a stable value in [min, max] for a given (seed, min, max).
 */
export function deterministicSpacing(seed: string, min: number, max: number): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0
  }
  const normalized = Math.abs(hash) / 0x7fffffff
  return Math.round(min + normalized * (max - min))
}

/**
 * Compute an adaptive spacing delay given the cadence risk and a seed.
 * Higher risk → longer delay. Deterministic and bounded.
 */
export function computeAdaptiveDelay(
  seed: string,
  cadenceRisk: 'low' | 'medium' | 'high' | 'critical',
  minSpacingMs: number,
  burstPenaltyMs: number
): number {
  const multiplier = riskMultiplier(cadenceRisk)
  const base = deterministicSpacing(seed, minSpacingMs, minSpacingMs * 3)
  return Math.round(base * multiplier + burstPenaltyMs * Math.max(multiplier - 1, 0))
}

function riskMultiplier(risk: 'low' | 'medium' | 'high' | 'critical'): number {
  switch (risk) {
    case 'low': return 1
    case 'medium': return 1.5
    case 'high': return 2.5
    case 'critical': return 4
  }
}
