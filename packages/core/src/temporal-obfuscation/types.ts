/**
 * Risk levels for observable execution cadence patterns.
 */
export type CadenceRisk = 'low' | 'medium' | 'high' | 'critical'

/**
 * In-memory temporal profile tracked for an individual agent.
 */
export interface TemporalProfile {
  agentId: string
  createdAt: number
  updatedAt: number
  cadenceRisk: CadenceRisk
  recentExecutionTimestamps: number[]
  detectedBursts: number
  smoothedRequests: number
  temporalBudget: TemporalPrivacyBudget
  currentDelayMs: number
}

/**
 * Privacy budget state for a single temporal window.
 */
export interface TemporalPrivacyBudget {
  maxRequestsPerWindow: number
  windowMs: number
  consumed: number
  remaining: number
  resetsAt: number
}

/**
 * Decision returned after evaluating temporal obfuscation requirements.
 */
export interface TemporalObfuscationDecision {
  allowed: boolean
  requiresDelay: boolean
  delayMs: number
  requiresCadenceSmoothing: boolean
  requiresBurstFragmentation: boolean
  requiresSchedulingEscalation: boolean
  reason: string
}

/**
 * Configuration for cadence smoothing behavior.
 */
export interface CadenceSmoothingPolicy {
  enabled: boolean
  minSpacingMs: number
  adaptiveSpacing: boolean
  burstPenaltyMs: number
}

/**
 * Configuration for burst fragmentation behavior.
 */
export interface BurstFragmentationPolicy {
  enabled: boolean
  burstThreshold: number
  burstWindowMs: number
  cooldownMs: number
}

/**
 * Configuration for temporal privacy budget enforcement.
 */
export interface TemporalBudgetPolicy {
  enabled: boolean
  maxRequestsPerWindow: number
  windowMs: number
  forceDelayOnExhaustion: boolean
}

/**
 * Options for constructing the temporal obfuscation engine.
 */
export interface TemporalObfuscationEngineOptions {
  now?: () => number
  cadencePolicy?: CadenceSmoothingPolicy
  burstPolicy?: BurstFragmentationPolicy
  budgetPolicy?: TemporalBudgetPolicy
}

/**
 * Unified scheduling recommendation derived from temporal signals.
 */
export interface TemporalSchedulingDecision {
  recommendedDelayMs: number
  requiresCadenceSmoothing: boolean
  requiresBurstFragmentation: boolean
  requiresSchedulingEscalation: boolean
  cadenceRisk: CadenceRisk
  reason: string
}

/**
 * Input for recording an execution against an agent profile.
 */
export interface RecordExecutionInput {
  agentId: string
  timestamp?: number
}
