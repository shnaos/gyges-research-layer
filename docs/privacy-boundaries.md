# Privacy Boundaries & Compartment Correlation (Sprint 9)

Sprint 9 introduces the first **deterministic anti-correlation / privacy
boundary layer** for the Gyges Research Layer. It decides whether an
already-authorised capability may proceed given the risk of **correlating**
identity compartments, **reusing context across tools**, or **crossing an
isolation boundary** — while shipping **no real network behaviour**.

> **Scope note (Sprint 9).** This layer performs **no real network I/O**. There
> is no `fetch`, no DNS resolution, no socket, no Tor, no proxy, no SearXNG, no
> browser automation, no database, no Redis, and **no AI / semantic
> classification**. The only transport referenced anywhere in the pipeline is
> the `mock` transport from Sprint 6. The boundary engine prepares the contract
> for future real anti-correlation work without implementing any of it.

## Where the privacy boundary sits

```
Local agent / local UI
        │
        ▼
   GRL Local API            (apps/grl-server)
        │
        ▼
 Capability Firewall        (@gyges/core — deny-by-default decision)
        │
        ▼
   Approval Queue           (@gyges/core — human-in-the-loop, when required)
        │
        ▼
 Privacy Boundary Engine    (@gyges/core — anti-correlation / boundary decision)
        │
        ▼
   Session Manager          (@gyges/core — mints/reuses/rotates a session id)
        │
        ▼
 Transport Policy Engine    (@gyges/core — decides transport/rotation/isolation)
        │
        ▼
  Execution Engine          (@gyges/core — runs the chosen transport)
        │
        ▼
  Transport Adapter         (contract: kind + execute())
        │
        ▼
   Mock Transport           (the ONLY transport — no real egress)
```

In `POST /v1/capabilities/execute-mock` the privacy boundary is evaluated
**after** the Transport Policy Engine resolves routing (so it can observe the
routing isolation level) but **before** any session is minted or rotated and
before any execution runs.

## Role of the PrivacyBoundaryEngine

The `PrivacyBoundaryEngine` owns a set of `PrivacyBoundaryRule`s keyed by
`(sourceCompartmentId, targetCompartmentId)` and evaluates a request into a
single `PrivacyBoundaryDecision`. It is:

- **deterministic** — identical inputs always produce identical decisions;
- **fail-closed** — an unknown target compartment, or a missing
  `(source, target)` rule, blocks. There is no implicit fallback;
- **side-effect free** — it NEVER mints a session, NEVER rotates a session,
  NEVER opens a connection, and NEVER runs an execution. It only decides;
- **non-mutating** — the evaluation input and the stored rules are never
  mutated; `listRules()` returns deep copies.

## Firewall vs routing policy vs privacy boundary

These three layers are complementary and intentionally separate:

| Layer | Question it answers | Sprint |
| --- | --- | --- |
| **Capability Firewall** | *Is this agent allowed to use this tool at this risk at all?* | 3 |
| **Transport Policy Engine** | *Which transport, and must the session rotate / how isolated?* | 8 |
| **Privacy Boundary Engine** | *Does proceeding risk correlating compartments or leaking context across a boundary?* | 9 |

A firewall **deny** or **pending** short-circuits the whole pipeline and never
reaches routing or the privacy boundary. Routing resolves the transport/isolation
metadata; the privacy boundary then decides whether the correlation risk of that
flow is acceptable.

## Correlation signals

| Signal | Meaning |
| --- | --- |
| `same_compartment` | source and target are the same compartment |
| `cross_compartment` | source and target differ (a boundary crossing) |
| `cross_tool_reuse` | a session would be reused across tools when forbidden |
| `risk_escalation` | the request risk exceeds the rule's allowed ceiling |
| `strict_isolation_required` | routing demanded `strict` isolation |
| `unknown_compartment` | the target compartment is not recognised |

## Actions

| Action | Caller obligation |
| --- | --- |
| `allow` | proceed; rotation/reuse is still governed by the routing decision |
| `rotate_session` | force a fresh session before executing (anti-correlation) |
| `require_approval` | defer to the human approval queue; do **not** execute now |
| `block` | refuse outright; no session, no execution |

## Correlation risk levels

`none` < `low` < `medium` < `high`. The decision's `riskLevel` is the highest
risk across all triggered violations. A clean in-boundary `allow` is reported at
`low`; a hard boundary crossing (unknown / cross compartment / fail-closed) is
reported at `high`.

