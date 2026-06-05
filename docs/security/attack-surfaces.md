# GRL Attack Surfaces

> **Sprint 19 — Attack Surface Documentation**

This document catalogs every interface through which an adversary could attempt to influence or compromise the Gyges Research Layer runtime.

---

## 1. HTTP API (`127.0.0.1:8787`)

**Description:** The primary interface through which agents and the CLI interact with GRL.

**Exposure:** Loopback-only. Only local processes on the host can reach this surface.

**Endpoints:**

| Endpoint | Method | Risk |
|----------|--------|------|
| `/v1/health` | GET | Low — returns runtime metadata only |
| `/v1/capabilities/execute` | POST | Medium — input evaluated by full pipeline |
| `/v1/capabilities/execute-mock` | POST | Medium — same as above (mock transport) |
| `/v1/capabilities/evaluate` | POST | Medium — evaluates without executing |
| `/v1/audit/events` | GET | Low — read-only metadata |
| `/v1/audit/events/:id` | GET | Low — read-only |
| `/v1/trust/profiles` | GET | Low — read-only metadata |
| `/v1/trust/events` | GET | Low — read-only |
| `/v1/security/incidents` | GET/POST | Low/Medium — read + close |
| `/v1/security/anomalies` | GET | Low — read-only |
| `/v1/approvals` | GET/POST | Medium — approval decisions affect execution |
| `/v1/runtime/config` | GET | Low — metadata only |
| `/v1/runtime/reload` | POST | Medium — triggers config reload |
| `/v1/transports` | GET | Low — read-only |
| `/v1/transports/audit` | GET | Low — read-only |

**Controls:**
- Loopback binding enforced at startup
- Method enforcement (405 on wrong verb)
- Body size limit (`GRL_MAX_BODY_BYTES`)
- JSON-only request parsing
- All inputs validated and typed before reaching policy engines
- No authentication — assumed local-only trust model

**Residual risk:** Any local process can call any endpoint. OS-level process isolation is assumed.

---

## 2. Runtime Config Loader

**Description:** The path that reads, validates, and instantiates the active runtime configuration from a local JSON file.

**Exposure:** Filesystem read. Attacker must be able to write to `grl.config.json`.

**Attack vectors:**
- Corrupt `grl.config.json` to weaken firewall rules (e.g., allow all tools for all agents)
- Replace `grl.config.json` with a minimally valid config that removes all deny rules
- Cause a reload loop by repeatedly corrupting and restoring the file

**Controls:**
- Schema validation is fail-closed — invalid configs are rejected entirely
- Hot-reload failure retains previous snapshot
- Config checksum enables out-of-band integrity verification
- Config file path is set by operator (`GRL_CONFIG_PATH`) or uses in-memory defaults

**Residual risk:** A local attacker with filesystem write access can inject arbitrary valid policies.

---

## 3. Local Filesystem

**Description:** The local filesystem path from which GRL reads configuration.

**Exposure:** Read-only (GRL does not write to the filesystem).

**Attack vectors:**
- Overwrite `grl.config.json` with a policy that allows the attacker's agent
- Symlink attack: point `GRL_CONFIG_PATH` to an attacker-controlled file
- Race condition: write a valid config, trigger reload, then corrupt it

**Controls:**
- GRL reads the config file at load/reload time only — it does not poll
- Deep-frozen snapshot prevents runtime mutation after load
- Fail-safe reload retains old snapshot on any error

**What GRL does NOT write to disk:**
- Sessions
- Trust scores
- Audit events
- Raw query inputs
- Search results
- Tokens or secrets

---

## 4. Transport Adapters

**Description:** The transport adapter layer that executes a capability (network request, mock result).

**Exposure:** Internal — agents cannot choose or configure transport adapters directly.

**Attack vectors:**
- Over-privileged transport that performs network calls beyond the configured scope
- Transport that reads or writes the filesystem
- Transport that spawns subprocesses

**Controls:**
- Sandbox policy evaluated before execution (`evaluateSandbox()`)
- `allowBrowser=false`, `allowFilesystem=false`, `allowProcessSpawn=false` for all transports
- SearXNG: `baseUrl` must be loopback — enforced at config validation
- Mock: no network I/O whatsoever
- Transport kind decided by policy, never by the agent

**Residual risk:** A developer who modifies the transport adapter source can bypass these declared constraints. This is a code-level control.

---

## 5. CLI

**Description:** The `grl` CLI operator interface (`apps/grl-cli`).

**Exposure:** Local subprocess. Connects only to `127.0.0.1:8787`.

