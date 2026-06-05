# Transport Capability Registry & Adapter Sandbox (Sprint 10)

Sprint 10 introduces the **Transport Capability Registry** and the first
**Adapter Sandbox** model for the Gyges Research Layer. Together they declare
what a transport adapter is *allowed* to do, audit its permission surface, and
refuse any adapter that is unregistered, runs an unsupported tool, or violates a
sandbox policy — while shipping **no real network behaviour**.

> **Scope note (Sprint 10).** This layer performs **no real network I/O**. There
> is no `fetch`, no DNS resolution, no socket, no Tor, no proxy, no SearXNG, no
> browser automation, no database, no Redis, and **no dynamic plugin loading or
> manifest file reads**. The registry is purely in-memory. The only transport
> described is the `mock` transport from Sprint 6. This sprint prepares the
> permission contract for future real adapters
> (`direct`/`tor`/`proxy`/`searxng`/`browser`) without implementing any of them.

## Where the registry sits

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
 Transport Capability Registry  (@gyges/core — manifest + sandbox decision)  ◀── Sprint 10
        │
        ▼
   Execution Engine             (@gyges/core — sandbox gate, then run)
        │
        ▼
   Mock Transport ONLY          (@gyges/core — deterministic, no network)
```

## Role of the `TransportCapabilityRegistry`

The registry is a deterministic, in-memory store of transport **manifests**. It:

- registers a manifest per `TransportKind` (no silent overwrite — a duplicate
  throws `TransportRegistryError`),
- returns manifests/audits as **deep copies** so callers can never mutate
  internal state,
- audits the declared capability surface of every transport, and
- evaluates the **adapter sandbox**: given a `kind`, a `tool`, and an
  `AdapterSandboxPolicy`, it returns a `SandboxDecision` (`allow` / `block`).

It never loads a plugin, reads a manifest from disk, touches a database, runs an
adapter, or performs any real network / browser / filesystem / process work.

## Role of the `TransportManifest`

A manifest is **pure metadata** describing a single adapter — it carries no
secrets, credentials, endpoints, or real transport configuration:

| Field                 | Meaning                                             |
| --------------------- | --------------------------------------------------- |
| `kind`                | the `TransportKind` it describes (e.g. `mock`)      |
| `name` / `version`    | informational labels                                |
| `supportedTools`      | tools the adapter declares it can execute           |
| `declaredPermissions` | sandbox permissions the adapter asserts             |
| `networkAccess`       | whether it requires real network access             |
| `browserAccess`       | whether it requires browser access                  |
| `filesystemAccess`    | whether it requires filesystem access               |
| `processSpawnAccess`  | whether it requires spawning a child process        |
| `envAccess`           | whether it requires environment variable access     |

`AdapterSandboxPermission` is one of `execute_mock`, `network_disabled`,
`no_filesystem`, `no_process_spawn`, `no_env_access`.

## Role of the `AdapterSandboxPolicy`

A policy is the host-side allow-list a manifest must comply with:

| Field                | Meaning                                              |
| -------------------- | ---------------------------------------------------- |
| `allowedPermissions` | permissions the host grants; any declared permission outside this set blocks |
| `allowNetwork`       | tolerate an adapter that requires network access     |
| `allowBrowser`       | tolerate an adapter that requires browser access     |
| `allowFilesystem`    | tolerate an adapter that requires filesystem access  |
| `allowProcessSpawn`  | tolerate an adapter that requires process spawning   |
| `allowEnvAccess`     | tolerate an adapter that requires environment access |

## Sandbox lifecycle

`evaluateSandbox(kind, tool, policy)` is deterministic and fail-closed. It runs
the following checks, in order:

1. transport **not registered** → `block` / `transport_not_registered`
2. tool **not in** `supportedTools` → `block` / `tool_not_supported`
3. a `declaredPermission` **outside** `allowedPermissions` → `block` /
   `permission_not_allowed` (one violation per offending permission)
4. `networkAccess` && !`allowNetwork` → `block` / `network_not_allowed`
5. `browserAccess` && !`allowBrowser` → `block` / `browser_not_allowed`
6. `filesystemAccess` && !`allowFilesystem` → `block` / `filesystem_not_allowed`
7. `processSpawnAccess` && !`allowProcessSpawn` → `block` /
   `process_spawn_not_allowed`
8. `envAccess` && !`allowEnvAccess` → `block` / `env_access_not_allowed`
9. otherwise → `allow` (empty `violations`)

Steps 1 and 2 short-circuit (without a manifest or a supported tool the rest
cannot be assessed). Steps 3–8 are all collected, so a single `block` decision
can surface every applicable violation. Neither the manifest nor the policy is
mutated.

### Integration with the Execution Engine

When the `ExecutionEngine` is wired with a registry **and** a sandbox policy, it
runs the sandbox gate **before** selecting or invoking any adapter:

- `block` → `ExecutionResult.status = "blocked"`, `error = "Sandbox blocked
  transport execution."`, and the `SandboxDecision` is attached as
  `result.sandbox`. **The adapter is never called.**
- `allow` → the adapter runs as before, and the allow `SandboxDecision` is
  attached to the result.

