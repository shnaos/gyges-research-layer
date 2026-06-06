import type { CorrelationDetectionPolicy, CorrelationRisk } from './types.js'

/**
 * Requests separated by less than BURST_THRESHOLD_MS are considered a
 * back-to-back burst that forms a recognisable temporal fingerprint.
 * 100 ms is chosen because it is well below typical human interaction
 * latency and network round-trip times, yet clearly above same-tick noise.
 */
const BURST_THRESHOLD_MS = 100

export const DEFAULT_CORRELATION_POLICY: CorrelationDetectionPolicy = {
  enabled: true,
  repeatedQueryThreshold: 5,
  temporalPatternThreshold: 3,
  maxBehaviorScore: 100
}

/** Rolling window for topic counts per agent. */
export interface TopicRecord {
  label: string
  count: number
  firstSeenAt: number
  lastSeenAt: number
}

/** Sliding-window timestamp bucket. */
export interface TemporalBucket {
  timestamp: number
}

export class CorrelationEngine {
  private readonly policy: CorrelationDetectionPolicy
  private readonly topicCounts = new Map<string, TopicRecord[]>()
  private readonly temporalBuckets = new Map<string, TemporalBucket[]>()
  private readonly behaviorScores = new Map<string, number>()

  constructor(policy: CorrelationDetectionPolicy = DEFAULT_CORRELATION_POLICY) {
    this.policy = { ...policy }
  }

  /**
   * Record a new topic observation for an agent.
   * Only topic labels are accepted — never raw queries.
   */
  recordTopic(agentId: string, topicLabel: string, now: number): void {
    if (!this.policy.enabled) return
    const records = this.topicCounts.get(agentId) ?? []
    const existing = records.find((record) => record.label === topicLabel)
    if (existing) {
      existing.count += 1
      existing.lastSeenAt = now
    } else {
      records.push({
        label: topicLabel,
        count: 1,
        firstSeenAt: now,
        lastSeenAt: now
      })
    }
    this.topicCounts.set(agentId, records)
  }

  /** Record a temporal access for an agent (used for pattern detection). */
  recordAccess(agentId: string, now: number): void {
    if (!this.policy.enabled) return
    const buckets = this.temporalBuckets.get(agentId) ?? []
    buckets.push({ timestamp: now })
    if (buckets.length > 100) buckets.shift()
    this.temporalBuckets.set(agentId, buckets)
  }

  /** Count repeated topics above threshold. */
  repeatedTopicCount(agentId: string): number {
    if (!this.policy.enabled) return 0
    const records = this.topicCounts.get(agentId) ?? []
    return records.filter((record) => record.count >= this.policy.repeatedQueryThreshold)
      .length
  }

  /** Detect temporal patterns: bursts within a 1-second window. */
  temporalPatternCount(agentId: string): number {
    if (!this.policy.enabled) return 0
    const buckets = this.temporalBuckets.get(agentId) ?? []
    if (buckets.length < 2) return 0
    let patterns = 0
    for (let i = 1; i < buckets.length; i++) {
      const gap = buckets[i].timestamp - buckets[i - 1].timestamp
      if (gap < BURST_THRESHOLD_MS) patterns++
    }
    return patterns
  }

  /** Get recent topic labels for a profile (up to 10, no raw queries). */
  recentTopics(agentId: string): string[] {
    const records = this.topicCounts.get(agentId) ?? []
    return records.slice(-10).map((record) => record.label)
  }

  /**
   * Update and return the behavior score for an agent.
   * Score 0..100, monotonically influenced by repetitions and temporal patterns.
   */
  updateBehaviorScore(agentId: string): number {
    if (!this.policy.enabled) return 0
    const repeated = this.repeatedTopicCount(agentId)
    const temporal = this.temporalPatternCount(agentId)
    const raw = repeated * 10 + temporal * 5
    const clamped = Math.min(raw, this.policy.maxBehaviorScore)
    this.behaviorScores.set(agentId, clamped)
    return clamped
  }

  getBehaviorScore(agentId: string): number {
    return this.behaviorScores.get(agentId) ?? 0
  }

  getPolicy(): CorrelationDetectionPolicy {
    return { ...this.policy }
  }

  /**
   * Classify the current correlation risk for an agent from its behavior score.
   */
  classifyRisk(score: number): CorrelationRisk {
    if (score >= 80) return 'critical'
    if (score >= 50) return 'high'
    if (score >= 25) return 'medium'
    return 'low'
  }

  /** Apply temporal decay: reduce behavior score by `decayAmount` per pass. */
  applyDecay(agentId: string, decayAmount = 5): void {
    const current = this.behaviorScores.get(agentId) ?? 0
    const decayed = Math.max(0, current - decayAmount)
    this.behaviorScores.set(agentId, decayed)
  }

  clear(): void {
    this.topicCounts.clear()
    this.temporalBuckets.clear()
    this.behaviorScores.clear()
  }
}
