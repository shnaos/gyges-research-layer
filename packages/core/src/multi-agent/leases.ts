/**
 * RuntimeLeaseManager — timed lease lifecycle for agent runtime access.
 *
 * Leases prevent starvation by giving an agent a bounded reservation on the
 * runtime. Expired leases are cleared lazily or on explicit `expireLeases()`
 * calls. This is purely in-memory with a local TTL clock.
 *
 * Constraints:
 *   - In-memory only, no persistence, no network.
 *   - Deterministic: same inputs → same outputs.
 *   - Fail-safe expiration: a crashed caller cannot hold a lease forever.
 *   - No tokens, secrets, or raw input stored.
 */

import { randomUUID } from 'node:crypto';
import { RuntimeLease, DEFAULT_LEASE_TTL_MS } from './types.js';
import { AgentRegistry } from './registry.js';

export interface RuntimeLeaseManagerOptions {
  /** Registry used to attach/detach leases from agent runtimes. */
  registry: AgentRegistry;
  /** Injectable clock. Defaults to {@link Date.now}. */
  now?: () => number;
  /** Injectable id generator. Defaults to {@link randomUUID}. */
  generateId?: () => string;
  /** Default lease TTL in milliseconds. Defaults to {@link DEFAULT_LEASE_TTL_MS}. */
  leaseTtlMs?: number;
  /** Whether leases are renewable. Defaults to `true`. */
  renewable?: boolean;
}

/** Deep-clone a {@link RuntimeLease}. */
function cloneLease(lease: RuntimeLease): RuntimeLease {
  return { ...lease };
}

/**
 * In-memory lease manager.
 *
 * Each agent may hold at most one active lease. Acquiring a second lease
 * replaces the first (the old one is released). Expired leases are cleared
 * lazily and on `expireLeases()`.
 */
export class RuntimeLeaseManager {
  private readonly registry: AgentRegistry;
  private readonly now: () => number;
  private readonly generateId: () => string;
  private readonly leaseTtlMs: number;
  private readonly renewable: boolean;
  /** All live leases keyed by lease id. */
  private readonly leases = new Map<string, RuntimeLease>();
  /** Agent → active lease id. One lease per agent. */
  private readonly agentLeaseIndex = new Map<string, string>();

  constructor(options: RuntimeLeaseManagerOptions) {
    this.registry = options.registry;
    this.now = options.now ?? Date.now;
    this.generateId = options.generateId ?? randomUUID;
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    this.renewable = options.renewable ?? true;
  }

  /**
   * Acquire a lease for `agentId`.
   *
   * If the agent already holds a lease, it is replaced (the old one is
   * implicitly released). Returns a defensive copy of the new lease.
   *
   * The lease is also attached to the agent runtime in the registry.
   */
  acquireLease(agentId: string): RuntimeLease {
    // Expire stale leases first.
    this.expireLeases();

    // Release any existing lease for this agent.
    const existingLeaseId = this.agentLeaseIndex.get(agentId);
    if (existingLeaseId !== undefined) {
      this.leases.delete(existingLeaseId);
    }

    const at = this.now();
    const lease: RuntimeLease = {
      id: this.generateId(),
      acquiredAt: at,
      expiresAt: at + this.leaseTtlMs,
      renewable: this.renewable,
      holderAgentId: agentId
    };
    this.leases.set(lease.id, lease);
    this.agentLeaseIndex.set(agentId, lease.id);

    // Attach to registry (best-effort — fails silently for unknown agents).
    this.registry.updateAgent(agentId, { lease: cloneLease(lease) });

    return cloneLease(lease);
  }

  /**
   * Release the lease identified by `id`.
   *
   * Silently ignored when the lease does not exist or has already expired.
   * Also detaches the lease from the agent runtime in the registry.
   */
  releaseLease(id: string): void {
    const lease = this.leases.get(id);
    if (lease === undefined) return;

    this.leases.delete(id);
    this.agentLeaseIndex.delete(lease.holderAgentId);

    // Detach from registry (best-effort).
    this.registry.updateAgent(lease.holderAgentId, { lease: undefined });
  }

  /**
   * Expire all leases whose `expiresAt` is at or before `now`.
   *
   * Each expired lease is removed from the store and detached from its agent's
   * runtime. Safe to call with no argument (uses the injected clock).
   */
  expireLeases(now: number = this.now()): void {
    for (const [id, lease] of this.leases) {
      if (lease.expiresAt <= now) {
        this.leases.delete(id);
        this.agentLeaseIndex.delete(lease.holderAgentId);
        // Detach from registry (best-effort).
        this.registry.updateAgent(lease.holderAgentId, { lease: undefined });
      }
    }
  }

  /**
   * Return defensive copies of all live leases in insertion order.
   *
   * Expired leases are not returned (they are cleared on this call).
   */
  listLeases(): RuntimeLease[] {
    this.expireLeases();
    return [...this.leases.values()].map(cloneLease);
  }

  /**
   * Return the active lease for `agentId`, or `undefined` when the agent has
   * no live lease. Expired leases are cleared before the lookup.
   */
  getAgentLease(agentId: string): RuntimeLease | undefined {
    this.expireLeases();
    const leaseId = this.agentLeaseIndex.get(agentId);
    if (leaseId === undefined) return undefined;
    const lease = this.leases.get(leaseId);
    return lease !== undefined ? cloneLease(lease) : undefined;
  }

  /** Number of live (non-expired) leases. */
  size(): number {
    this.expireLeases();
    return this.leases.size;
  }
}