The gate is fully injectable: an engine constructed **without** a registry keeps
its previous behaviour and attaches no `sandbox` field, so existing callers and
tests are unaffected. The engine still performs **no** network, filesystem, or
plugin work.

## Registry vs routing vs execution

These three layers have strictly separate concerns:

- **Transport Policy Engine (routing, Sprint 8)** — decides *which* transport to
  use, *whether* to rotate the session, and *how strongly* to isolate. It never
  inspects an adapter's permission surface.
- **Transport Capability Registry (this sprint)** — decides *whether the chosen
  transport is even allowed to run* the tool under a sandbox policy. It never
  picks a transport and never mints a session.
- **Execution Engine** — enforces the sandbox decision, then runs the adapter.
  It never re-evaluates policy or routing.

## Bootstrap mock manifest

The server bootstraps a single manifest for the mock transport:

```jsonc
{
  "kind": "mock",
  "name": "Mock Transport Adapter",
  "version": "0.1.0",
  "supportedTools": ["search", "fetch_html", "fetch_json"],
  "declaredPermissions": [
    "execute_mock", "network_disabled", "no_filesystem",
    "no_process_spawn", "no_env_access"
  ],
  "networkAccess": false,
  "browserAccess": false,
  "filesystemAccess": false,
  "processSpawnAccess": false,
  "envAccess": false
}
```

and a strict default sandbox policy that the manifest fully satisfies:

```jsonc
{
  "allowedPermissions": [
    "execute_mock", "network_disabled", "no_filesystem",
    "no_process_spawn", "no_env_access"
  ],
  "allowNetwork": false,
  "allowBrowser": false,
  "allowFilesystem": false,
  "allowProcessSpawn": false,
  "allowEnvAccess": false
}
```

## Local endpoints

Two read-only endpoints expose the registry. Both return **only** metadata — no
secrets, keys, or tokens.

### `GET /v1/transports`

```bash
curl -s http://127.0.0.1:8787/v1/transports
```

```jsonc
{
  "transports": [
    {
      "kind": "mock",
      "name": "Mock Transport Adapter",
      "version": "0.1.0",
      "supportedTools": ["search", "fetch_html", "fetch_json"],
      "declaredPermissions": ["execute_mock", "network_disabled", "no_filesystem", "no_process_spawn", "no_env_access"],
      "networkAccess": false,
      "browserAccess": false,
      "filesystemAccess": false,
      "processSpawnAccess": false,
      "envAccess": false
    }
  ]
}
```

### `GET /v1/transports/audit`

```bash
curl -s http://127.0.0.1:8787/v1/transports/audit
```

```jsonc
{
  "audit": [
    {
      "kind": "mock",
      "supportedTools": ["search", "fetch_html", "fetch_json"],
      "declaredPermissions": ["execute_mock", "network_disabled", "no_filesystem", "no_process_spawn", "no_env_access"],
      "networkAccess": false,
      "browserAccess": false,
      "filesystemAccess": false,
      "processSpawnAccess": false,
      "envAccess": false
    }
  ]
}
```

Any non-`GET` method on either route returns `405` with a consistent error
envelope.

### `POST /v1/capabilities/execute-mock`

When the firewall allows a capability without confirmation, the response now
carries the sandbox decision alongside the routing and privacy-boundary
metadata. A compliant request:

```bash
curl -s -X POST http://127.0.0.1:8787/v1/capabilities/execute-mock \
  -H 'content-type: application/json' \
  -d '{"agentId":"local-agent","compartmentId":"research","tool":"search","riskLevel":"low","input":"bitcoin privacy research"}'
```

```jsonc
{
  "decision": "allowed",
  "reason": "...",
  "routing": { "...": "..." },
  "privacyBoundary": { "...": "..." },
  "execution": { "status": "success", "transportKind": "mock", "output": { "mock": true } },
  "sandbox": { "action": "allow", "violations": [] }
}
```

If the sandbox blocks the run, the firewall decision stays `allowed` but the
execution is `blocked` and the adapter is never invoked:

```jsonc
{
  "decision": "allowed",
  "execution": {
    "status": "blocked",
    "error": "Sandbox blocked transport execution."
  },
  "sandbox": {
    "action": "block",
    "violations": [{ "code": "network_not_allowed", "reason": "..." }]
  }
}
```

## No real network

This sprint adds **no** real transport. There is no fetch, DNS, socket, Tor,
proxy, SearXNG, browser, database, Redis, websocket/SSE, auth/JWT, cloud
telemetry, dynamic plugin loading, or filesystem manifest reads. The registry is
in-memory only, and the execution path still runs through the deterministic mock
transport exclusively.

## Why this prepares future adapters

Real transports (Tor, SearXNG, an outbound proxy, a headless browser) each carry
a very different permission surface: a browser needs `browserAccess`, a SOCKS
proxy needs `networkAccess`, a local SearXNG bridge might need `processSpawn` or
`env` access. By formalising the **manifest** and **sandbox policy** now, GRL can
audit and gate each future adapter against an explicit allow-list — refusing any
adapter that over-reaches — long before any real egress code is written.
