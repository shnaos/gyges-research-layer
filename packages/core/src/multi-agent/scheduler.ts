/**
 * RuntimeScheduler — deterministic, fairness-aware execution scheduler.
 *
 * Prevents runtime monopolisation by a single agent. Prioritises active, non-
 * restricted agents. The scheduling decision is purely deterministic: no async
 * queue, no threads, no real scheduling. It is a stateless gate: the same
 * registry state always produces the same decision.
 *
 * Constraints:
 *   - No real threading, no async queue, no complex concurrency.
 *   - Decision is purely deterministic given the current registry snapshot.
 *   - Fail-closed: unknown or evicted/quarantined agents are always denied.
 *   - No network, persistence, or browser work.
 */

import { AgentRegistry } from './registry.js';
import { SchedulingDecision } from './types.js';

export interface RuntimeSchedulerOptions {
  /** Registry used to read current agent states. */
  registry: AgentRegistry;
  /**
   * Maximum total concurrent executions across all active agents before new
   * requests are deferred. Defaults to 20.
   */
  maxGlobalConcurrentExecutions?: number;
}

/**
 * Deterministic execution scheduler.
 *
 * The scheduler checks:
 *   1. Whether the agent is registered and in an executable state.
 *   2. Whether the global execution ceiling is reached.
 *   3. Whether any non-restricted agent is being starved by a heavy agent.
 *
 * It returns a {@link SchedulingDecision} with `allowed = false` and a reason
 * when the execution should be deferred or denied.
 */
export class RuntimeScheduler {
  private readonly registry: AgentRegistry;
  private readonly maxGlobalConcurrentExecutions: number;

  constructor(options: RuntimeSchedulerOptions) {
    this.registry = options.registry;
    this.maxGlobalConcurrentExecutions =
      options.maxGlobalConcurrentExecutions ?? 20;
  }

  /**
   * Decide whether `agentId` may start a new execution right now.
   *
   * Denial reasons (in priority order):
   *  1. Agent not registered.
   *  2. Agent is evicted.
   *  3. Agent is quarantined.
   *  4. Agent is restricted (no new executions).
   *  5. Agent has reached its own `maxConcurrentExecutions` quota.
   *  6. Global execution ceiling reached.
   *  7. Agent is using a disproportionate share of global executions while
   *     other non-restricted agents are waiting at zero.
   *
   * Returns a defensive scheduling decision (never mutates the registry).
   */
  scheduleExecution(agentId: string): SchedulingDecision {
    const runtime = this.registry.getAgent(agentId);

    if (runtime === undefined) {
      return { allowed: false, reason: 'Agent not registered.' };
    }
    if (runtime.status === 'evicted') {
      return { allowed: false, reason: 'Agent has been evicted.' };
    }
    if (runtime.status === 'quarantined') {
      return { allowed: false, reason: 'Agent is quarantined.' };
    }
    if (runtime.status === 'restricted') {
      return { allowed: false, reason: 'Agent is restricted.' };
    }

    // Per-agent quota check.
    if (runtime.activeExecutions >= runtime.quota.maxConcurrentExecutions) {
      return {
        allowed: false,
        reason: `Agent execution quota reached (${runtime.quota.maxConcurrentExecutions}).`
      };
    }

    // Snapshot all agents to calculate global usage.
    const allAgents = this.registry.listAgents();
    const totalExecutions = allAgents.reduce(
      (sum, a) => sum + a.activeExecutions,
      0
    );

    if (totalExecutions >= this.maxGlobalConcurrentExecutions) {
      const agentsAhead = allAgents.filter(
        (a) =>
          a.agentId !== agentId &&
          (a.status === 'active' || a.status === 'idle') &&
          a.activeExecutions > 0
      ).length;
      return {
        allowed: false,
        reason: `Global execution ceiling reached (${this.maxGlobalConcurrentExecutions}).`,
        agentsAhead
      };
    }

    // Fairness: deny if this agent holds a disproportionate share while other
    // non-restricted agents are starved (activeExecutions === 0).
    const activeNonRestricted = allAgents.filter(
      (a) =>
        a.agentId !== agentId &&
        (a.status === 'active' || a.status === 'idle') &&
        a.activeExecutions === 0
    );
    if (activeNonRestricted.length > 0) {
      // The agent is monopolising if it holds >50 % of global capacity while
      // others have nothing.
      const monopolyThreshold = Math.floor(
        this.maxGlobalConcurrentExecutions / 2
      );
      if (runtime.activeExecutions >= monopolyThreshold) {
        return {
          allowed: false,
          reason:
            'Agent is monopolising runtime capacity; other agents are waiting.',
          agentsAhead: activeNonRestricted.length
        };
      }
    }

    return { allowed: true };
  }
}
