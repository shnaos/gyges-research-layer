# Transport Adapters & Execution Engine (Sprint 6)

Sprint 6 introduces the **execution and transport abstraction** for the Gyges
Research Layer. It defines *how* an already-authorised capability is carried
out, while shipping **only a deterministic in-process mock** — no real network
behaviour exists yet.

> **Scope note (Sprint 6).** This layer performs **no real network I/O**. There
> is no `fetch`, no DNS resolution, no socket, no Tor, no proxy, no SearXNG, no
> browser automation, no database. The only transport implemented is the
> `MockTransportAdapter`.

## Where execution sits

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
  Execution Engine          (@gyges/core — selects a transport, runs it)
        │
        ▼
  Transport Adapter         (contract: kind + execute())
        │
        ▼
 Mock Transport ONLY        (Sprint 6 — deterministic, network-free)
```

The separation is strict and each layer owns exactly one concern:

- **Firewall** decides *whether* a capability is permitted (allow / deny /
  requires-confirmation). It never executes anything.
- **Approval Queue** holds confirmation-required requests for a human. It never
  executes anything.
- **Execution Engine** routes an *already-authorised* request to a transport. It
  never re-evaluates policy and never touches the network itself.
- **Transport Adapter** is the only place a real network mechanism would ever
  live. In Sprint 6 the only adapter is the mock.

## Contracts (`packages/core/src/execution`)

| Type | Role |
| --- | --- |
| `ExecutionStatus` | `success` \| `blocked` \| `failed` |
| `TransportKind` | `mock` \| `direct` \| `tor` \| `proxy` \| `searxng` \| `browser` |
| `SessionContext` | Opaque `sessionId`, `compartmentId`, `transportKind`, `createdAt` |
| `ExecutionRequest` | A fully-authorised request handed to the engine |
| `ExecutionResult` | The deterministic outcome of running a request |
| `TransportAdapter` | `{ kind; execute(request) }` — the adapter contract |
| `ExecutionEngine` | Selects an adapter by `session.transportKind` and runs it |
| `MockTransportAdapter` | The only transport shipped in Sprint 6 |
| `createSessionContext` | Minimal `SessionContext` generator |

### `ExecutionEngine`

Responsibilities:

- receive an `ExecutionRequest`;
- select the `TransportAdapter` registered for `request.session.transportKind`;
- **fail closed** when no adapter is registered → `status: 'blocked'` with a
  clear reason, and no execution;
- call `adapter.execute()` when an adapter is found;
- translate an adapter that throws into a clean `status: 'failed'` result with a
  safe error message;
- never mutate the incoming request;
- never perform network I/O itself.

### `TransportAdapter`

Every transport implementation declares the `TransportKind` it serves and
exposes a single `execute(request): Promise<ExecutionResult>`. Adapters must
treat the incoming request as immutable.

### Why `MockTransportAdapter` exists

The mock exists so the **entire execution path can be exercised end to end**
without any real egress. It is fully deterministic: given the same request it
always returns the same output shape, echoing the `tool`, the (sanitized)
`input`, and the `sessionId`. It performs **no fetch, no DNS, no socket, no
browser**.

Example output:

```json
{
  "mock": true,
  "tool": "search",
  "input": "bitcoin privacy research",
  "sessionId": "…"
}
```

### `SessionContext`

`createSessionContext` mints an **opaque** `sessionId` (UUID), propagates the
`compartmentId`, records the `transportKind` (`mock` in Sprint 6), and stamps a
`createdAt` timestamp. There is **no persistence and no real isolation yet** —
it only prepares the future Session Manager.

## HTTP endpoint: `POST /v1/capabilities/execute-mock`

This **experimental, mock-only** endpoint sits alongside the existing
evaluate/request/approval endpoints (it does **not** replace them). It:

1. evaluates the capability via the firewall;
2. on **denied** → returns the decision, **without executing**;
3. on **pending** (confirmation required) → creates an `ApprovalRequest`,
   **without executing**, returning the one-time approval token;
4. on **allowed** → builds an `ExecutionRequest` bound to a fresh mock
   `SessionContext` and runs it through the `ExecutionEngine` + mock transport;
5. returns the decision plus the execution result.

### Responses

Denied:

```json
{
  "decision": "denied",
  "reason": "…"
}
```

Pending:

```json
{
  "decision": "pending",
  "reason": "…",
  "approvalRequestId": "…",
  "approvalToken": "…"
}
```

Allowed + executed:

```json
{
  "decision": "allowed",
  "reason": "…",
  "execution": {
    "status": "success",
    "transportKind": "mock",
    "output": {
      "mock": true,
      "tool": "search",
      "input": "bitcoin privacy research",
      "sessionId": "…"
    }
  }
}
```

The approval token is **only** ever returned on pending creation; it is never
exposed on an allowed or denied response.

### `curl` example

```bash
curl -sS http://127.0.0.1:8787/v1/capabilities/execute-mock \
  -H 'content-type: application/json' \
  -d '{
    "agentId": "local-agent",
    "compartmentId": "research",
    "tool": "search",
    "riskLevel": "low",
    "input": "bitcoin privacy research"
  }'
```

## Future extension (NOT in Sprint 6)

The `TransportKind` union already names the transports a future sprint may add.
Each will be a new `TransportAdapter` registered on the engine — the engine and
all callers stay unchanged:

- `direct` — system resolver, direct egress
- `tor` — SOCKS5 with remote DNS over Tor
- `proxy` — SOCKS5/HTTP proxy with remote DNS
- `searxng` — metasearch via a SearXNG instance
- `browser` — headless browser automation

None of these are implemented yet. Sprint 6 ships the **contracts and the mock
only**.
