# Multi-Agent Runtime Isolation

Sprint 23 introduces **Multi-Agent Runtime Isolation & Concurrent Sessions** to GRL. Multiple local AI agents can now use GRL simultaneously without sharing any runtime state.

---

## Overview

Before Sprint 23, GRL managed a single implicit runtime. All agents shared the same quota space, trust scores were compartment-only, and there were no runtime partitions between concurrent callers.

After Sprint 23:

```
Agent A                     Agent B
  ↓                           ↓
AgentRuntime A             AgentRuntime B
  ↓                           ↓
Compartment Sessions A     Compartment Sessions B
  ↓                           ↓
            GRL Runtime Core
```

Each agent has fully isolated:

- Runtime status and counters
- Quota enforcement
- Trust score
- Lease reservation
- Audit trace
- Session counts

---

## Isolation Model

Each agent is identified by an `agentId` string. When an agent first appears in a request, the `AgentRegistry` creates a runtime record for it.

Isolation is **explicit and fail-closed**:

- Unknown agent → denied
- Evicted agent → denied on all operations
- Quarantined agent → denied on execution
- Restricted agent → denied on execution
- No state is ever shared implicitly between agents

No two agents share quotas, leases, or trust scores regardless of which compartments they use.

---

## Components

### AgentRegistry

Central in-memory store. Tracks all registered agent runtimes.

```ts
import { AgentRegistry } from '@gyges/core';

const registry = new AgentRegistry();

const runtime = registry.registerAgent('agent-a');
// { agentId: 'agent-a', status: 'idle', trustScore: 70, ... }

registry.getAgent('agent-a');     // AgentRuntime | undefined
registry.listAgents();            // AgentRuntime[]
registry.evictAgent('agent-a');   // sets status = 'evicted', clears counts
registry.restrictAgent('agent-a'); // sets status = 'restricted'
registry.quarantineAgent('agent-a'); // sets status = 'quarantined'
registry.clear();
```

All returned objects are **defensive copies**. Callers cannot mutate registry state through returned references.

### AgentQuotaManager

Enforces per-agent execution and session quotas.

```ts
import { AgentQuotaManager } from '@gyges/core';

const quotaManager = new AgentQuotaManager({ registry });

quotaManager.canExecute('agent-a');          // boolean
quotaManager.recordExecutionStart('agent-a');
quotaManager.recordExecutionEnd('agent-a');

quotaManager.canCreateSession('agent-a');    // boolean
quotaManager.recordSessionCreated('agent-a');
quotaManager.recordSessionClosed('agent-a');
```

Repeated quota violations automatically trigger agent restriction.

### RuntimeLeaseManager

Reserves temporary runtime capacity for an agent.

```ts
import { RuntimeLeaseManager } from '@gyges/core';

const leaseManager = new RuntimeLeaseManager({ registry });

const lease = leaseManager.acquireLease('agent-a');
// { id, acquiredAt, expiresAt, renewable, holderAgentId }

leaseManager.releaseLease(lease.id);
leaseManager.expireLeases();          // prune stale leases
leaseManager.listLeases();            // active leases only
leaseManager.getAgentLease('agent-a'); // RuntimeLease | undefined
```

Leases expire after their TTL (default: 5 minutes). Acquiring a new lease replaces any existing lease for the same agent.

### RuntimeScheduler

Deterministic execution scheduling with global fairness.

```ts
import { RuntimeScheduler } from '@gyges/core';

const scheduler = new RuntimeScheduler({ registry });

const decision = scheduler.scheduleExecution('agent-a');
// { allowed: true } or { allowed: false, reason: '...' }
```

Denial reasons:

- Agent not registered
- Agent evicted / quarantined / restricted
- Per-agent execution quota reached
- Global execution ceiling reached

### IsolationEngine

Applies agent-level trust rules and compartment trust propagation.

```ts
import { IsolationEngine } from '@gyges/core';

const isolationEngine = new IsolationEngine({ registry });

isolationEngine.checkIsolation('agent-a');
// { allowed: boolean, reason?, requiresEviction?, requiresRestriction? }

isolationEngine.degradeTrust('agent-a', 10);  // returns new score
isolationEngine.propagateCompartmentTrust(
  'agent-a',
  new Map([['c1', 80], ['c2', 60]])
);
```

---

## Quotas

Default quotas per agent:

| Field | Default |
|-------|---------|
| `maxConcurrentExecutions` | 5 |
| `maxSessions` | 10 |
| `maxApprovalsPending` | 5 |
| `maxAuditEvents` | 1000 |
| `maxIncidents` | 50 |

When an agent exceeds a quota:

- The operation is **denied immediately**
- A violation is recorded
- After the configured violation threshold, the agent is automatically **restricted**

---

## Lease Lifecycle

```
acquireLease(agentId)
    ↓
lease stored (TTL = 5 min by default)
    ↓
releaseLease(id)  OR  expireLeases() after TTL
    ↓
lease removed; agent.lease = undefined
```

Expired leases are pruned lazily (on next `listLeases()` or `expireLeases()` call).

---

