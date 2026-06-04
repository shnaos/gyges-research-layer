# Transport Routing & Isolation Policies (Sprint 8)

Sprint 8 introduces the first **deterministic routing and isolation decision
layer** for the Gyges Research Layer. It decides *which* transport an
already-authorised capability should use, *whether* a session must rotate, and
*how strongly* an execution must be isolated — while shipping **no real network
behaviour**.

> **Scope note (Sprint 8).** This layer performs **no real network I/O**. There
> is no `fetch`, no DNS resolution, no socket, no Tor, no proxy, no SearXNG, no
> browser automation, no database, no Redis. The only transport referenced is
> the `mock` transport from Sprint 6. The routing engine prepares the contract
> for future real transports (`direct`/`tor`/`proxy`/`searxng`/`browser`)
> without implementing any of them.

## Where routing sits

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
  Session Manager           (@gyges/core — mints/reuses/rotates a session id)
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
 Mock Transport ONLY        (Sprint 6 — deterministic, network-free)
```

Each layer owns exactly one concern, and the separation is strict:

- **Firewall** decides *whether* a capability is permitted. It never executes.
- **Approval Queue** gates capabilities flagged for human confirmation.
- **Session Manager** owns *session identity* lifecycle (create/reuse/rotate/
  expire/revoke). It never opens a connection.
- **Transport Policy Engine** *decides* routing/rotation/isolation. It never
  mints a session, opens a connection, or executes anything.
- **Execution Engine** selects the transport adapter and runs the request.

## The Transport Policy Engine

`TransportPolicyEngine` (in `packages/core/src/transport-policy/`) owns a set of
`TransportPolicyRule`s keyed by `(tool, riskLevel)` and resolves an
`ExecutionRequest` into exactly one `RoutingDecision`.

Design guarantees:

- **Deterministic** — identical inputs always produce identical decisions.
- **Fail-closed** — a missing rule throws `TransportPolicyError` (`no_rule`);
  there is no dangerous implicit fallback transport.
- **No silent overwrite** — registering a duplicate `(tool, riskLevel)` throws
  `TransportPolicyError` (`duplicate_rule`).
- **No mutation** — the incoming request and the stored rules are never mutated;
  `resolve` returns a fresh decision and `listRules` returns deep copies.

API surface:

```ts
registerRule(rule: TransportPolicyRule): void
resolve(request: ExecutionRequest): RoutingDecision
listRules(): TransportPolicyRule[]
clearRules(): void
```

`resolve` consults **only** `request.tool` and `request.riskLevel`. The session
identity is chosen by the caller **after** the decision — the engine never reads
or writes session state.

## Isolation policies

Every rule carries an `IsolationPolicy`:

```ts
interface IsolationPolicy {
  level: IsolationLevel;          // 'none' | 'session' | 'compartment' | 'strict'
  forceRotateOnHighRisk: boolean; // high-risk requests force a rotation
  forbidSessionReuse: boolean;    // reuse never permitted — always rotate
  allowCrossToolReuse: boolean;   // a session may be reused across tools
}
```

### Isolation levels

| Level         | Meaning                                                          |
| ------------- | ---------------------------------------------------------------- |
| `none`        | No isolation requirement; sessions may be freely reused.         |
| `session`     | Isolation scoped to a single session identity.                   |
| `compartment` | Isolation scoped to the owning identity compartment.             |
| `strict`      | Maximum isolation: each execution gets a fresh, non-reusable id. |

## Decision lifecycle

For an allowed-without-confirmation capability, the Local API boundary:

1. Builds a minimal `ExecutionRequest` (tool + riskLevel are what matter).
2. Calls `TransportPolicyEngine.resolve()` **before** touching any session. A
   missing rule is fail-closed: no session is created and the response is
   `decision: "denied"` (HTTP 200).
3. Selects a session per the decision:
   - `shouldRotateSession === true` → `SessionManager.rotateSession()`
   - otherwise → `SessionManager.getOrCreateSession()`
4. Injects `routing.transportKind` into the execution session context.
5. Runs the request through the `ExecutionEngine` (mock transport only).

`deny` and `pending` decisions short-circuit **before** routing: they never
resolve a routing decision, never select a session, and never execute.

### Reason resolution (deterministic precedence)

`resolve` evaluates these conditions in order and stops at the first match:

| # | Condition                                       | `shouldRotateSession` | `reason`            |
| - | ----------------------------------------------- | --------------------- | ------------------- |
| 1 | `forbidSessionReuse === true`                   | `true`                | `forced_rotation`   |
| 2 | high risk **and** `forceRotateOnHighRisk`       | `true`                | `forced_rotation`   |
| 3 | `level === 'strict'`                            | `true`                | `strict_isolation`  |
| 4 | high risk (rotation not forced)                 | `false`               | `risk_escalation`   |
| 5 | `level === 'none'`                              | `false`               | `default_transport` |
| 6 | otherwise (session/compartment, low/medium)     | `false`               | `reuse_allowed`     |

`transportKind` is always the matched rule's `preferredTransport`, and
`isolationLevel` is always the matched rule's `isolationPolicy.level`.

## Bootstrap rules

The local server boots with two deterministic rules (mock transport only):

```ts
// Rule 1 — low-risk search: session-scoped, reuse permitted.
{
  tool: 'search',
  riskLevel: 'low',
  preferredTransport: 'mock',
  isolationPolicy: {
    level: 'session',
    forceRotateOnHighRisk: true,
    forbidSessionReuse: false,
    allowCrossToolReuse: true
  }
}

