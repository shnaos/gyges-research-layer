# Capability Execution Graph & Dependency Isolation

Sprint 15 introduces GRL's first **execution capability graph**. Until now GRL
reasoned about each capability request **in isolation** — the firewall, defense
pipeline, trust engine and privacy boundary each judged a single request. They
had **no model of the relationships between capabilities** and could not reason
about a *path* of execution (for example `search → fetch_html → fetch_json`).

This layer adds a deterministic, in-memory **graph** of capability nodes and
edges plus a small rule engine that decides whether the *next* step of an
execution path is safe. It can detect dangerous chains, forbid cross-tool
escalation, cap path length, and force session rotation or human approval before
a transition is allowed.

Like every other GRL layer it performs **no** networking, fetch, DNS, socket,
browser, websocket/SSE, database, Redis, durable persistence, authentication, or
AI/ML/semantic classification work, and it **never** stores tokens, secrets, or
raw caller input — only minimal metadata. GRL remains fully agnostic: there is
no coupling to any external product.

```
Agent (local)
  ↓
Capability Graph Engine          ← Sprint 15
  ↓
Compartment Trust Engine
  ↓
Adaptive Defense Engine
  ↓
Capability Firewall
  ↓
Approval Queue
  ↓
Privacy Boundary Engine
  ↓
Session Manager
  ↓
Transport Policy Engine
  ↓
Transport Capability Registry
  ↓
Adapter Sandbox
  ↓
Execution Engine
  ↓
Security Event Engine
  ↓
Runtime Security Heuristics Engine
  ↓
Incident Detector
  ↓
Audit Store
  ↓
Mock Transport only
```

## Role of the `CapabilityGraphEngine`

The engine maintains an in-memory directed graph and two registries of rules. It
runs **first** in the `execute-mock` pipeline (after HTTP validation, before the
trust gate) and answers a single question for each request:

> *Given the path this compartment has already walked, is the next capability
> allowed, does it need approval, does it require a forced rotation, or must it
> be blocked?*

The answer is a `CapabilityPathDecision`:

```ts
interface CapabilityPathDecision {
  action: 'allow' | 'require_approval' | 'force_rotation' | 'block';
  risk: 'low' | 'medium' | 'high' | 'blocked';
  reason: string;
  relatedNodeIds: string[];
  relatedEdgeIds: string[];
}
```

## Nodes and edges

A **node** is a point in the execution graph; an **edge** records a relationship
between two nodes.

```ts
type CapabilityNodeKind =
  | 'request' | 'capability' | 'approval'
  | 'execution' | 'sandbox' | 'privacy_boundary';

interface CapabilityNode {
  id: string;
  kind: CapabilityNodeKind;
  agentId?: string;
  compartmentId?: string;
  tool?: CapabilityTool;
  riskLevel?: RiskLevel;
  createdAt: number;
}

interface CapabilityEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relation:
    | 'requested' | 'approved' | 'executed'
    | 'blocked' | 'depends_on' | 'transitioned_to';
  createdAt: number;
}
```

Nodes and edges are only ever **appended**; the engine never mutates or deletes
existing entries (except via `clear()`). `listNodes`/`listEdges` return defensive
copies so callers cannot mutate internal state. Adding an edge whose endpoints do
not exist, or re-adding a duplicate id, is rejected.

## Transition rules

A `CapabilityTransitionRule` whitelists a `fromTool → toTool` transition and caps
the risk that transition may carry:

```ts
interface CapabilityTransitionRule {
  id: string;
  fromTool: CapabilityTool;
  toTool: CapabilityTool;
  maxAllowedRisk: 'low' | 'medium' | 'high' | 'blocked';
  actionOnViolation: 'allow' | 'require_approval' | 'force_rotation' | 'block';
  enabled: boolean;
}
```

A tool change that is **not** covered by an enabled rule is blocked. Disabled
rules are ignored. Registering two rules with the same id is rejected.

### Bootstrap transition rules

```ts
[
  { id: 'search-to-fetch-html',     fromTool: 'search',     toTool: 'fetch_html', maxAllowedRisk: 'medium', actionOnViolation: 'require_approval', enabled: true },
  { id: 'fetch-html-to-fetch-json', fromTool: 'fetch_html', toTool: 'fetch_json', maxAllowedRisk: 'medium', actionOnViolation: 'require_approval', enabled: true }
]
```

## Dependency isolation policies

A `DependencyIsolationPolicy` constrains an entire path for one compartment:

```ts
interface DependencyIsolationPolicy {
  id: string;
  compartmentId: string;
  maxPathLength: number;
  forbidCrossToolEscalation: boolean;
  requireApprovalOnToolChange: boolean;
  blockOnHighRiskPath: boolean;
  enabled: boolean;
}
```

There is at most one policy per compartment; a missing or disabled policy is
**fail-closed** (the request is blocked). Registering a duplicate id, or a second
policy for the same compartment, is rejected.

### Bootstrap isolation policy