## Scheduler Behavior

`scheduleExecution(agentId)` is deterministic and synchronous. No threads, no queues. Decision order:

1. Agent registered? If not → denied
2. Agent status: evicted / quarantined / restricted → denied
3. Per-agent execution quota reached → denied
4. Global execution ceiling reached → denied
5. Fairness: agent monopolising >50% of global capacity while others have zero → denied
6. → allowed

---

## Trust Propagation

Agent trust is initialized at **70** (neutral). It degrades based on:

- Compartment trust propagation (average of compartment scores)
- Multiple quarantined compartments → agent restricted/quarantined
- Explicit `degradeTrust()` calls (e.g. on quota abuse or incidents)

Thresholds:

| Score Range | Status |
|-------------|--------|
| ≥ 41 | idle / active |
| 21 – 40 | restricted |
| 0 – 20 | quarantined |

---

## Runtime Restrictions & Eviction

**Restriction** (`POST /v1/agents/:agentId/restrict`):
- Sets `status = 'restricted'`
- Blocks execution and session creation
- Agent remains registered and can be observed

**Eviction** (`POST /v1/agents/:agentId/evict`):
- Sets `status = 'evicted'`
- Clears all active counters and lease
- Blocks **all** operations — permanent within the runtime lifetime

---

## API Endpoints

### List all agents

```
GET /v1/agents
```

Response: `{ agents: AgentRuntimeView[] }`

### Get a single agent

```
GET /v1/agents/:agentId
```

Response: `{ agent: AgentRuntimeView }` or `404`

### Agent leases

```
GET /v1/agents/:agentId/leases
```

Response: `{ agentId, leases: AgentLeaseView[] }`

### Agent session quota

```
GET /v1/agents/:agentId/sessions
```

Response: `{ agentId, activeSessions, maxSessions }`

### Agent trust

```
GET /v1/agents/:agentId/trust
```

Response: `{ trust: { agentId, trustScore, status } }`

### Restrict an agent

```
POST /v1/agents/:agentId/restrict
```

Response: `{ agentId, status: 'restricted', updatedAt }` or `400` (if evicted) / `404`

### Evict an agent

```
POST /v1/agents/:agentId/evict
```

Response: `{ agentId, status: 'evicted', updatedAt }` or `404`

All responses contain **metadata only** — never raw input, never secrets, never tokens.

---

## CLI Usage

```bash
# List all registered agents
grl agents

# Show a specific agent's runtime
grl agents local-agent

# List active leases for an agent
grl agents leases local-agent

# List all leases across all agents
grl agents leases

# Restrict an agent
grl agents restrict local-agent

# Evict an agent
grl agents evict local-agent

# JSON output
grl --output json agents
grl --output json agents local-agent
```

---

## SDK Usage

```ts
import { GrlAgentClient } from '@gyges/agent-sdk';

const client = new GrlAgentClient();

// List all runtimes
const agents = await client.listAgents();

// Get a single runtime
const agent = await client.getAgent('local-agent');

// List leases
const leases = await client.listAgentLeases('local-agent');

// Get trust info
const trust = await client.getAgentTrust('local-agent');

// Restrict
const result = await client.restrictAgent('local-agent');

// Evict
const result = await client.evictAgent('local-agent');
```

---

## Audit Events

| Event | Trigger |
|-------|---------|
| `agent_registered` | First time an agent runtime is created |
| `agent_restricted` | `POST /v1/agents/:agentId/restrict` |
| `agent_quarantined` | Trust score falls below quarantine threshold |
| `agent_evicted` | `POST /v1/agents/:agentId/evict` |
| `agent_quota_exceeded` | Quota check fails for any operation |
| `agent_lease_acquired` | Lease acquired for an agent |
| `agent_lease_expired` | Lease TTL elapsed |

Events are emitted via `SecurityEventEngine` — metadata only, no raw input.

---

## Fail-Closed Behavior

| Situation | Result |
|-----------|--------|
| Unknown agent | denied |
| Evicted agent (any operation) | denied |
| Quarantined agent (execution) | denied |
| Restricted agent (execution) | denied |
| Quota exceeded | denied |
| Global ceiling reached | denied |
| Missing agentId in request | denied |

GRL never falls through to allow when isolation state is unclear.

---

## MVP Limitations

- Agent runtimes are **in-memory only** — they do not survive server restart.
- Quota values are set at startup via `DEFAULT_AGENT_QUOTA` — per-agent custom quotas require a future sprint.
- No real-time push notifications when an agent is restricted or evicted.
- No cross-agent incident aggregation — incidents remain compartment-scoped in Sprint 23.
- No agent authentication — agents are identified by `agentId` string only.
- Trust propagation from compartments must be triggered explicitly; it is not wired automatically into the execute-mock pipeline in Sprint 23.

---

## Security Constraints

- No state is ever shared implicitly between agents.
- No tokens, secrets, or raw input are stored in any agent runtime field.
- Eviction is permanent for the lifetime of the server process.
- All API responses expose metadata only.
- Fail-closed: any missing or invalid agent state results in denial.
