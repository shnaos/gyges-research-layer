/**
 * PolicyStore — deterministic, in-memory storage of capability policies.
 *
 * Policies are keyed by the (agentId, compartmentId) pair. There is no DB, no
 * persistence layer and no external dependency: this is intentionally a plain
 * map so decisions remain deterministic and easy to reason about.
 */

import { CapabilityPolicy } from '../capability-firewall/types.js';

/** Error thrown when two policies collide on the same (agent, compartment) key. */
export class PolicyCollisionError extends Error {
  constructor(public readonly key: string) {
    super(`Policy collision for "${key}".`);
    this.name = 'PolicyCollisionError';
  }
}

function policyKey(agentId: string, compartmentId: string): string {
  // The delimiter is encoded to avoid ambiguity if an id contains the separator.
  return `${encodeURIComponent(agentId)}::${encodeURIComponent(compartmentId)}`;
}

export class PolicyStore {
  private readonly policies = new Map<string, CapabilityPolicy>();

  constructor(initial: CapabilityPolicy[] = []) {
    for (const policy of initial) {
      this.add(policy);
    }
  }

  /**
   * Add a policy. Throws {@link PolicyCollisionError} if a policy already
   * exists for the same (agentId, compartmentId) pair. This keeps the store
   * unambiguous and decisions deterministic.
   */
  add(policy: CapabilityPolicy): this {
    const key = policyKey(policy.agentId, policy.compartmentId);
    if (this.policies.has(key)) {
      throw new PolicyCollisionError(key);
    }
    this.policies.set(key, policy);
    return this;
  }

  /** Add or replace a policy without raising a collision error. */
  set(policy: CapabilityPolicy): this {
    this.policies.set(policyKey(policy.agentId, policy.compartmentId), policy);
    return this;
  }

  /** Look up the policy for an (agentId, compartmentId) pair, if any. */
  get(agentId: string, compartmentId: string): CapabilityPolicy | undefined {
    return this.policies.get(policyKey(agentId, compartmentId));
  }

  has(agentId: string, compartmentId: string): boolean {
    return this.policies.has(policyKey(agentId, compartmentId));
  }

  get size(): number {
    return this.policies.size;
  }
}
