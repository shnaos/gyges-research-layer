/**
 * Agent isolation engine — derives agent-level isolation decisions from the
 * registry state and applies trust-propagation rules.
 *
 * Trust propagation rules (MVP):
 *   - If ≥2 of an agent's compartments are quarantined → restrict the agent.
 *   - If the agent trust score drops below AGENT_QUARANTINED_THRESHOLD → quarantine.
 *   - Repeated quota violations → trust degraded (handled via AgentQuotaManager).
 *
 * Constraints:
 *   - Purely deterministic, in-memory, fail-closed.
 *   - Never stores tokens, secrets, or raw input.
 *   - No cross-agent state sharing.
 */

import { AgentRegistry } from './registry.js';
import {
  AgentIsolationDecision,
  AGENT_QUARANTINED_THRESHOLD,
  AGENT_RESTRICTED_THRESHOLD
} from './types.js';

export interface IsolationEngineOptions {
  /** Registry used to read and update agent runtimes. */
  registry: AgentRegistry;
  /**
   * Minimum number of quarantined compartments that triggers agent restriction.
   * Defaults to 2.
   */
  quarantinedCompartmentThreshold?: number;
}

/**
 * Evaluates whether an agent is allowed to execute based on its current
 * runtime status, trust score, and compartment trust state.
 *
 * The isolation check is the outermost gate in the multi-agent pipeline:
 * it runs before quota, scheduler, and firewall checks.
 */
export class IsolationEngine {
  private readonly registry: AgentRegistry;
  private readonly quarantinedCompartmentThreshold: number;

  constructor(options: IsolationEngineOptions) {
    this.registry = options.registry;
    this.quarantinedCompartmentThreshold =
      options.quarantinedCompartmentThreshold ?? 2;
  }

  /**
   * Decide whether `agentId` is isolated from execution.
   *
   * Checks (in order):
   *   1. Agent not registered → denied (fail-closed).
   *   2. Agent evicted → denied.
   *   3. Agent quarantined → denied.
   *   4. Agent restricted → denied (with restriction flag).
   *   5. Trust score below quarantine threshold → quarantine + denied.
   *   6. Trust score below restricted threshold → restrict + denied.
   *   7. Otherwise → allowed.
   */
  checkIsolation(agentId: string): AgentIsolationDecision {
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
      return {
        allowed: false,
        reason: 'Agent is restricted.',
        requiresRestriction: true
      };
    }

    // Trust-score driven isolation.
    if (runtime.trustScore < AGENT_QUARANTINED_THRESHOLD) {
      this.registry.quarantineAgent(agentId);
      return {
        allowed: false,
        reason: 'Agent trust score below quarantine threshold.',
        requiresEviction: false
      };
    }

    if (runtime.trustScore < AGENT_RESTRICTED_THRESHOLD) {
      this.registry.restrictAgent(agentId);
      return {
        allowed: false,
        reason: 'Agent trust score below restriction threshold.',
        requiresRestriction: true
      };
    }

    return { allowed: true };
  }

  /**
   * Propagate compartment-level trust signals to the agent level.
   *
   * Called when external compartment trust changes (e.g. from the
   * CompartmentTrustEngine). Updates the agent trust score and applies
   * automatic restriction / quarantine when thresholds are crossed.
   *
   * @param agentId - The agent whose trust should be updated.
   * @param compartmentScores - Map of compartmentId → current trust score (0..100).
   */
  propagateCompartmentTrust(
    agentId: string,
    compartmentScores: Map<string, number>
  ): void {
    const runtime = this.registry.getAgent(agentId);
    if (runtime === undefined) return;
    if (runtime.status === 'evicted') return;

    // Count quarantined compartments (score < 20).
    let quarantinedCount = 0;
    let scoreSum = 0;
    let scoredCount = 0;

    for (const compartmentId of runtime.compartments) {
      const score = compartmentScores.get(compartmentId);
      if (score !== undefined) {
        scoreSum += score;
        scoredCount++;
        if (score < AGENT_QUARANTINED_THRESHOLD) {
          quarantinedCount++;
        }
      }
    }

    // Derive agent trust score as average of its compartment scores.
    const agentTrustScore =
      scoredCount > 0
        ? Math.round(scoreSum / scoredCount)
        : runtime.trustScore;

    // Update the agent's trust score.
    this.registry.updateAgent(agentId, { trustScore: agentTrustScore });

    // Multiple quarantined compartments → restrict the agent.
    if (quarantinedCount >= this.quarantinedCompartmentThreshold) {
      if (
        runtime.status !== 'restricted' &&
        runtime.status !== 'quarantined'
      ) {
        this.registry.restrictAgent(agentId);
      }
    }

    // Trust below quarantine threshold → quarantine the agent.
    if (agentTrustScore < AGENT_QUARANTINED_THRESHOLD) {
      this.registry.quarantineAgent(agentId);
    }
  }

  /**
   * Degrade the agent's trust score by `delta` (positive number = decrease).
   *
   * Clamps the resulting score to [0, 100] and applies status transitions.
   * Returns the new trust score.
   */
  degradeTrust(agentId: string, delta: number): number {
    const runtime = this.registry.getAgent(agentId);
    if (runtime === undefined) return 0;
    if (runtime.status === 'evicted') return runtime.trustScore;

    const newScore = Math.max(0, runtime.trustScore - Math.abs(delta));
    this.registry.updateAgent(agentId, { trustScore: newScore });

    if (newScore < AGENT_QUARANTINED_THRESHOLD) {
      this.registry.quarantineAgent(agentId);
    } else if (newScore < AGENT_RESTRICTED_THRESHOLD) {
      if (runtime.status !== 'quarantined') {
        this.registry.restrictAgent(agentId);
      }
    }

    return newScore;
  }
}
