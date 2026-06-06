/**
 * AgentQuotaManager — per-agent quota enforcement.
 *
 * Each agent has an isolated resource envelope. Quota counts are never shared
 * across agents. Repeated quota violations degrade the agent's trust score via
 * the registry.
 *
 * Constraints:
 *   - Purely in-memory, deterministic, fail-closed.
 *   - Quota exceeded → deny; repeated violations → registry restriction.
 *   - No global contention: every check is scoped to one agentId.
 *   - No network, persistence, or browser work.
 */

import { AgentRegistry } from './registry.js';

export interface AgentQuotaManagerOptions {
  /** Registry for runtime state reads/writes. */
  registry: AgentRegistry;
  /**
   * Number of consecutive quota violations before the agent is automatically
   * restricted. Defaults to 3.
   */
  violationsBeforeRestriction?: number;
}

/**
 * Tracks per-agent quota violation counts.
 *
 * The counter is reset when the agent successfully executes (violation was
 * transient) or when it is explicitly restricted/evicted.
 */
export class AgentQuotaManager {
  private readonly registry: AgentRegistry;
  private readonly violationsBeforeRestriction: number;
  /** Consecutive violation count per agent. */
  private readonly violationCounts = new Map<string, number>();

  constructor(options: AgentQuotaManagerOptions) {
    this.registry = options.registry;
    this.violationsBeforeRestriction = options.violationsBeforeRestriction ?? 3;
  }

  /**
   * Check whether an agent may start a new execution.
   *
   * Returns `false` (deny) when:
   *   - The agent is not registered.
   *   - The agent is evicted or quarantined.
   *   - The agent is restricted (no new executions allowed).
   *   - `activeExecutions >= quota.maxConcurrentExecutions`.
   */
  canExecute(agentId: string): boolean {
    const runtime = this.registry.getAgent(agentId);
    if (runtime === undefined) return false;
    if (
      runtime.status === 'evicted' ||
      runtime.status === 'quarantined' ||
      runtime.status === 'restricted'
    ) {
      return false;
    }
    return runtime.activeExecutions < runtime.quota.maxConcurrentExecutions;
  }

  /**
   * Record the start of an execution for the agent.
   *
   * Increments `activeExecutions` and sets status to `active` when it was
   * previously `idle`. Silently ignored when the agent is not found.
   */
  recordExecutionStart(agentId: string): void {
    const runtime = this.registry.getAgent(agentId);
    if (runtime === undefined) return;

    const newCount = runtime.activeExecutions + 1;
    this.registry.updateAgent(agentId, {
      activeExecutions: newCount,
      status: runtime.status === 'idle' ? 'active' : runtime.status
    });
    // Reset violation counter on successful execution start.
    this.violationCounts.delete(agentId);
  }

  /**
   * Record the end of an execution for the agent.
   *
   * Decrements `activeExecutions`. Sets status to `idle` when the count
   * reaches zero (and the agent was `active`). Silently ignored when not found.
   */
  recordExecutionEnd(agentId: string): void {
    const runtime = this.registry.getAgent(agentId);
    if (runtime === undefined) return;

    const newCount = Math.max(0, runtime.activeExecutions - 1);
    const newStatus =
      newCount === 0 && runtime.status === 'active' ? 'idle' : runtime.status;
    this.registry.updateAgent(agentId, {
      activeExecutions: newCount,
      status: newStatus
    });
  }

  /**
   * Record a quota violation for the agent.
   *
   * When the violation count reaches `violationsBeforeRestriction`, the agent
   * is automatically restricted via the registry.
   *
   * Returns `true` when the agent was restricted as a result of this violation.
   */
  recordViolation(agentId: string): boolean {
    const count = (this.violationCounts.get(agentId) ?? 0) + 1;
    this.violationCounts.set(agentId, count);

    if (count >= this.violationsBeforeRestriction) {
      this.registry.restrictAgent(agentId);
      this.violationCounts.delete(agentId);
      return true;
    }
    return false;
  }

  /**
   * Check whether an agent may open a new session.
   *
   * Returns `false` when the agent is unknown, non-active/idle, or at the
   * session quota ceiling.
   */
  canCreateSession(agentId: string): boolean {
    const runtime = this.registry.getAgent(agentId);
    if (runtime === undefined) return false;
    if (
      runtime.status === 'evicted' ||
      runtime.status === 'quarantined' ||
      runtime.status === 'restricted'
    ) {
      return false;
    }
    return runtime.activeSessions < runtime.quota.maxSessions;
  }

  /**
   * Record the creation of a session for the agent.
   *
   * Increments `activeSessions`. Silently ignored when the agent is not found.
   */
  recordSessionCreated(agentId: string): void {
    const runtime = this.registry.getAgent(agentId);
    if (runtime === undefined) return;
    this.registry.updateAgent(agentId, {
      activeSessions: runtime.activeSessions + 1
    });
  }

  /**
   * Record the closure of a session for the agent.
   *
   * Decrements `activeSessions` (floor 0). Silently ignored when not found.
   */
  recordSessionClosed(agentId: string): void {
    const runtime = this.registry.getAgent(agentId);
    if (runtime === undefined) return;
    this.registry.updateAgent(agentId, {
      activeSessions: Math.max(0, runtime.activeSessions - 1)
    });
  }

  /**
   * Return the current consecutive violation count for an agent.
   *
   * Returns 0 when no violations are pending.
   */
  getViolationCount(agentId: string): number {
    return this.violationCounts.get(agentId) ?? 0;
  }

  /** Clear all violation counters. Used for test reset. */
  clearViolations(): void {
    this.violationCounts.clear();
  }
}