```ts
{
  id: 'research-default-dependency-isolation',
  compartmentId: 'research',
  maxPathLength: 5,
  forbidCrossToolEscalation: true,
  requireApprovalOnToolChange: true,
  blockOnHighRiskPath: true,
  enabled: true
}
```

## Execution path risk

Each request carries a `RiskLevel` (`low`/`medium`/`high`). The engine ranks the
path risk as the **maximum** risk seen across the current path plus the incoming
request. A blocked decision always reports `risk: 'blocked'`. There is **no**
heuristic or ML scoring — the risk is a deterministic maximum of declared levels.

## Decision rules (MVP precedence)

`evaluatePath` applies the following ordered rules (first match wins):

1. No applicable / disabled isolation policy → **block** (fail-closed).
2. Path length would exceed `maxPathLength` → **block**.
3. First capability of the compartment → **allow** (it bootstraps the path;
   downstream gates still decide its fate).
4. Same tool as the previous step → **allow** (unless the path is high risk and
   `blockOnHighRiskPath` is set → block).
5. Tool change with no enabled transition rule → **block**.
6. High-risk path with `blockOnHighRiskPath` → **block**.
7. Request risk exceeds the rule's `maxAllowedRisk` → the rule's
   `actionOnViolation`.
8. Cross-tool **escalation** (tool change that also raises risk) with
   `forbidCrossToolEscalation` → **force_rotation**.
9. Tool change with `requireApprovalOnToolChange` → **require_approval**.
10. Otherwise the rule-authorised transition → **allow**.

The path for a compartment only **grows** on an `allow`/`force_rotation` outcome
or a successful execution. `block` and `require_approval` outcomes record a
minimal node/edge but do **not** advance the path.

## `execute-mock` lifecycle

The graph gate is the **first** decision stage:

1. HTTP validation
2. **`CapabilityGraphEngine.evaluatePath()`**
3. Compartment Trust gate
4. Adaptive Defense (rate limits + defense)
5. Capability Firewall
6. Approval Queue
7. Privacy Boundary
8. Session Manager
9. Routing
10. Sandbox
11. Execution
12. Audit / Heuristics / Incidents / Trust

Behaviour by graph action:

| Graph action      | Effect on the request                                              |
| ----------------- | ------------------------------------------------------------------ |
| `allow`           | Continue normally.                                                 |
| `require_approval`| Response `pending`; no session, no execution.                      |
| `force_rotation`  | Continue, but a forced session rotation is applied downstream.     |
| `block`           | Response `denied`; no session, no execution.                       |

On a successful execution the engine records a `capability` node (advancing the
path), an `execution` node, and an `executed` edge. `deny`/`pending` outcomes
record only minimal nodes/edges and never store the raw input.

Every `execute-mock` response now includes a `capabilityGraph` block:

```json
{
  "capabilityGraph": {
    "action": "allow",
    "risk": "low",
    "reason": "First capability in compartment execution path.",
    "relatedNodeIds": [],
    "relatedEdgeIds": []
  }
}
```

## Audit events

The graph emits four new `SecurityEventType`s through the shared
`observeSecurity` path (which feeds heuristics, incidents and trust — but **not**
back into the graph, so there is no audit → graph → audit loop):

- `capability_graph_allowed`
- `capability_graph_blocked`
- `capability_graph_approval_required`
- `capability_graph_rotation_required`

## HTTP endpoints

All endpoints are **read-only** and return **metadata only** — never a token,
secret, or raw input.

| Method | Path                                       |
| ------ | ------------------------------------------ |
| GET    | `/v1/capability-graph/nodes`               |
| GET    | `/v1/capability-graph/edges`               |
| GET    | `/v1/capability-graph/transition-rules`    |
| GET    | `/v1/capability-graph/isolation-policies`  |

Optional query params (each may appear at most once, otherwise `400`):

- `agentId`
- `compartmentId`
- `tool`

Status codes: `200` success, `400` invalid query, `405` wrong method.

### Example curl

```bash
curl -s http://127.0.0.1:8787/v1/capability-graph/transition-rules
curl -s http://127.0.0.1:8787/v1/capability-graph/isolation-policies
curl -s 'http://127.0.0.1:8787/v1/capability-graph/nodes?compartmentId=research'
curl -s 'http://127.0.0.1:8787/v1/capability-graph/edges?tool=search'
```

## Privacy & non-storage guarantees

- No real network, fetch, DNS, socket, browser, websocket/SSE.
- No database, Redis, or durable persistence — the graph is **in-memory** and is
  lost on restart.
- No AI/ML or semantic classification — all decisions are deterministic rule
  evaluation over declared risk levels.
- Tokens, secrets, and raw caller input are **never** stored on nodes or edges,
  and are never returned by the endpoints.

## Known limits

- The graph is in-memory and not bounded/garbage-collected beyond `clear()`; it
  is intended for a single local session.
- Path tracking is keyed by compartment only; it does not distinguish concurrent
  agents within the same compartment.
- Risk is a declared maximum, not an inferred score.
