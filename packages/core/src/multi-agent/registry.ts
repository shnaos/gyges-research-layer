/**
 * AgentRegistry — deterministic, in-memory agent runtime registry.
 *
 * Tracks one {@link AgentRuntime} per unique agentId. All returned values are
 * defensive deep copies — callers can never mutate registry state through a
 * held reference.
 *
 * Constraints:
 *   - Purely in-memory, no persistence, no network.
 *   - Fail-closed: unknown agent → evicted defaults (denied).
 *   - Deterministic: identical operation sequences yield identical state.
 *   - No tokens, secrets, or raw input ever stored.
 */

import { randomUUID } from 'node:crypto';
import {
  AgentRuntime,
  AgentStatus,
  AgentQuota,
  DEFAULT_AGENT_QUOTA,
  INITIAL_AGENT_TRUST_SCORE
} from './types.js';

export interface AgentRegistryOptions {
  /** Injectable clock. Defaults to {@link Date.now}. */
  now?: () => number;
  /** Injectable id generator. Defaults to {@link randomUUID}. */
  generateId?: () => string;
  /** Default quota for newly registered agents. */
  defaultQuota?: AgentQuota;
}

/** Deep-clone an {@link AgentRuntime}. Defensive copy — never exposes internals. */
function cloneRuntime(runtime: AgentRuntime): AgentRuntime {
  const clone: AgentRuntime = {
    agentId: runtime.agentId,
    createdAt: runtime.createdAt,
    updatedAt: runtime.updatedAt,
    status: runtime.status,
    compartments: [...runtime.compartments],
    trustScore: runtime.trustScore,
    activeSessions: runtime.activeSessions,
    activeExecutions: runtime.activeExecutions,
    quota: { ...runtime.quota }
  };
  if (runtime.lease !== undefined) {
    clone.lease = { ...runtime.lease };
  }
  return clone;
}

/**
 * In-memory registry for all agent runtimes.
 *
 * A single `AgentRegistry` instance is shared by the server and never exposes
 * mutable references. All methods that return an `AgentRuntime` return
 * defensive copies.
 */
export class AgentRegistry {
  private readonly runtimes = new Map<string, AgentRuntime>();
  private readonly now: () => number;
  private readonly defaultQuota: AgentQuota;

  constructor(options: AgentRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.defaultQuota = options.defaultQuota
      ? { ...options.defaultQuota }
      : { ...DEFAULT_AGENT_QUOTA };
  }

  /**
   * Register a new agent and return its initial runtime.
   *
   * If the agent is already registered and NOT evicted, returns the existing
   * runtime unchanged (idempotent). An evicted agent cannot be re-registered —
   * returns the evicted runtime.
   */
  registerAgent(agentId: string): AgentRuntime {
    const existing = this.runtimes.get(agentId);
    if (existing !== undefined) {
      return cloneRuntime(existing);
    }

    const at = this.now();
    const runtime: AgentRuntime = {
      agentId,
      createdAt: at,
      updatedAt: at,
      status: 'idle',
      compartments: [],
      trustScore: INITIAL_AGENT_TRUST_SCORE,
      activeSessions: 0,
      activeExecutions: 0,
      quota: { ...this.defaultQuota }
    };
    this.runtimes.set(agentId, runtime);
    return cloneRuntime(runtime);
  }

  /**
   * Return a defensive copy of the runtime for `agentId`, or `undefined` when
   * no such agent is registered.
   */
  getAgent(agentId: string): AgentRuntime | undefined {
    const runtime = this.runtimes.get(agentId);
    return runtime !== undefined ? cloneRuntime(runtime) : undefined;
  }

  /**
   * Return defensive copies of all registered agent runtimes in insertion order.
   */
  listAgents(): AgentRuntime[] {
    return [...this.runtimes.values()].map(cloneRuntime);
  }

  /**
   * Update mutable fields of an agent runtime.
   *
   * Silently ignored when the agent is not registered.
   * Returns the updated runtime, or `undefined` when the agent is not found.
   */
  updateAgent(
    agentId: string,
    updates: Partial<
      Pick<
        AgentRuntime,
        | 'status'
        | 'compartments'
        | 'trustScore'
        | 'activeSessions'
        | 'activeExecutions'
        | 'lease'
      >
    >
  ): AgentRuntime | undefined {
    const runtime = this.runtimes.get(agentId);
    if (runtime === undefined) return undefined;

    if (updates.status !== undefined) runtime.status = updates.status;
    if (updates.compartments !== undefined) {
      runtime.compartments = [...updates.compartments];
    }
    if (updates.trustScore !== undefined) {
      runtime.trustScore = Math.max(0, Math.min(100, updates.trustScore));
    }
    if (updates.activeSessions !== undefined) {
      runtime.activeSessions = Math.max(0, updates.activeSessions);
    }
    if (updates.activeExecutions !== undefined) {
      runtime.activeExecutions = Math.max(0, updates.activeExecutions);
    }
    if ('lease' in updates) {
      runtime.lease = updates.lease !== undefined ? { ...updates.lease } : undefined;
    }
    runtime.updatedAt = this.now();
    return cloneRuntime(runtime);
  }

  /**
   * Evict an agent: set its status to `evicted` and clear its active counts.
   *
   * An evicted agent's runtime is preserved for audit/observability purposes
   * but it can no longer register, execute, or acquire leases. Silently ignored
   * when the agent is not registered.
   */
  evictAgent(agentId: string): AgentRuntime | undefined {
    const runtime = this.runtimes.get(agentId);
    if (runtime === undefined) return undefined;

    runtime.status = 'evicted';
    runtime.activeExecutions = 0;
    runtime.activeSessions = 0;
    runtime.lease = undefined;
    runtime.updatedAt = this.now();
    return cloneRuntime(runtime);
  }

  /**
   * Restrict an agent: set its status to `restricted`.
   *
   * A restricted agent can still be observed but execution is blocked.
   * Silently ignored when the agent is not registered or already evicted.
   */
  restrictAgent(agentId: string): AgentRuntime | undefined {
    const runtime = this.runtimes.get(agentId);
    if (runtime === undefined) return undefined;
    if (runtime.status === 'evicted') return cloneRuntime(runtime);

    runtime.status = 'restricted';
    runtime.updatedAt = this.now();
    return cloneRuntime(runtime);
  }

  /**
   * Quarantine an agent: set its status to `quarantined`.
   *
   * A quarantined agent is denied all execution. Silently ignored when the
   * agent is not registered or already evicted.
   */
  quarantineAgent(agentId: string): AgentRuntime | undefined {
    const runtime = this.runtimes.get(agentId);
    if (runtime === undefined) return undefined;
    if (runtime.status === 'evicted') return cloneRuntime(runtime);

    runtime.status = 'quarantined';
    runtime.updatedAt = this.now();
    return cloneRuntime(runtime);
  }

  /**
   * Add a compartment to an agent's compartment list if not already present.
   *
   * Returns the updated runtime, or `undefined` when the agent is not found.
   */
  addCompartment(agentId: string, compartmentId: string): AgentRuntime | undefined {
    const runtime = this.runtimes.get(agentId);
    if (runtime === undefined) return undefined;

    if (!runtime.compartments.includes(compartmentId)) {
      runtime.compartments.push(compartmentId);
      runtime.updatedAt = this.now();
    }
    return cloneRuntime(runtime);
  }

  /** Remove every registered agent. Used for clean-slate test setup. */
  clear(): void {
    this.runtimes.clear();
  }

  /** Number of registered agents (including evicted). */
  size(): number {
    return this.runtimes.size;
  }
}
