import { randomUUID } from 'node:crypto'
import {
  CorrelationEngine,
  DEFAULT_CORRELATION_POLICY
} from './correlation.js'
import {
  DEFAULT_FRAGMENTATION_POLICY,
  IdentityFragmentManager
} from './fragmentation.js'
import { DEFAULT_JITTER_POLICY } from './jitter.js'
import { TemporalPrivacyScheduler } from './scheduler.js'
import type {
  BehavioralPrivacyDecision,
  BehavioralPrivacyEngineOptions,
  BehavioralProfile,
  CorrelationDetectionPolicy,
  EvaluateRequestInput,
  IdentityFragmentationPolicy,
  RecordBehaviorInput,
  TemporalJitterPolicy
} from './types.js'

function cloneProfile(profile: BehavioralProfile): BehavioralProfile {
  return {
    agentId: profile.agentId,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    correlationRisk: profile.correlationRisk,
    activeIdentityFragments: profile.activeIdentityFragments,
    recentSearchTopics: [...profile.recentSearchTopics],
    temporalPatternsDetected: profile.temporalPatternsDetected,
    repeatedBehaviorScore: profile.repeatedBehaviorScore
  }
}

/**
 * BehavioralPrivacyEngine — deterministic, in-memory engine that reduces
 * behavioral correlation across an agent's searches.
 */
export class BehavioralPrivacyEngine {
  private readonly now: () => number
  private readonly generateId: () => string
  private readonly profiles = new Map<string, BehavioralProfile>()
  readonly correlationEngine: CorrelationEngine
  readonly fragmentManager: IdentityFragmentManager
  readonly scheduler: TemporalPrivacyScheduler

  constructor(options: BehavioralPrivacyEngineOptions = {}) {
    this.now = options.now ?? Date.now
    this.generateId = options.generateId ?? randomUUID
    this.correlationEngine = new CorrelationEngine(
      options.correlationPolicy ?? DEFAULT_CORRELATION_POLICY
    )
    this.fragmentManager = new IdentityFragmentManager(
      options.fragmentationPolicy ?? DEFAULT_FRAGMENTATION_POLICY,
      { now: this.now, generateId: this.generateId }
    )
    this.scheduler = new TemporalPrivacyScheduler({
      now: this.now,
      jitterPolicy: options.jitterPolicy ?? DEFAULT_JITTER_POLICY
    })
  }

  /** Return the profile for agentId, creating a fresh one when absent. */
  getOrCreateProfile(agentId: string): BehavioralProfile {
    return cloneProfile(this.ensureProfile(agentId))
  }

  /** Return the profile for agentId, or undefined if not yet created. */
  getProfile(agentId: string): BehavioralProfile | undefined {
    const profile = this.profiles.get(agentId)
    return profile ? cloneProfile(profile) : undefined
  }

  /** List all profiles (defensive copies). */
  listProfiles(): BehavioralProfile[] {
    return [...this.profiles.values()].map(cloneProfile)
  }

  /**
   * Record a behavioral observation for an agent.
   * topicLabel must be a label only — never a raw query, URL, or user input.
   */
  recordBehavior(input: RecordBehaviorInput): BehavioralProfile {
    const at = input.timestamp ?? this.now()
    const profile = this.ensureProfile(input.agentId)
    this.correlationEngine.recordAccess(input.agentId, at)
    if (input.topicLabel) {
      this.correlationEngine.recordTopic(input.agentId, input.topicLabel, at)
    }
    this.syncProfile(profile, at)
    return cloneProfile(profile)
  }

