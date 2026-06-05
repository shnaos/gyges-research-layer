/**
 * CapabilityRateLimiter — deterministic, in-memory sliding-window rate limiting
 * and temporary capability blocking.
 *
 * Responsibilities (Sprint 13 MVP):
 *   - hold {@link RateLimitPolicy}s keyed by id (no silent duplicate)
 *   - {@link evaluate} one request against every enabled policy over a
 *     deterministic sliding window keyed by the policy's {@link RateLimitScope}
 *   - hold {@link TemporaryCapabilityBlock}s and short-circuit a request that a
 *     live block matches
 *   - expire blocks on demand
 *
 * Determinism & safety:
 *   - the reference clock is always the caller-supplied `timestamp`, so a
 *     decision is fully reproducible from a request sequence (no wall clock)
 *   - identical inputs always produce identical decisions
 *   - registered policies/blocks are deep-copied in and listed back as copies,
 *     so a caller can never mutate internal state through a held reference
 *   - fail-safe: when no policy applies the decision is always `allow`
 *
 * Strict non-goals: purely in-memory and side-effect free. NO database, NO
 * Redis, NO file write, NO network / DNS / socket, NO browser, NO durable
 * persistence, NO AI/ML.
 */

import {
  RateLimitDecision,
  RateLimitEvaluationInput,
  RateLimitPolicy,
  RateLimitScope,
  TemporaryCapabilityBlock
} from './types.js';

/** A very large "remaining" used when no policy constrains the request. */
const UNCONSTRAINED_REMAINING = Number.MAX_SAFE_INTEGER;

/** Deep-clone a {@link RateLimitPolicy}. */
function clonePolicy(policy: RateLimitPolicy): RateLimitPolicy {
  return {
    id: policy.id,
    scope: policy.scope,
    maxRequests: policy.maxRequests,
    windowMs: policy.windowMs,
    action: policy.action,
    enabled: policy.enabled
  };
}

/** Deep-clone a {@link TemporaryCapabilityBlock}. */
function cloneBlock(block: TemporaryCapabilityBlock): TemporaryCapabilityBlock {
  const clone: TemporaryCapabilityBlock = {
    id: block.id,
    createdAt: block.createdAt,
    expiresAt: block.expiresAt,
    reason: block.reason
  };
  if (block.agentId !== undefined) clone.agentId = block.agentId;
  if (block.compartmentId !== undefined) clone.compartmentId = block.compartmentId;
  if (block.tool !== undefined) clone.tool = block.tool;
  return clone;
}

/** Per-policy evaluation snapshot used to build the final decision. */
interface PolicyEvaluation {
  policy: RateLimitPolicy;
  count: number;
  remaining: number;
  resetAt: number;
}

export class CapabilityRateLimiter {
  /** Registered policies, in insertion order. */
  private readonly policies: RateLimitPolicy[] = [];
  /** Active temporary blocks, in insertion order. */
  private readonly blocks: TemporaryCapabilityBlock[] = [];
  /** Sliding-window request timestamps, keyed by `${policyId}\u0000${scopeKey}`. */
  private readonly windows = new Map<string, number[]>();

  /**
   * Register a rate-limit policy. Policy ids are unique: registering a policy
   * whose id already exists throws, so the policy set stays unambiguous.
   */
  registerPolicy(policy: RateLimitPolicy): void {
    if (this.policies.some((existing) => existing.id === policy.id)) {
      throw new Error(`Duplicate rate limit policy id: ${policy.id}`);
    }
    this.policies.push(clonePolicy(policy));
  }

  /** List the registered policies. Returns defensive copies in registration order. */
  listPolicies(): RateLimitPolicy[] {
    return this.policies.map(clonePolicy);
  }

  /** Remove every registered policy and drop all sliding-window state. */
  clearPolicies(): void {
    this.policies.length = 0;
    this.windows.clear();
  }

