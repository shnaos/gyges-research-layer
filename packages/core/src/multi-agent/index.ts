/**
 * Multi-Agent Runtime Isolation & Concurrent Sessions — public surface.
 *
 * Sprint 23 contracts: AgentRegistry, AgentQuotaManager, RuntimeLeaseManager,
 * RuntimeScheduler, and IsolationEngine. Purely in-memory, deterministic,
 * fail-closed. No network, database, browser, cloud sync, or new transports.
 */

// Types
export type {
  AgentStatus,
  AgentQuota,
  RuntimeLease,
  AgentRuntime,
  AgentIsolationDecision,
  SchedulingDecision
} from './types.js';

export {
  DEFAULT_AGENT_QUOTA,
  DEFAULT_LEASE_TTL_MS,
  INITIAL_AGENT_TRUST_SCORE,
  AGENT_RESTRICTED_THRESHOLD,
  AGENT_QUARANTINED_THRESHOLD
} from './types.js';

// Registry
export { AgentRegistry } from './registry.js';
export type { AgentRegistryOptions } from './registry.js';

// Quota manager
export { AgentQuotaManager } from './quotas.js';
export type { AgentQuotaManagerOptions } from './quotas.js';

// Lease manager
export { RuntimeLeaseManager } from './leases.js';
export type { RuntimeLeaseManagerOptions } from './leases.js';

// Scheduler
export { RuntimeScheduler } from './scheduler.js';
export type { RuntimeSchedulerOptions } from './scheduler.js';

// Isolation engine
export { IsolationEngine } from './isolation.js';
export type { IsolationEngineOptions } from './isolation.js';
