# GRL Human Approval Queue (`human-approval`)

The **Human Approval Queue** adds a local, in-memory human-in-the-loop step to
the [Capability Firewall](./architecture.md). When the firewall allows a
capability but flags it as **requiring confirmation**, GRL does not return the
decision directly: it enqueues a **pending approval request** and waits for a
human to `approve` or `reject` it.

> **Scope note (Sprint 5).** This feature performs **no real web transport**.
> There is no `fetch`, Tor, proxy, SearXNG, browser automation, scraping,
> database, Redis, WebSocket/SSE, user auth, JWT, or UI here. The queue is
> **purely in-memory** and disappears when the process exits. No capability is
> ever executed — approval only changes a request's status.

## Architecture

```
AI agent
   │
   ▼
GRL Local API           (apps/grl-server)
   │
   ▼
Capability Firewall     (@gyges/core)
   │
   ▼  decision.requiresConfirmation === true
Approval Queue          (@gyges/core — in-memory, no persistence)
   │
   ▼
Human decision          (approve / reject, or TTL expiry)
   │
   ▼
Capability execution    (future — NOT implemented in this sprint)
```

The agent only ever talks to the Local API boundary. `allowed` decisions are
returned immediately, `denied` decisions are returned immediately, and only a
decision with `requiresConfirmation === true` creates a pending request.

## Lifecycle

An approval request starts as `pending` and reaches exactly one terminal state.
Terminal states never transition again (deterministic transitions):

```
                approve(id, token)
   pending ───────────────────────▶ approved   (terminal)

                reject(id, token)
   pending ───────────────────────▶ rejected   (terminal)

                TTL elapsed
   pending ───────────────────────▶ expired    (terminal)
```

- `approve` / `reject` require the matching **opaque token** minted at creation.
- An **expired** request can no longer be approved or rejected.
- A request that is already `approved` or `rejected` cannot change again.

### `ApprovalRequest`

```ts
interface ApprovalRequest {
  id: string;
  createdAt: number;
  expiresAt: number;

  agentId: string;
  compartmentId: string;

  tool: CapabilityTool;
  riskLevel: RiskLevel;

  input: unknown;
  sanitizedInput?: unknown;

  reason: string;

  status: 'pending' | 'approved' | 'rejected' | 'expired';
}
```

### Approval token

The token is an **opaque**, randomly generated, non-predictable value (Node
standard `crypto.randomBytes`, 256 bits, hex-encoded). It is **not a JWT** and
carries no embedded claims — it is simply an unguessable handle:

```ts
interface ApprovalToken {
  value: string;
}
```

The token value is returned **exactly once**, in the `pending` response of
`POST /v1/capabilities/request`. It is **never** returned again by any other
endpoint, is **never** included in the pending listing, and is **never** logged.

## Endpoints

All endpoints are served by the local-only `grl-server` boundary (default
`http://127.0.0.1:8787`). See [the Local API doc](./local-api.md) for the
shared `GET /v1/health` and `POST /v1/capabilities/evaluate` endpoints.

### `POST /v1/capabilities/request`

Runs the firewall and routes the decision. Request body is identical to
`evaluate`:

```json
{
  "agentId": "local-agent",
  "compartmentId": "research",
  "tool": "fetch_html",
  "riskLevel": "medium",
  "input": "sensitive lookup"
}
```

Responses (always `200 OK`; a firewall deny is a successful evaluation):

**Allowed**

```json
{ "decision": "allowed", "reason": "Allowed by explicit policy rule.", "sanitizedInput": "..." }
```

**Denied**

```json
{ "decision": "denied", "reason": "Denied by default policy." }
```

**Pending** (the only response carrying a token)

```json
{
  "decision": "pending",
  "reason": "Allowed by explicit policy rule.",
  "approvalRequestId": "f0e1...",
  "approvalToken": "9b1c...<opaque>"
}
```

### `GET /v1/approvals/pending`

Returns only `pending` requests, as a **token-free** view (expired requests are
excluded):