**Attack vectors:**
- Operator runs CLI with `--base-url` pointing to a non-local address (not enforced by CLI)
- CLI output is piped to scripts that act on it without validation
- CLI config file (`.grl-cli.json`) is tampered with to redirect requests

**Controls:**
- CLI does not store tokens, sessions, or secrets
- CLI output contains metadata only (no raw inputs)
- CLI never logs to files
- `--base-url` can be set to any URL by the operator — the GRL server enforces loopback binding

**Residual risk:** The CLI is a dumb HTTP client. Its security posture depends on the server's controls.

---

## 6. SearXNG Integration

**Description:** The HTTP GET interface to a local SearXNG instance.

**Exposure:** Loopback HTTP GET. `baseUrl` must be loopback — enforced at config validation.

**Attack vectors:**
- SearXNG returns malicious JSON that causes parsing errors (handled fail-safely)
- SearXNG embeds prompt-injection in result titles/snippets (GRL cannot prevent this — it returns structured results as-is)
- SearXNG instance is publicly exposed (GRL cannot enforce OS-level firewall)
- Timing correlation: query timing against SearXNG could be observed by a local attacker

**Controls:**
- `baseUrl` loopback enforcement at config load time
- Only `GET /search?...` is issued — no POST, no mutation
- Parameters: `q`, `format=json`, `language`, `categories`, `time_range`, `safesearch` only
- No cookies, no custom headers, no redirect following
- Timeout enforced via `AbortController`
- Results: `title`, `url`, `content`, `engine`, `score` only — no HTML scraping

**Residual risk:** GRL cannot inspect or sanitize the semantic content of search results. Prompt injection in result content is an agent-level risk.

---

## 7. Audit Pipeline

**Description:** The in-memory append-only audit trail and security event engine.

**Exposure:** Internal — no external write access to the audit store.

**Attack vectors:**
- Flood the audit store with events to exhaust memory (via repeated requests)
- Read audit events to map the policy surface (via `GET /v1/audit/events`)

**Controls:**
- Audit store is in-memory append-only — no delete, no update
- Events contain metadata only (no raw inputs, no tokens)
- No external write interface to the audit store
- Config audit events emitted directly to the store (not via heuristics) to prevent feedback loops

**Residual risk:** A local process with read access to the HTTP API can enumerate audit events and learn the policy structure. This is a local-trust-model design decision.

---

## 8. Runtime Reload (`POST /v1/runtime/reload`)

**Description:** The endpoint that triggers re-reading and applying the config file.

**Exposure:** Local HTTP POST (no body accepted).

**Attack vectors:**
- Trigger rapid reloads to cause a reload-fail loop and degrade the current config
- Race condition between a config file write and a reload trigger
- Trigger reload after corrupting the config file to force fail-safe (retain old, possibly weaker config)

**Controls:**
- Reload is fail-safe — error retains previous snapshot
- Reload emits audit events for every outcome
- Reload operates on the already-configured `GRL_CONFIG_PATH` only — no path injection
- No body accepted; path cannot be changed via HTTP

---

## 9. Mock Transport Abuse

**Description:** The mock transport adapter used in testing and as a fallback.

**Exposure:** Internal — activated via transport policy, not directly by the agent.

**Attack vectors:**
- Force the runtime into mock transport mode to bypass network controls
- Use mock transport to generate large volumes of fake audit events

**Controls:**
- Mock transport produces no real network I/O
- Transport is selected by policy, not by the agent
- Mock manifest declares `network_disabled` permission
- Sandbox policy: `allowNetwork=false` for mock

**Residual risk:** Minimal — mock transport has no real network capability.

---

## 10. Capability Graph Abuse

**Description:** The in-memory capability transition graph that tracks tool-to-tool transitions.

**Exposure:** Internal — graph state is updated by the execution pipeline.

**Attack vectors:**
- Gradually build up a transition path that exceeds `maxPathLength` (handled — path is bounded)
- Alternate between tools to avoid high-risk path detection
- Submit requests that trigger `force_rotation` repeatedly to exhaust session state

**Controls:**
- Path length bounded by `maxPathLength` — exceeding it is blocked
- High-risk path blocking: `blockOnHighRiskPath=true` in isolation policy
- Cross-tool escalation blocked: `forbidCrossToolEscalation=true`
- Every graph decision is audit-logged
- Rate limiter constrains request volume

**Residual risk:** Graph state is in-memory and not persisted. A server restart resets the graph (which may allow a fresh path that was previously blocked).
