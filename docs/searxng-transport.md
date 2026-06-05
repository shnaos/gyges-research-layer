# SearXNG Transport Adapter — Sprint 17

## Role

The SearXNG Transport Adapter is the **first real network transport** in GRL.
It allows a GRL agent to execute a `search` capability against a locally-configured
[SearXNG](https://searxng.github.io/searxng/) instance.

Every security constraint from the previous mock-only sprints still applies.
The adapter is **disabled by default** and never activated unless the runtime
config explicitly enables it.

---

## execute vs execute-mock

| Endpoint | Transport | Notes |
|---|---|---|
| `POST /v1/capabilities/execute-mock` | Always mock | Unchanged from Sprint 11. Deterministic, no network. |
| `POST /v1/capabilities/execute` | Configurable | Uses Transport Policy Engine to route. Default fallback is `mock`. SearXNG is only used when `transports.searxng.enabled = true` and a transport policy rule routes `search` to `searxng`. |

The `/v1/capabilities/execute-mock` endpoint is untouched by this sprint.

---

## Runtime Configuration

Extend your `grl.config.json` with the `transports.searxng` section to enable
the real transport:

```json
{
  "transports": {
    "searxng": {
      "baseUrl": "http://127.0.0.1:8080",
      "timeoutMs": 5000,
      "maxResults": 10,
      "enabled": true
    }
  }
}
```

You must also add a transport policy rule that routes `search` to `searxng`:

```json
{
  "transportPolicies": [
    {
      "tool": "search",
      "riskLevel": "low",
      "preferredTransport": "searxng",
      "isolationPolicy": {
        "level": "session",
        "forceRotateOnHighRisk": true,
        "forbidSessionReuse": false,
        "allowCrossToolReuse": true
      }
    }
  ]
}
```

### Config fields

| Field | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | `string` | `"http://127.0.0.1:8080"` | SearXNG instance base URL. Must be a loopback address (`127.0.0.1`, `localhost`, `::1`). |
| `timeoutMs` | `number` | `5000` | Request timeout in milliseconds. |
| `maxResults` | `number` | `10` | Maximum number of results returned. Results are trimmed server-side. |
| `enabled` | `boolean` | `false` | Must be `true` to activate the adapter. |

### Fail-closed rules

- `enabled: false` → denied, no network request.
- Invalid `baseUrl` (non-loopback) → config validation error, startup fails.
- `timeoutMs` must be a positive integer.
- `maxResults` must be a positive integer.

---

## Example `grl.config.json` (SearXNG enabled)

```json
{
  "version": 1,
  "compartments": [
    { "id": "research", "description": "Default research compartment", "enabled": true }
  ],
  "firewallPolicies": [
    {
      "agentId": "local-agent",
      "compartmentId": "research",
      "allowedTools": ["search"],
      "maxRiskLevel": "low"
    }
  ],
  "transportPolicies": [
    {
      "tool": "search",
      "riskLevel": "low",
      "preferredTransport": "searxng",
      "isolationPolicy": {
        "level": "session",
        "forceRotateOnHighRisk": true,
        "forbidSessionReuse": false,
        "allowCrossToolReuse": true
      }
    }
  ],
  "sandboxPolicies": [
    { "transportKind": "mock", "allowNetwork": false, "allowFilesystem": false, "allowProcessSpawn": false, "allowBrowser": false },
    { "transportKind": "searxng", "allowNetwork": true, "allowFilesystem": false, "allowProcessSpawn": false, "allowBrowser": false }
  ],
  "transports": {
    "searxng": {
      "baseUrl": "http://127.0.0.1:8080",
      "timeoutMs": 5000,
      "maxResults": 10,
      "enabled": true
    }
  }
}
```

---

## Sandbox Requirements

The SearXNG sandbox policy (`SEARXNG_SANDBOX_POLICY`) sets:

| Permission | Value |
|---|---|
| `allowNetwork` | `true` |
| `allowBrowser` | `false` |
| `allowFilesystem` | `false` |
| `allowProcessSpawn` | `false` |
| `allowEnvAccess` | `false` |

The declared adapter permission is `network_explicit_allowed` — a new permission
type that signals intentional, config-declared network access (distinct from the
`network_disabled` sentinel used by mock adapters).

---

## Network Security

- `baseUrl` must resolve to a loopback address (`127.0.0.1`, `localhost`, or `::1`).
  Any non-loopback URL is rejected at config-load time.
- Only `GET` requests to `{baseUrl}/search?...` are issued. No `POST`, no cookies,
  no custom secret headers, no manual redirect following.
- Parameters sent to SearXNG: `q`, `format=json`, `language`, `categories`,
  `time_range`, `safesearch`. Nothing else.
- No follow-up fetches of returned result URLs.
- No HTML scraping. No browser. No Tor. No proxy chains.
- Timeouts are enforced via `AbortController`; connections are aborted on timeout.
- Raw input is never stored or logged.

---

## MVP Limits

- SearXNG is the only real transport. Other transport kinds fail-closed.
- Only the `search` tool is supported. `fetch_html` and `fetch_json` are rejected.
- Results include `title`, `url`, `content`, `engine`, `score` as returned by
  SearXNG. No result enrichment, no crawling.
- Configuration is loaded from the runtime config file only; no dynamic discovery.
- Authentication to SearXNG is not supported.

---

## Curl Examples

### Default (mock) — no SearXNG config needed

```bash
curl -s -X POST http://127.0.0.1:8787/v1/capabilities/execute \
  -H 'Content-Type: application/json' \
  -d '{
    "agentId": "local-agent",
    "compartmentId": "research",
    "tool": "search",
    "riskLevel": "low",
    "input": "bitcoin privacy"
  }' | jq .
```

### SearXNG enabled (after starting SearXNG locally and enabling in config)

```bash
# Start GRL server pointing at your config
GRL_CONFIG_PATH=./examples/grl.config.json node dist/apps/grl-server/src/main.js

# Execute search via SearXNG
curl -s -X POST http://127.0.0.1:8787/v1/capabilities/execute \
  -H 'Content-Type: application/json' \
  -d '{
    "agentId": "local-agent",
    "compartmentId": "research",
    "tool": "search",
    "riskLevel": "low",
    "input": "bitcoin privacy"
  }' | jq .execution.output
```

### Expected response (SearXNG disabled)

```json
{
  "decision": "denied",
  "reason": "SearXNG transport disabled."
}
```

### Expected response (success)

```json
{
  "decision": "allowed",
  "execution": {
    "status": "success",
    "transportKind": "searxng",
    "output": {
      "query": "bitcoin privacy",
      "results": [
        {
          "title": "Bitcoin Privacy Guide",
          "url": "https://example.com/bitcoin-privacy",
          "content": "An overview of privacy techniques..."
        }
      ]
    }
  }
}
```

---

## Running a Local SearXNG Instance

```bash
# Using Docker
docker run --rm \
  -p 8080:8080 \
  -e SEARXNG_SECRET_KEY="$(openssl rand -hex 32)" \
  searxng/searxng:latest

# Verify it serves JSON search
curl 'http://127.0.0.1:8080/search?q=test&format=json' | jq .results[0].title
```

Then set `transports.searxng.baseUrl` to `http://127.0.0.1:8080` and `enabled` to
`true` in your runtime config.

---

## Non-Storage Guarantee

The SearXNG adapter never stores:

- Raw input strings
- Approval tokens
- Search result content beyond the structured response returned to the caller
- Cookies, session identifiers, or network secrets

All audit events emitted during execution contain only metadata (input type,
size in bytes), never the raw content.