```json
{
  "pending": [
    {
      "id": "f0e1...",
      "createdAt": 1730000000000,
      "expiresAt": 1730000600000,
      "agentId": "local-agent",
      "compartmentId": "research",
      "tool": "fetch_html",
      "riskLevel": "medium",
      "reason": "Allowed by explicit policy rule.",
      "status": "pending"
    }
  ]
}
```

### `POST /v1/approvals/:id/approve` and `POST /v1/approvals/:id/reject`

Body:

```json
{ "token": "9b1c...<opaque>" }
```

Status codes:

| Code | Meaning                                            |
| ---- | -------------------------------------------------- |
| 200  | Success — request is now `approved` / `rejected`   |
| 400  | Missing or invalid token                           |
| 404  | Unknown request id                                 |
| 409  | Request already finalized (`approved`/`rejected`)  |
| 410  | Request has expired                                |

Success body:

```json
{ "id": "f0e1...", "status": "approved" }
```

## Examples (`curl`)

```bash
# 1. Request a capability that requires confirmation → pending
RESP=$(curl -s http://127.0.0.1:8787/v1/capabilities/request \
  -H 'content-type: application/json' \
  -d '{"agentId":"local-agent","compartmentId":"research","tool":"fetch_html","riskLevel":"medium","input":"sensitive lookup"}')
echo "$RESP"
# => {"decision":"pending","reason":"...","approvalRequestId":"...","approvalToken":"..."}

ID=$(echo "$RESP"   | sed -E 's/.*"approvalRequestId":"([^"]+)".*/\1/')
TOKEN=$(echo "$RESP" | sed -E 's/.*"approvalToken":"([^"]+)".*/\1/')

# 2. Inspect the pending queue (no token is ever exposed here)
curl -s http://127.0.0.1:8787/v1/approvals/pending

# 3. Approve it
curl -s http://127.0.0.1:8787/v1/approvals/$ID/approve \
  -H 'content-type: application/json' \
  -d "{\"token\":\"$TOKEN\"}"
# => {"id":"...","status":"approved"}

# Or reject it instead
curl -s http://127.0.0.1:8787/v1/approvals/$ID/reject \
  -H 'content-type: application/json' \
  -d "{\"token\":\"$TOKEN\"}"
```

## Expiration

Each pending request carries a TTL. Once `expiresAt` is reached, the request
becomes `expired` (lazily on the next access, and proactively via
`expireOldRequests()`), and can no longer be approved or rejected.

- Default TTL: **10 minutes**.
- Configurable via the `GRL_APPROVAL_TTL_MS` environment variable.

```bash
GRL_APPROVAL_TTL_MS=60000 npm run dev:server   # 1-minute approval TTL
```

## Environment variables

| Variable               | Default     | Description                                  |
| ---------------------- | ----------- | -------------------------------------------- |
| `GRL_HOST`             | `127.0.0.1` | Local-only bind address (never `0.0.0.0`).   |
| `GRL_PORT`             | `8787`      | Local API port.                              |
| `GRL_MAX_BODY_BYTES`   | `262144`    | Maximum request body size.                   |
| `GRL_APPROVAL_TTL_MS`  | `600000`    | Approval request time-to-live, milliseconds. |

## Local security

- **Local-only by default**: the server binds to `127.0.0.1` and is never
  exposed externally.
- **No token leakage**: tokens are returned once at creation, never listed in
  `GET /v1/approvals/pending`, never logged, and never persisted.
- **No persistence**: the queue is entirely in-memory and is lost on restart.
- **No real web transport**: approving a request does **not** fetch, browse, or
  perform any network egress — it only updates the request's status. Actual
  capability execution is a future concern, intentionally out of scope here.

## Out of scope (explicitly not implemented)

DB, Redis, WebSocket, SSE, user authentication, JWT, UI, browser automation,
real `fetch`, Tor/SearXNG, multi-user, and cloud telemetry are **not** part of
this feature.
