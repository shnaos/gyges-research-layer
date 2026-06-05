# Adaptive Defense & Capability Rate Limiting

Sprint 13 introduces GRL's first **active defensive layer**. Until now GRL could
**observe, audit, detect, open incidents, sandbox, and isolate** — but it could
not **slow an agent down, impose cooldowns, temporarily block a capability,
degrade permissions, or react** to dangerous patterns. This layer adds exactly
those active behaviours, while staying **deterministic, in-memory, and offline**.

Like every other GRL layer it performs **no** networking, fetch, DNS, socket,
browser, websocket/SSE, database, Redis, durable persistence, authentication, or
AI/ML/semantic classification work, and it **never** stores tokens, secrets, or
raw caller input. GRL remains fully agnostic — there is no coupling to any
external product.

```
Agent (local)
  ↓
Capability Firewall
  ↓
Adaptive Defense Engine        ← Sprint 13
  ↓
Rate Limiter                   ← Sprint 13
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
Incident Store / Audit Store
  ↓
Mock Transport only
```

The module lives in [`packages/core/src/adaptive-defense`](../packages/core/src/adaptive-defense)
and is re-exported from `@gyges/grl-core` via `export * from './adaptive-defense'`.

## CapabilityRateLimiter

`CapabilityRateLimiter` counts capability requests over **static sliding
windows** and holds **temporary capability blocks**. It is deterministic and
purely in-memory.

```ts
registerPolicy(policy: RateLimitPolicy): void   // unique id, throws on duplicate
evaluate(input: RateLimitEvaluationInput): RateLimitDecision
listPolicies(): RateLimitPolicy[]               // defensive copies
clearPolicies(): void

registerTemporaryBlock(block: TemporaryCapabilityBlock): void
listTemporaryBlocks(): TemporaryCapabilityBlock[]
clearExpiredBlocks(now?: number): number        // returns removed count
```

A `RateLimitPolicy` is scoped to an `agent`, `compartment`, `session`, or `tool`,
and allows `maxRequests` per `windowMs`. When the limit is exceeded the policy's
configured `action` is returned (`cooldown`, `require_approval`, …).

### Rules (MVP)

1. **Under limit** → `action = allow`.
2. **Limit reached** → `action = policy.action`.
3. **Active temporary block** → `action = temporary_block` (checked first).
4. **Cooldown** → `retryAfterMs` is set on the decision.
5. **Disabled policy** → ignored.
6. **Sliding windows are deterministic** — the window reference time is the
   caller-supplied `timestamp`, never a wall clock.
7. **Fail-safe** — when no policy matches, the decision is `allow`.

A temporary block matches a request when **every defined** field (`agentId`,
`compartmentId`, `tool`) equals the request's; an all-undefined block is global.
A block is active while `timestamp < expiresAt`; `clearExpiredBlocks(now)` removes
blocks whose `expiresAt <= now`.

## AdaptiveDefenseEngine

`AdaptiveDefenseEngine` maps the **runtime anomaly / incident vocabulary** (from
the Sprint 12 [Runtime Security Heuristics & Incident Detection](./runtime-security-heuristics.md)
layer) onto active defense actions.

```ts
registerPolicy(policy: AdaptiveDefensePolicy): void   // unique id, throws on duplicate
listPolicies(): AdaptiveDefensePolicy[]               // defensive copies
clearPolicies(): void
evaluate(input: AdaptiveDefenseEvaluationInput): AdaptiveDefenseDecision[]
```

A policy **fires** when ANY input anomaly's type is listed in
`triggerAnomalyTypes`, **or** ANY input incident's severity is listed in
`triggerIncidentSeverities`. `evaluate` returns one `AdaptiveDefenseDecision` per
fired, **enabled** policy in registration order. The input is never mutated.

### Rules (MVP)

1. `repeated_denied_capabilities` → `cooldown`.
2. `sandbox_violation_attempts` → `temporary_block`.
3. `privacy_boundary_violations` → `require_approval`.
4. **critical** incident → `escalate_risk`.
5. Disabled policies are ignored.
6. Decisions are deterministic.