## Decision lifecycle

Evaluation proceeds in a fixed, deterministic order:

1. **Unknown target compartment** → `block` / `high` /
   `[unknown_compartment]` (fail-closed).
2. **Missing `(source, target)` rule** → `block` / `high` (fail-closed). When a
   source is omitted, the request is treated as **self-access** into the target.
3. **Correlation signals against the matched rule** are gathered
   (`cross_compartment`, `risk_escalation`, `cross_tool_reuse`,
   `strict_isolation_required`). Each maps to a candidate action and the **most
   restrictive** action wins:
   - `strict_isolation_required` → `rotate_session` (or `block` if the rule
     mandates it);
   - `cross_tool_reuse` → `rotate_session` (or `block` if the rule mandates it);
   - `risk_escalation` / `cross_compartment` → the rule's `actionOnViolation`.
4. **No violation** → `allow` / `low` / `[same_compartment]`.

Action severity ordering: `allow` < `rotate_session` < `require_approval` <
`block`.

## Bootstrap rule

The local server boots with a single privacy boundary rule:

```ts
{
  id: 'research-self',
  sourceCompartmentId: 'research',
  targetCompartmentId: 'research',
  maxAllowedRisk: 'low',
  actionOnViolation: 'require_approval'
}
```

Consequences:

- `research` → `research` at `low` risk → **allow**
- `research` → `research` above `low` → **require_approval** (risk escalation)
- `research` → `research` with strict routing isolation → **rotate_session**
- `unknown` → `research` → **block** (no `(unknown, research)` rule, fail-closed)
- `research` → `unknown` → **block** (unknown target compartment)

## HTTP surface

### `GET /v1/privacy-boundaries`

Returns the bootstrap privacy boundary rules as pure metadata (no secrets, no
compartment data):

```bash
curl -s http://127.0.0.1:8787/v1/privacy-boundaries
```

```json
{
  "rules": [
    {
      "id": "research-self",
      "sourceCompartmentId": "research",
      "targetCompartmentId": "research",
      "maxAllowedRisk": "low",
      "actionOnViolation": "require_approval"
    }
  ]
}
```

### `POST /v1/capabilities/execute-mock`

An **allowed** execution now carries a `privacyBoundary` block:

```bash
curl -s -X POST http://127.0.0.1:8787/v1/capabilities/execute-mock \
  -H 'content-type: application/json' \
  -d '{
        "agentId": "local-agent",
        "compartmentId": "research",
        "tool": "search",
        "riskLevel": "low",
        "input": "privacy research"
      }'
```

```json
{
  "decision": "allowed",
  "reason": "...",
  "routing": { "transportKind": "mock", "shouldRotateSession": false, "isolationLevel": "session", "reason": "reuse_allowed" },
  "privacyBoundary": {
    "action": "allow",
    "riskLevel": "low",
    "signals": ["same_compartment"],
    "reason": "..."
  },
  "execution": { "status": "success", "transportKind": "mock", "output": { "mock": true } }
}
```

A **privacy block** denies execution with no session and no execution payload:

```json
{
  "decision": "denied",
  "reason": "Privacy boundary blocked execution.",
  "routing": { "...": "..." },
  "privacyBoundary": {
    "action": "block",
    "riskLevel": "high",
    "signals": ["cross_compartment"]
  }
}
```

A **privacy `require_approval`** returns `pending`, enqueues an approval request,
and never executes. A **privacy `rotate_session`** forces a fresh session before
the mock execution runs.

## No real network — guarantees

Sprint 9 adds **no** real egress of any kind. The privacy boundary layer:

- performs no `fetch`, DNS, socket, Tor, proxy, SearXNG, or browser work;
- adds no database, Redis, websocket/SSE, auth/JWT, or cloud telemetry;
- adds no AI / semantic classification;
- is fully in-memory, deterministic, and agnostic of any external product.

## Preparing future real anti-correlation

The contracts (`CorrelationSignal`, `BoundaryViolation`, `CorrelationRiskLevel`,
`PrivacyBoundaryRule`) are deliberately stable so that future sprints can plug in
richer correlation detection (e.g. fingerprint/timing/context heuristics across
real transports) **without** changing the decision shape the Local API boundary
already consumes.