  /**
   * Evaluate whether a request should proceed, and what privacy mitigations
   * to apply.
   */
  evaluateRequest(input: EvaluateRequestInput): BehavioralPrivacyDecision {
    const at = input.timestamp ?? this.now()
    const profile = this.ensureProfile(input.agentId)
    this.correlationEngine.recordAccess(input.agentId, at)
    this.syncProfile(profile, at)

    switch (profile.correlationRisk) {
      case 'low':
        return { allowed: true }
      case 'medium':
        return {
          allowed: true,
          requiresDelay: true,
          recommendedDelayMs: this.scheduler.computeDelay({
            agentId: input.agentId,
            repeatedBehaviorScore: profile.repeatedBehaviorScore,
            correlationRisk: profile.correlationRisk
          }).delayMs,
          reason: 'medium_correlation_risk'
        }
      case 'high':
        return {
          allowed: true,
          requiresFragmentation: true,
          requiresDelay: true,
          recommendedDelayMs: this.scheduler.computeDelay({
            agentId: input.agentId,
            repeatedBehaviorScore: profile.repeatedBehaviorScore,
            correlationRisk: profile.correlationRisk
          }).delayMs,
          requiresTransportRotation: true,
          reason: 'high_correlation_risk'
        }
      case 'critical':
        return {
          allowed: false,
          requiresFragmentation: true,
          requiresDelay: true,
          recommendedDelayMs: this.scheduler.computeDelay({
            agentId: input.agentId,
            repeatedBehaviorScore: profile.repeatedBehaviorScore,
            correlationRisk: profile.correlationRisk
          }).delayMs,
          requiresTransportRotation: true,
          reason: 'critical_correlation_risk'
        }
      default:
        return { allowed: false, reason: 'unknown_risk_level' }
    }
  }

  /** Refresh a profile's derived metadata without recording a new observation. */
  refreshProfile(agentId: string, timestamp?: number): BehavioralProfile {
    const at = timestamp ?? this.now()
    const profile = this.ensureProfile(agentId)
    this.syncProfile(profile, at)
    return cloneProfile(profile)
  }

  /** Apply temporal decay to all profiles, reducing behavior scores over time. */
  applyTemporalDecay(decayAmount = 5): BehavioralProfile[] {
    const changed: BehavioralProfile[] = []
    for (const profile of this.profiles.values()) {
      const before = profile.repeatedBehaviorScore
      this.correlationEngine.applyDecay(profile.agentId, decayAmount)
      const decayed = this.correlationEngine.getBehaviorScore(profile.agentId)
      profile.repeatedBehaviorScore = decayed
      profile.correlationRisk = this.correlationEngine.classifyRisk(decayed)
      profile.activeIdentityFragments = this.fragmentManager.activeCount(profile.agentId)
      profile.updatedAt = this.now()
      if (profile.repeatedBehaviorScore !== before) {
        changed.push(cloneProfile(profile))
      }
    }
    return changed
  }

  getJitterPolicy(): TemporalJitterPolicy {
    return this.scheduler.getPolicy()
  }

  getFragmentationPolicy(): IdentityFragmentationPolicy {
    return this.fragmentManager.getPolicy()
  }

  getCorrelationPolicy(): CorrelationDetectionPolicy {
    return this.correlationEngine.getPolicy()
  }

  clear(): void {
    this.profiles.clear()
    this.correlationEngine.clear()
    this.fragmentManager.clear()
  }

  private ensureProfile(agentId: string): BehavioralProfile {
    let profile = this.profiles.get(agentId)
    if (!profile) {
      const at = this.now()
      profile = {
        agentId,
        createdAt: at,
        updatedAt: at,
        correlationRisk: 'low',
        activeIdentityFragments: 0,
        recentSearchTopics: [],
        temporalPatternsDetected: 0,
        repeatedBehaviorScore: 0
      }
      this.profiles.set(agentId, profile)
    }
    return profile
  }

  private syncProfile(profile: BehavioralProfile, at: number): void {
    const score = this.correlationEngine.updateBehaviorScore(profile.agentId)
    profile.repeatedBehaviorScore = score
    profile.correlationRisk = this.correlationEngine.classifyRisk(score)
    profile.temporalPatternsDetected = this.correlationEngine.temporalPatternCount(
      profile.agentId
    )
    profile.recentSearchTopics = this.correlationEngine.recentTopics(profile.agentId)
    profile.activeIdentityFragments = this.fragmentManager.activeCount(profile.agentId)
    profile.updatedAt = at
  }
}