  /**
   * Evaluate one request.
   *
   * Order (fail-safe throughout):
   *   1. a live {@link TemporaryCapabilityBlock} that matches → `temporary_block`
   *   2. every enabled, in-scope policy records the request in its sliding
   *      window; the first policy whose in-window count *exceeds* `maxRequests`
   *      triggers its `action` (registration order = priority)
   *   3. otherwise → `allow` (with the most-constrained `remaining`)
   *
   * The reference clock is `input.timestamp`; the caller's object is never
   * mutated.
   */
  evaluate(input: RateLimitEvaluationInput): RateLimitDecision {
    // 1. Live temporary block short-circuits everything.
    const block = this.activeBlockFor(input);
    if (block) {
      const retryAfterMs = Math.max(0, block.expiresAt - input.timestamp);
      return {
        action: 'temporary_block',
        remaining: 0,
        resetAt: block.expiresAt,
        retryAfterMs,
        reason: `Temporary block "${block.id}" is active: ${block.reason}`
      };
    }

    // 2. Record + evaluate every enabled, in-scope policy.
    const evaluations: PolicyEvaluation[] = [];
    for (const policy of this.policies) {
      if (!policy.enabled) continue;
      const scopeKey = this.scopeKey(policy.scope, input);
      if (scopeKey === undefined) continue; // e.g. session scope with no session

      const bucketKey = `${policy.id}\u0000${scopeKey}`;
      const windowStart = input.timestamp - policy.windowMs;
      const pruned = (this.windows.get(bucketKey) ?? []).filter(
        (ts) => ts >= windowStart
      );
      pruned.push(input.timestamp);
      this.windows.set(bucketKey, pruned);

      const count = pruned.length;
      const remaining = Math.max(0, policy.maxRequests - count);
      const resetAt = pruned[0] + policy.windowMs;
      evaluations.push({ policy, count, remaining, resetAt });
    }

    // First policy whose count strictly exceeds its ceiling wins (priority by
    // registration order). `maxRequests` requests are allowed; the next trips it.
    const triggered = evaluations.find(
      (entry) => entry.count > entry.policy.maxRequests
    );
    if (triggered) {
      const decision: RateLimitDecision = {
        action: triggered.policy.action,
        remaining: 0,
        resetAt: triggered.resetAt,
        reason: `Rate limit policy "${triggered.policy.id}" (${triggered.policy.scope}) exceeded: ${triggered.count} > ${triggered.policy.maxRequests} within ${triggered.policy.windowMs}ms.`
      };
      // A wait-bearing action surfaces how long until the window frees up.
      if (
        triggered.policy.action === 'cooldown' ||
        triggered.policy.action === 'temporary_block'
      ) {
        decision.retryAfterMs = Math.max(0, triggered.resetAt - input.timestamp);
      }
      return decision;
    }

    // 3. Fail-safe allow. Surface the most-constrained remaining/reset.
    if (evaluations.length === 0) {
      return {
        action: 'allow',
        remaining: UNCONSTRAINED_REMAINING,
        resetAt: input.timestamp,
        reason: 'No rate limit policy applies.'
      };
    }
    const tightest = evaluations.reduce((min, entry) =>
      entry.remaining < min.remaining ? entry : min
    );
    return {
      action: 'allow',
      remaining: tightest.remaining,
      resetAt: tightest.resetAt,
      reason: 'Within rate limits.'
    };
  }

  /**
   * Register a temporary capability block. The block is deep-copied in, so a
   * later mutation of the caller's object can never affect the limiter.
   */
  registerTemporaryBlock(block: TemporaryCapabilityBlock): void {
    this.blocks.push(cloneBlock(block));
  }

  /** List every registered temporary block. Returns deep copies. */
  listTemporaryBlocks(): TemporaryCapabilityBlock[] {
    return this.blocks.map(cloneBlock);
  }

  /**
   * Drop every temporary block whose `expiresAt` is at or before `now`. Returns
   * the number of blocks removed. Defaults `now` to {@link Date.now}.
   */
  clearExpiredBlocks(now: number = Date.now()): number {
    let removed = 0;
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      if (this.blocks[i].expiresAt <= now) {
        this.blocks.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }

  /** Remove every temporary block. */
  clearTemporaryBlocks(): void {
    this.blocks.length = 0;
  }

  /**
   * The first live block (`input.timestamp < expiresAt`) that matches the
   * request, or `undefined`. A block matches when every *defined* field equals
   * the request's; an all-`undefined` block matches everything.
   */
  private activeBlockFor(
    input: RateLimitEvaluationInput
  ): TemporaryCapabilityBlock | undefined {
    return this.blocks.find((block) => {
      if (input.timestamp >= block.expiresAt) return false;
      if (block.agentId !== undefined && block.agentId !== input.agentId) {
        return false;
      }
      if (
        block.compartmentId !== undefined &&
        block.compartmentId !== input.compartmentId
      ) {
        return false;
      }
      if (block.tool !== undefined && block.tool !== input.tool) return false;
      return true;
    });
  }

  /**
   * The window key for a policy scope, or `undefined` when the request lacks the
   * dimension the scope needs (only `session` is optional).
   */
  private scopeKey(
    scope: RateLimitScope,
    input: RateLimitEvaluationInput
  ): string | undefined {
    switch (scope) {
      case 'agent':
        return `agent:${input.agentId}`;
      case 'compartment':
        return `compartment:${input.compartmentId}`;
      case 'session':
        return input.sessionId ? `session:${input.sessionId}` : undefined;
      case 'tool':
        return `tool:${input.tool}`;
      default:
        return undefined;
    }
  }
}
