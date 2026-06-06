import type { TemporalBudgetPolicy, TemporalPrivacyBudget } from './types.js'

export const DEFAULT_BUDGET_POLICY: TemporalBudgetPolicy = {
  enabled: true,
  maxRequestsPerWindow: 60,
  windowMs: 60_000,
  forceDelayOnExhaustion: true
}

function cloneBudget(b: TemporalPrivacyBudget): TemporalPrivacyBudget {
  return { ...b }
}

/**
 * TemporalBudgetManager — limits the density of requests within a time window.
 *
 * Entirely in-memory. No persistence, no network, no AI/ML.
 * Defensive copies at every boundary.
 */
export class TemporalBudgetManager {
  private readonly policy: TemporalBudgetPolicy
  private readonly now: () => number
  private readonly budgets = new Map<string, TemporalPrivacyBudget>()

  constructor(policy: TemporalBudgetPolicy = DEFAULT_BUDGET_POLICY, now: () => number = Date.now) {
    this.policy = { ...policy }
    this.now = now
  }

  getBudget(agentId: string): TemporalPrivacyBudget {
    return cloneBudget(this.ensureBudget(agentId))
  }

  listBudgets(): TemporalPrivacyBudget[] {
    this.resetExpiredBudgets()
    return [...this.budgets.values()].map(cloneBudget)
  }

  /**
   * Consume one unit of budget for agentId.
   * Returns the updated budget (defensive copy).
   * If exhausted and forceDelayOnExhaustion, remaining stays 0 (caller must delay).
   */
  consumeBudget(agentId: string, at?: number): TemporalPrivacyBudget {
    const ts = at ?? this.now()
    const budget = this.ensureBudget(agentId, ts)

    // Reset if the window has expired.
    if (ts >= budget.resetsAt) {
      budget.consumed = 0
      budget.remaining = this.policy.maxRequestsPerWindow
      budget.resetsAt = ts + this.policy.windowMs
    }

    if (budget.remaining > 0) {
      budget.consumed++
      budget.remaining--
    }
    // When exhausted, consumed is capped — we do not over-count.

    return cloneBudget(budget)
  }

  /**
   * Scan all budgets and reset any whose window has expired.
   */
  resetExpiredBudgets(at?: number): void {
    const ts = at ?? this.now()
    for (const [agentId, budget] of this.budgets) {
      if (ts >= budget.resetsAt) {
        this.budgets.set(agentId, {
          maxRequestsPerWindow: this.policy.maxRequestsPerWindow,
          windowMs: this.policy.windowMs,
          consumed: 0,
          remaining: this.policy.maxRequestsPerWindow,
          resetsAt: ts + this.policy.windowMs
        })
      }
    }
  }

  isExhausted(agentId: string, at?: number): boolean {
    const ts = at ?? this.now()
    const budget = this.ensureBudget(agentId, ts)
    if (ts >= budget.resetsAt) return false
    return budget.remaining === 0
  }

  getPolicy(): TemporalBudgetPolicy {
    return { ...this.policy }
  }

  clear(): void {
    this.budgets.clear()
  }

  private ensureBudget(agentId: string, at?: number): TemporalPrivacyBudget {
    if (!this.budgets.has(agentId)) {
      const ts = at ?? this.now()
      this.budgets.set(agentId, {
        maxRequestsPerWindow: this.policy.maxRequestsPerWindow,
        windowMs: this.policy.windowMs,
        consumed: 0,
        remaining: this.policy.maxRequestsPerWindow,
        resetsAt: ts + this.policy.windowMs
      })
    }
    return this.budgets.get(agentId)!
  }
}
