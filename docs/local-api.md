# GRL Local API (`grl-server`)

The **GRL Local API** is the local usage frontier of the Gyges Research Layer.
It makes the [Capability Firewall](./architecture.md) consumable by a local AI
agent, a future CLI, a future local UI, or a future MCP adapter — over a small,
local-only HTTP boundary.

> **Scope note (Sprint 4).** This boundary performs **no real web transport**.
> There is no `fetch`, Tor, proxy, SearXNG, browser automation, scraping,
> database, or remote telemetry here. The evaluate endpoint runs the firewall
> and returns the **decision only**.

## Architecture

```
Local AI agent / local UI
        │
        ▼
   GRL Local API        (apps/grl-server — this document)
        │
        ▼
 Capability Firewall    (@gyges/core)
        │
        ▼
   Policy Engine        (@gyges/policy-engine)
        │
        ▼
   Policy Store         (in-memory bootstrap policy, no persistence)
        │
        ▼
    Sanitizer           (sanitized input echoed on allow)
```

The agent only ever talks to this boundary. The boundary maps the HTTP request
to a capability request, runs the **real** `CapabilityFirewall`, and returns a
typed decision. A firewall **deny is a successful evaluation** — it is returned
with `200 OK` and `allowed: false`, never as an HTTP error.

## Endpoints

| Method | Path                         | Description                          |
| ------ | ---------------------------- | ------------------------------------ |
| `GET`  | `/v1/health`                 | Liveness probe.                      |
| `POST` | `/v1/capabilities/evaluate`  | Evaluate a capability via firewall.  |

### `GET /v1/health`

Response `200 OK`:

```json
{
  "status": "ok",
  "service": "grl-server"
}
```

### `POST /v1/capabilities/evaluate`

Request body (`application/json`):

```json
{
  "agentId": "local-agent",
  "compartmentId": "research",
  "tool": "search",
  "riskLevel": "low",
  "input": "bitcoin privacy research"
}
```

Response `200 OK` (allowed):

```json
{
  "allowed": true,
  "reason": "Allowed by explicit policy rule.",
  "requiresConfirmation": false,
  "sanitizedInput": "bitcoin privacy research"
}
```

Response `200 OK` (denied — note: still `200`, not a `4xx`):

```json
{
  "allowed": false,
  "reason": "Denied by default policy.",
  "requiresConfirmation": false
}
```

`sanitizedInput` is only present when the capability is allowed. `delayMs` is
included only when the matched policy rule defines a delay.

## Bootstrap policy (MVP)

The server starts with a single in-memory policy. **No persistence.**

```ts
{
  agentId: "local-agent",
  compartmentId: "research",
  allowedTools: ["search", "fetch_html", "fetch_json"],
  maxRiskLevel: "low",
  requiresConfirmationAbove: "low"
}
```

Consequences (deny-by-default):

- `low` is **allowed** without confirmation.
- `medium` / `high` overflow `maxRiskLevel: low` and are **denied**.
- An unknown `agentId` is **denied**.
- An unknown `compartmentId` is **denied**.
- A tool outside `allowedTools` is **denied**.

## HTTP status codes

| Status | When                                                              |
| ------ | ---------------------------------------------------------------- |
| `200`  | Successful firewall evaluation — including `allowed: false`.     |
| `400`  | Invalid HTTP request: missing/invalid fields, malformed JSON, wrong/absent `Content-Type`. |
| `404`  | Unknown route.                                                   |
| `405`  | Wrong method on a known route.                                   |
| `413`  | Request body exceeds the configured maximum.                    |
| `500`  | Unexpected runtime error.                                       |

A firewall deny is **never** turned into a `4xx`.

## Local-only security

The server listens on **`127.0.0.1` only by default** and never on `0.0.0.0`.

- Default host: `127.0.0.1`
- Default port: `8787`
- Default max body size: `262144` bytes (256 KiB)

### Environment variables

| Variable             | Default     | Description                          |
| -------------------- | ----------- | ------------------------------------ |
| `GRL_HOST`           | `127.0.0.1` | Bind address (keep local).           |
| `GRL_PORT`           | `8787`      | Listen port.                         |
| `GRL_MAX_BODY_BYTES` | `262144`    | Maximum accepted request body bytes. |

## Running

```bash
# Start the local API server (defaults to 127.0.0.1:8787)
npm run dev:server

# Build the server
npm run build:server

# Run the server tests
npm run test:server
```

## `curl` examples

Health:

```bash
curl -s http://127.0.0.1:8787/v1/health
```

Evaluate — allowed:

```bash
curl -s -X POST http://127.0.0.1:8787/v1/capabilities/evaluate \
  -H 'content-type: application/json' \
  -d '{
    "agentId": "local-agent",
    "compartmentId": "research",
    "tool": "search",
    "riskLevel": "low",
    "input": "bitcoin privacy research"
  }'
```

Evaluate — denied (risk overflow, still `200 OK`):

```bash
curl -s -X POST http://127.0.0.1:8787/v1/capabilities/evaluate \
  -H 'content-type: application/json' \
  -d '{
    "agentId": "local-agent",
    "compartmentId": "research",
    "tool": "search",
    "riskLevel": "medium",
    "input": "x"
  }'
```
