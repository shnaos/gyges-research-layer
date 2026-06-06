import { randomUUID } from 'node:crypto'
import type { IdentityFragment, IdentityFragmentationPolicy } from './types.js'

export const DEFAULT_FRAGMENTATION_POLICY: IdentityFragmentationPolicy = {
  enabled: true,
  maxRequestsPerFragment: 10,
  fragmentTtlMs: 5 * 60 * 1000,
  forceIsolationOnHighRisk: true
}

function cloneFragment(fragment: IdentityFragment): IdentityFragment {
  return {
    id: fragment.id,
    agentId: fragment.agentId,
    createdAt: fragment.createdAt,
    expiresAt: fragment.expiresAt,
    isolatedSessionIds: [...fragment.isolatedSessionIds],
    isolatedTransportKinds: [...fragment.isolatedTransportKinds],
    active: fragment.active,
    requestCount: fragment.requestCount
  }
}

export class IdentityFragmentManager {
  private readonly policy: IdentityFragmentationPolicy
  private readonly now: () => number
  private readonly generateId: () => string
  private readonly fragments = new Map<string, IdentityFragment[]>()

  constructor(
    policy: IdentityFragmentationPolicy = DEFAULT_FRAGMENTATION_POLICY,
    options: { now?: () => number; generateId?: () => string } = {}
  ) {
    this.policy = { ...policy }
    this.now = options.now ?? Date.now
    this.generateId = options.generateId ?? randomUUID
  }

  /** Create a new fragment for an agent. Returns a defensive copy. */
  createFragment(agentId: string): IdentityFragment {
    const at = this.now()
    const fragment: IdentityFragment = {
      id: this.generateId(),
      agentId,
      createdAt: at,
      expiresAt: at + this.policy.fragmentTtlMs,
      isolatedSessionIds: [],
      isolatedTransportKinds: [],
      active: true,
      requestCount: 0
    }
    const list = this.fragments.get(agentId) ?? []
    list.push(fragment)
    this.fragments.set(agentId, list)
    return cloneFragment(fragment)
  }

  /**
   * Get the current active fragment for an agent, creating one if none exists.
   * Automatically rotates if the fragment is exhausted or expired.
   */
  getActiveFragment(agentId: string): IdentityFragment {
    if (!this.policy.enabled) {
      const at = this.now()
      return {
        id: 'disabled',
        agentId,
        createdAt: at,
        expiresAt: at + this.policy.fragmentTtlMs,
        isolatedSessionIds: [],
        isolatedTransportKinds: [],
        active: true,
        requestCount: 0
      }
    }
    const at = this.now()
    const list = this.fragments.get(agentId) ?? []
    const active = list.find(
      (fragment) =>
        fragment.active &&
        fragment.expiresAt > at &&
        fragment.requestCount < this.policy.maxRequestsPerFragment
    )
    if (active) return cloneFragment(active)
    return this.createFragment(agentId)
  }

  /**
   * Forcibly rotate the active fragment for an agent.
   * Marks existing fragments inactive and creates a new active fragment.
   */
  rotateFragment(agentId: string): IdentityFragment {
    const list = this.fragments.get(agentId) ?? []
    for (const fragment of list) {
      if (fragment.active) fragment.active = false
    }
    this.fragments.set(agentId, list)
    return this.createFragment(agentId)
  }

  /** Increment request count on the active fragment. */
  recordRequest(agentId: string, fragmentId: string): void {
    const list = this.fragments.get(agentId) ?? []
    const fragment = list.find((candidate) => candidate.id === fragmentId)
    if (fragment) fragment.requestCount++
  }

  /** Expire all fragments past their TTL. */
  expireFragments(now?: number): IdentityFragment[] {
    const at = now ?? this.now()
    const expired: IdentityFragment[] = []
    for (const list of this.fragments.values()) {
      for (const fragment of list) {
        if (fragment.active && fragment.expiresAt <= at) {
          fragment.active = false
          expired.push(cloneFragment(fragment))
        }
      }
    }
    return expired
  }

  /** List all fragments for an agent (defensive copies). */
  listFragments(agentId: string): IdentityFragment[] {
    return (this.fragments.get(agentId) ?? []).map(cloneFragment)
  }

  /** List all fragments across all agents (defensive copies). */
  listAllFragments(): IdentityFragment[] {
    const all: IdentityFragment[] = []
    for (const list of this.fragments.values()) {
      all.push(...list.map(cloneFragment))
    }
    return all
  }

  /** Count active fragments for an agent. */
  activeCount(agentId: string): number {
    const at = this.now()
    return (this.fragments.get(agentId) ?? []).filter(
      (fragment) => fragment.active && fragment.expiresAt > at
    ).length
  }

  getPolicy(): IdentityFragmentationPolicy {
    return { ...this.policy }
  }

  clear(): void {
    this.fragments.clear()
  }
}
