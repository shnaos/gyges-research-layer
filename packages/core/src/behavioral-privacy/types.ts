export type CorrelationRisk = 'low' | 'medium' | 'high' | 'critical'

export interface BehavioralProfile {
  agentId: string
  createdAt: number
  updatedAt: number
  correlationRisk: CorrelationRisk
  activeIdentityFragments: number
  recentSearchTopics: string[]
  temporalPatternsDetected: number
  repeatedBehaviorScore: number
}

export interface IdentityFragment {
  id: string
  agentId: string
  createdAt: number
  expiresAt: number
  isolatedSessionIds: string[]
  isolatedTransportKinds: string[]
  active: boolean
  requestCount: number
}

export interface BehavioralPrivacyDecision {
  allowed: boolean
  requiresFragmentation?: boolean
  requiresDelay?: boolean
  recommendedDelayMs?: number
  requiresTransportRotation?: boolean
  reason?: string
}

export interface TemporalJitterPolicy {
  enabled: boolean
  minDelayMs: number
  maxDelayMs: number
  adaptive: boolean
}

export interface IdentityFragmentationPolicy {
  enabled: boolean
  maxRequestsPerFragment: number
  fragmentTtlMs: number
  forceIsolationOnHighRisk: boolean
}

export interface CorrelationDetectionPolicy {
  enabled: boolean
  repeatedQueryThreshold: number
  temporalPatternThreshold: number
  maxBehaviorScore: number
}

export interface BehavioralPrivacyEngineOptions {
  now?: () => number
  generateId?: () => string
  jitterPolicy?: TemporalJitterPolicy
  fragmentationPolicy?: IdentityFragmentationPolicy
  correlationPolicy?: CorrelationDetectionPolicy
}

export interface RecordBehaviorInput {
  agentId: string
  /** Topic label only — never raw query or URL */
  topicLabel?: string
  timestamp?: number
}

export interface EvaluateRequestInput {
  agentId: string
  riskLevel?: 'low' | 'medium' | 'high'
  timestamp?: number
}

export interface ComputeDelayInput {
  agentId: string
  repeatedBehaviorScore: number
  correlationRisk: CorrelationRisk
}

export interface ComputeDelayResult {
  delayMs: number
  adaptive: boolean
  reason: string
}
