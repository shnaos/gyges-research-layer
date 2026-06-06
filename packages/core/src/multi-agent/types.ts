/**
 * Multi-Agent Runtime Isolation & Concurrent Sessions — core primitives.
 *
 * Sprint 23 introduces the first real multi-agent isolation layer for GRL.
 * Multiple local agents can now use GRL simultaneously without implicitly
 * sharing sessions, trust, quotas, approvals, transports, incidents, or
 * runtime state.
 *
 * Hard constraints (Sprint 23 MVP):
 *   - Purely in-memory, deterministic, fail-closed.
 *   - No network, no database, no persistence, no browser, no cloud sync.
 *   - No new external transport — the only transport remains SearXNG.
 *   - No tokens, secrets, or raw input stored anywhere.
 *   - Isolation is explicit and agent-scoped; nothing leaks cross-agent.
 */

/**
 * Lifecycle status of an agent runtime.
 *
 * - `active`      — agent is running normally
 * - `idle`        — agent is registered but currently has no active executions
 * - `restricted`  — agent is in a degraded state; certain actions are blocked
 * - `quarantined` — agent is fully denied execution
 * - `evicted`     — agent has been permanently removed from the registry
 */
export type AgentStatus = 'active' | 'idle' | 'restricted' | 'quarantined' | 'evicted';

/**
 * Per-agent resource quota.
 *
 * Every agent has its own isolated quota envelope. Quota counts are never
 * shared across agents.
 */
export interface AgentQuota {
  /** Maximum simultaneous executions for this agent. */
  maxConcurrentExecutions: number;
  /** Maximum open sessions for this agent. */
  maxSessions: number;
  /** Maximum pending approval requests for this agent. */
  maxApprovalsPending: number;
  /** Maximum audit events this agent may accumulate. */
  maxAuditEvents: number;
  /** Maximum open incidents attributed to this agent. */
  maxIncidents: number;
}

/**
 * A timed runtime lease held by one agent.
 *
 * Leases prevent starvation by reserving runtime access for a bounded period.
 * A lease that is not renewed before `expiresAt` is expired automatically.
 */
export interface RuntimeLease {
  /** Unique lease identifier. */
  id: string;
  /** Unix-ms timestamp when the lease was acquired. */
  acquiredAt: number;
  /** Unix-ms timestamp after which the lease expires. */
  expiresAt: number;
  /** Whether this lease can be renewed before expiry. */
  renewable: boolean;
  /** The agent that holds this lease. */
  holderAgentId: string;
}

/**
 * The full runtime state for a single agent.
 *
 * Returned by the registry. All counts reflect the live agent state and are
 * never shared with or visible to other agents.
 */
export interface AgentRuntime {
  /** Unique agent identifier. */
  agentId: string;
  /** Unix-ms creation timestamp. */
  createdAt: number;
  /** Unix-ms last-update timestamp. */
  updatedAt: number;
  /** Current lifecycle status. */
  status: AgentStatus;
  /** Compartments this agent is associated with. */
  compartments: string[];
  /** Agent-level trust score, 0..100. Derived from per-compartment profiles. */
  trustScore: number;
  /** Number of currently active sessions. */
  activeSessions: number;
  /** Number of currently active (in-flight) executions. */
  activeExecutions: number;
  /** Resource quota assigned to this agent. */
  quota: AgentQuota;
  /** Active lease, if any. */
  lease?: RuntimeLease;
}

/**
 * Decision produced by the agent isolation check.
 *
 * Used in the execute pipeline to gate agent-level access before quota,
 * firewall, and transport layers.
 */
export interface AgentIsolationDecision {
  /** Whether the action is allowed for this agent. */
  allowed: boolean;
  /** Human-readable denial reason. */
  reason?: string;
  /** When true, the runtime should evict this agent. */
  requiresEviction?: boolean;
  /** When true, the runtime should restrict this agent. */
  requiresRestriction?: boolean;
}

/**
 * A deterministic scheduling decision for a proposed agent execution.
 */
export interface SchedulingDecision {
  /** Whether this agent is allowed to run now. */
  allowed: boolean;
  /** Denial reason when not allowed. */
  reason?: string;
  /**
   * Number of agents ahead of this one, for informational purposes.
   * Not a real queue — purely metadata for observability.
   */
  agentsAhead?: number;
}

/** Default quota applied to every newly registered agent. */
export const DEFAULT_AGENT_QUOTA: AgentQuota = {
  maxConcurrentExecutions: 5,
  maxSessions: 10,
  maxApprovalsPending: 5,
  maxAuditEvents: 1000,
  maxIncidents: 50
};

/** Default lease TTL in milliseconds (5 minutes). */
export const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;

/** Initial agent trust score. */
export const INITIAL_AGENT_TRUST_SCORE = 70;

/** Trust score below which an agent is considered restricted. */
export const AGENT_RESTRICTED_THRESHOLD = 40;

/** Trust score below which an agent is considered quarantined. */
export const AGENT_QUARANTINED_THRESHOLD = 20;
