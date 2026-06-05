# Capability Execution Audit Trail & Security Event Engine (Sprint 11)

Sprint 11 introduces the first **structured audit trail** and **runtime security
event engine** for the Gyges Research Layer. Together they record a normalised,
defensive timeline of every security-relevant moment in the request lifecycle —
firewall decisions, routing resolution, privacy boundary actions, sandbox
verdicts, execution outcomes, session lifecycle, and approval decisions — and
expose them over local read-only endpoints for debugging and incident analysis.

> **Scope note (Sprint 11).** This layer performs **no real network I/O** and
> adds **no durable persistence**. There is no database, no Redis, no file
> writes, no `fetch`, no DNS, no socket, no Tor/proxy/SearXNG, no browser, no
> websocket/SSE, and no cloud telemetry. The audit store is **purely
> in-memory** and is lost when the process exits. No approval token, secret, raw
> HTTP header, raw environment, raw stack trace, or raw request input is ever
> stored.

## Where the audit layer sits

```
Local agent / local UI
        │
        ▼
   GRL Local API                (apps/grl-server)
        │
        ▼
 Capability Firewall            (@gyges/core — deny-by-default decision)
        │
        ▼
   Approval Queue               (@gyges/core — human-in-the-loop, when required)
        │
        ▼
 Privacy Boundary Engine        (@gyges/core — anti-correlation decision)
        │
        ▼
   Session Manager              (@gyges/core — session identity)
        │
        ▼
 Transport Policy Engine        (@gyges/core — routing / isolation decision)
        │
        ▼
 Transport Capability Registry  (@gyges/core — adapter sandbox decision)
        │
        ▼
   Execution Engine             (@gyges/core — mock transport only)
        │
        ▼
 Audit Trail / Security Event   (@gyges/core — normalised event timeline)
        │
        ▼
   Mock Transport only
```

## Core building blocks

The module lives in `packages/core/src/audit` and is exported from
`@gyges/core`.

### `AuditStore`

A deterministic, in-memory store of `SecurityEvent`s.

- `append(event)` — store an already-stamped event; returns a defensive copy
- `list(query?)` — return matching events as deep copies, in **stable order**
  (`timestamp` ascending, then insertion order for ties)
- `getById(id)` — return a deep copy of one event, or `undefined`
- `clear()` / `size()`

All inputs and outputs are deep-cloned, so a caller can never mutate internal
state, and a later mutation of the caller's object never reaches the store.

### `SecurityEventEngine`

The runtime façade that stamps and records events into an `AuditStore`.

- `emit(input)` — assign a unique `id` and a `timestamp`, then record the event
  (the caller's `metadata` is never mutated — it is deep-cloned on the way in)
- `query(query?)` — read matching events
- `getEvent(id)` — read one event
- `clear()` / `size()`

The id generator and clock are **injectable**, so tests are fully deterministic.
By default a local UUID and `Date.now` are used.

## Event types

```
capability_allowed          capability_denied
approval_pending            approval_approved        approval_rejected
privacy_boundary_blocked    privacy_boundary_rotation
routing_resolved
session_created             session_rotated          session_revoked
sandbox_allowed             sandbox_blocked
execution_started           execution_succeeded
execution_blocked           execution_failed
```

`session_revoked` is part of the contract but is **not emitted** in this sprint:
there is no session-revoke endpoint yet.

Each event carries an `EventSeverity` (`debug` | `info` | `warning` |
`critical`) and optional correlation ids (`agentId`, `compartmentId`,
`sessionId`, `requestId`, `executionId`, `approvalRequestId`).

## Audited `execute-mock` lifecycle

`POST /v1/capabilities/execute-mock` emits events along its decision path. Every
event for a single request shares one `requestId` correlation id.

- **Firewall deny** → `capability_denied` only. No routing or execution events.
- **Firewall pending** (confirmation required) → `approval_pending` only. No
  routing or execution events.
- **Allowed** → `capability_allowed`, then `routing_resolved`.
  - **Privacy block** → `privacy_boundary_blocked`. No session or execution.
  - **Privacy require-approval** → `approval_pending`. No execution.
  - **Privacy rotate** → `privacy_boundary_rotation`, then a session event.
  - **Session lifecycle** → `session_rotated` (rotation) or `session_created`
    (a fresh session was minted).
  - **Execution** → `execution_started`, then:
    - sandbox allowed + success → `sandbox_allowed` + `execution_succeeded`
    - sandbox blocked → `sandbox_blocked` + `execution_blocked`
    - adapter error → `execution_failed`

The sandbox events are only emitted when the Execution Engine is wired with a
Transport Capability Registry (the default local server is).

## Approval endpoint events

- `POST /v1/approvals/:id/approve` → `approval_approved`
- `POST /v1/approvals/:id/reject` → `approval_rejected`

The approval **token is never logged**. Only secret-free metadata (`tool`,
`riskLevel`) and the `approvalRequestId` are recorded.

## Audit read endpoints

### `GET /v1/audit/events`

List recorded events, newest-timestamp-last (stable order). Supported query
parameters (all optional, combined with AND semantics):

```
type           one of the SecurityEventType values
severity       debug | info | warning | critical
agentId        exact match
compartmentId  exact match
sessionId      exact match
requestId      exact match
executionId    exact match
since          inclusive lower timestamp bound (integer)
until          inclusive upper timestamp bound (integer)
limit          non-negative integer cap (applied after ordering)
```

- `200` with `{ "events": [...] }`
- `400` on an invalid query parameter
- `405` on any non-`GET` method

### `GET /v1/audit/events/:id`

Fetch a single event.

- `200` with `{ "event": { ... } }`
- `404` when the id is unknown
- `405` on any non-`GET` method

## Example curl

```bash
# Run a capability through the mock transport (produces audit events).
curl -s -X POST http://127.0.0.1:8787/v1/capabilities/execute-mock \
  -H 'content-type: application/json' \
  -d '{"agentId":"local-agent","compartmentId":"research","tool":"search","riskLevel":"low","input":"example"}'

# List every recorded security event.
curl -s http://127.0.0.1:8787/v1/audit/events

# Filter by type and severity.
curl -s 'http://127.0.0.1:8787/v1/audit/events?type=execution_succeeded&severity=info'

# Filter by correlation id and cap the result count.
curl -s 'http://127.0.0.1:8787/v1/audit/events?agentId=local-agent&limit=10'

# Fetch a single event by id.
curl -s http://127.0.0.1:8787/v1/audit/events/<event-id>
```

## Non-storage policy (secrets / tokens / raw input)

The audit trail is privacy-first. An event **never** contains:

- an `approvalToken` or any secret / credential
- full HTTP headers or raw environment
- raw stack traces
- real network data
- the **raw request input**

`metadata` is kept minimal: decision reason, `tool`, `riskLevel`,
`transportKind`, sandbox violation codes, routing reason, privacy signals, and
execution status. When an input shape is useful, only a privacy-safe descriptor
is stored — `inputType` and `inputSizeBytes` — never the input value itself.

## Limits (in-memory, no real network)

- The store is **in-memory only**: events are lost when the process restarts.
- There is **no durable persistence**, no database, no file, no cloud logging.
- There is **no real network** of any kind — execution runs through the `mock`
  transport only. The audit layer observes and records; it never connects.