// Rule 2 — medium-risk fetch_html: strict isolation, reuse forbidden.
{
  tool: 'fetch_html',
  riskLevel: 'medium',
  preferredTransport: 'mock',
  isolationPolicy: {
    level: 'strict',
    forceRotateOnHighRisk: true,
    forbidSessionReuse: true,
    allowCrossToolReuse: false
  }
}
```

Resolved decisions:

| Tool         | Risk     | Transport | Rotate | Isolation | Reason            |
| ------------ | -------- | --------- | ------ | --------- | ----------------- |
| `search`     | `low`    | `mock`    | no     | `session` | `reuse_allowed`   |
| `fetch_html` | `medium` | `mock`    | yes    | `strict`  | `forced_rotation` |

## HTTP surface

### `GET /v1/transport-policies`

Returns the bootstrap rules as pure metadata (no secrets, no tokens):

```bash
curl -s http://127.0.0.1:8787/v1/transport-policies
```

```json
{
  "rules": [
    {
      "tool": "search",
      "riskLevel": "low",
      "preferredTransport": "mock",
      "isolationPolicy": {
        "level": "session",
        "forceRotateOnHighRisk": true,
        "forbidSessionReuse": false,
        "allowCrossToolReuse": true
      }
    },
    {
      "tool": "fetch_html",
      "riskLevel": "medium",
      "preferredTransport": "mock",
      "isolationPolicy": {
        "level": "strict",
        "forceRotateOnHighRisk": true,
        "forbidSessionReuse": true,
        "allowCrossToolReuse": false
      }
    }
  ]
}
```

### `POST /v1/capabilities/execute-mock`

On an allowed execution, the response now carries a `routing` block alongside
the `execution` result:

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
  "routing": {
    "transportKind": "mock",
    "shouldRotateSession": false,
    "isolationLevel": "session",
    "reason": "reuse_allowed"
  },
  "execution": {
    "status": "success",
    "transportKind": "mock",
    "output": { "mock": true, "tool": "search", "input": "privacy research", "sessionId": "..." }
  }
}
```

`deny` and `pending` responses contain **no** `routing` block (routing is never
reached). A missing routing rule for an otherwise-allowed capability is
fail-closed and returns `decision: "denied"` without minting a session.

## Preparing future real transports

The engine and contracts are transport-agnostic. Future sprints can:

- register rules whose `preferredTransport` is `direct`/`tor`/`proxy`/`searxng`/
  `browser`, and
- implement the matching `TransportAdapter`s behind the existing
  `ExecutionEngine`,

without changing the routing decision model. Until then, **only the `mock`
transport exists and no real network egress occurs.**