For an `escalate_risk` decision the engine reports a nominal baseline
`originalRisk` because it does not see the live request risk; the **integration
layer** recomputes the real escalation against the actual request risk using
`escalateRisk(current, target, reason)`.

## Defense lifecycle inside `execute-mock`

The defense layer runs **before** the Capability Firewall. The required order is:

1. HTTP validation
2. **Rate limiter**
3. **Adaptive defense checks**
4. Capability Firewall
5. Approval Queue
6. Privacy Boundary
7. Session Manager
8. Routing
9. Sandbox
10. Execution
11. Audit + Heuristics + Incidents

Both defense steps are **fail-safe**: an `allow` decision is invisible. A
non-`allow` decision either ends the request or escalates the effective risk:

- **cooldown** → `{ "decision": "denied", "defense": { "action": "cooldown",
  "retryAfterMs": 1234 } }`.
- **temporary_block** → `{ "decision": "denied", "defense": { "action":
  "temporary_block" } }`.
- **require_approval** → a `pending` approval flow (an `approvalRequestId` /
  `approvalToken` is returned exactly as for a firewall-driven confirmation).
- **escalate_risk** → the request's `riskLevel` is raised **in place** before the
  firewall, routing, and privacy boundary run, so downstream policies see the
  escalated risk. The escalation is surfaced under `response.defense.escalation`.

When two adaptive decisions are produced, the strongest is chosen by precedence:
`temporary_block` > `cooldown` > `require_approval` > `escalate_risk`.

## Defense audit events

The layer emits the following new `SecurityEventType`s through the Sprint 11
[Audit Trail & Security Event Engine](./audit-security-events.md). Events carry
**metadata only** (tool, action, reason, risk levels) — never a token, secret, or
raw input.

| Event | Emitted when |
| --- | --- |
| `rate_limit_triggered` | The rate limiter returns a non-`allow` decision. |
| `cooldown_applied` | A `cooldown` action is enforced. |
| `temporary_block_applied` | A `temporary_block` action is enforced. |
| `risk_escalated` | An adaptive `escalate_risk` actually raised the risk. |
| `adaptive_defense_triggered` | The adaptive engine produced ≥ 1 decision. |

These defense event types are intentionally **not** part of the anomaly event
vocabulary, so emitting them never feeds the heuristics engine back into itself.

## Defense read endpoints

All endpoints are **read-only metadata**. They never return a token, secret, or
raw caller input.

| Endpoint | Returns |
| --- | --- |
| `GET /v1/defense/rate-limits` | Registered `RateLimitPolicy` shapes. |
| `GET /v1/defense/temporary-blocks` | Active `TemporaryCapabilityBlock`s. |
| `GET /v1/defense/adaptive-policies` | Registered `AdaptiveDefensePolicy` shapes. |

Each endpoint returns `405 Method Not Allowed` for non-`GET` verbs.

```bash
curl -s http://127.0.0.1:8787/v1/defense/rate-limits
curl -s http://127.0.0.1:8787/v1/defense/temporary-blocks
curl -s http://127.0.0.1:8787/v1/defense/adaptive-policies
```

## Bootstrap policies

Rate limits:

| id | scope | maxRequests | windowMs | action |
| --- | --- | --- | --- | --- |
| `agent-search-rate` | `agent` | 10 | 60000 | `cooldown` |
| `tool-fetch-html-rate` | `tool` | 5 | 60000 | `require_approval` |

Adaptive policies: `repeated-denied-defense` (cooldown),
`sandbox-defense` (temporary_block), `privacy-boundary-defense` (require_approval),
`approval-rejection-defense` (require_approval), and `risk-escalation-defense`
(escalate_risk to `high`).

## What this layer does NOT do

- No AI / ML / semantic classification — only explicit policy matching.
- No real network, fetch, DNS, socket, browser, websocket/SSE.
- No database, Redis, or durable persistence — all state is in-memory.
- No authentication / JWT, no cloud telemetry.
- Never logs or stores tokens, secrets, or raw caller input.
- No coupling to any external product — GRL stays agnostic.
