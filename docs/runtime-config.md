# Runtime Configuration Loader & Policy Runtime

Sprint 16 introduces GRL's first **dynamic local configuration system**. Until
now GRL booted from **hard-coded bootstrap constants** compiled into the core
package — compartments, firewall rules, transport/privacy/trust/graph policies,
rate limits and sandbox surfaces were all static. To change any of them you had
to edit the source and rebuild.

This layer lets the local server build its entire policy surface from a single
**local JSON file** described by `GRL_CONFIG_PATH`, validate it strictly,
freeze it into an **immutable snapshot**, and optionally **hot-reload** it from
disk — all without touching the code.

Like every other GRL layer it performs **no** networking, fetch, DNS, socket,
browser, websocket/SSE, database, Redis, durable persistence, authentication,
telemetry, or AI/ML work. It reads a single local JSON file from the filesystem
and **never** stores tokens, secrets, or raw caller input — only minimal,
deterministic metadata. GRL remains fully agnostic: there is no coupling to any
external product.

```
Filesystem (local JSON)
  ↓
RuntimeConfigLoader            ← Sprint 16
  ↓
RuntimeConfigValidator (fail-closed)
  ↓
Immutable RuntimeConfig snapshot (frozen, checksummed)
  ↓
GRL policy engines (firewall, routing, privacy, trust, graph,
                    adaptive defense, rate limiting, sandbox)
  ↓
execute-mock pipeline
```

## Role of the `RuntimeConfigLoader`

`RuntimeConfigLoader` (in `packages/core/src/runtime-config/`) is the single
entry point for turning a local JSON file into a validated, immutable
configuration snapshot. It is **local-only** and **JSON-only**: it accepts a
filesystem path, never a URL, and performs no fetch, DNS, socket, or remote
work of any kind.

Public surface:

| Method | Description |
| --- | --- |
| `loadFromFile(path)` | Read + parse + validate a JSON file, build a new immutable snapshot, remember the path, emit `config_loaded`. Throws `RuntimeConfigValidationError` on bad JSON/schema. |
| `reload()` | Re-read the remembered path. **Fail-safe**: on error it keeps the previous snapshot, emits `config_reload_failed`, and rethrows. On success it emits `config_reloaded`. |
| `getSnapshot()` | Return the currently active snapshot (or `undefined` before any load). |
| `getPath()` | Return the remembered file path (or `undefined`). |
| `validate(config)` | Validate an unknown value against the schema and return a typed `RuntimeConfig`. |
| `clear()` | Drop the active snapshot, path, and watcher. |
| `watch()` / `stopWatching()` | Optional local hot reload via `fs.watch` only (see below). |
| `addEventListener(fn)` / `removeEventListener(fn)` | Subscribe to lifecycle events (`config_loaded`, `config_reloaded`, `config_reload_failed`, `config_validation_failed`). |

## `RuntimeConfig` structure

```ts
interface RuntimeConfig {
  version: number;                              // > 0
  compartments: RuntimeCompartment[];           // unique ids
  firewallPolicies: CapabilityPolicy[];
  transportPolicies: TransportPolicyRule[];
  privacyBoundaryRules: PrivacyBoundaryRule[];
  adaptiveDefensePolicies: AdaptiveDefensePolicy[];
  rateLimitPolicies: RateLimitPolicy[];
  trustPolicies: RuntimeTrustPolicy;
  graphTransitionRules: CapabilityTransitionRule[];
  isolationPolicies: DependencyIsolationPolicy[];
  sandboxPolicies: RuntimeSandboxPolicy[];
}
```

```ts
interface RuntimeCompartment { id: string; description?: string; enabled: boolean; }

interface RuntimeTrustPolicy {
  enabled: boolean;
  baselineScore: number;        // 0..100
  quarantinedThreshold: number; // 0 <= q < r < baseline <= 100
  restrictedThreshold: number;
}

interface RuntimeSandboxPolicy {
  transportKind: TransportKind; // 'mock' (the only supported transport)
  allowNetwork: boolean;
  allowFilesystem: boolean;
  allowProcessSpawn: boolean;
  allowBrowser: boolean;
}
```

The remaining policy slices reuse the exact types defined by their owning
Sprint 8–15 modules (`CapabilityPolicy`, `TransportPolicyRule`,
`PrivacyBoundaryRule`, `AdaptiveDefensePolicy`, `RateLimitPolicy`,
`CapabilityTransitionRule`, `DependencyIsolationPolicy`), so a config file
describes the same policies the engines already understand.

## Snapshots

```ts
interface RuntimeConfigSnapshot {
  version: number;
  loadedAt: number;   // epoch ms
  checksum: string;   // sha256 of canonical JSON
  config: RuntimeConfig;
}
```

A snapshot is:

- **immutable** — the config object graph is deep-frozen (`Object.freeze`),
- **defensively cloned** — the loader deep-clones the validated config before
  freezing, so the caller's input object can never mutate the live snapshot,
- **deterministic** — the `checksum` is a SHA-256 over a canonical
  (key-sorted) JSON serialization, so identical configs always produce
  identical checksums regardless of key order.

## Validation (fail-closed)

`validateRuntimeConfig` rejects anything that is not a well-formed config and
throws `RuntimeConfigValidationError` carrying a machine-readable `reason`:

| reason | raised when |
| --- | --- |
| `invalid_json` | the file is not parseable JSON |
| `invalid_schema` | a required field is missing or mistyped, or an array is not defensive |
| `invalid_version` | `version` is not a number `> 0` |
| `duplicate_compartment` | two compartments share an `id` |
| `duplicate_policy` | two policies (firewall/transport/privacy/defense/rate/graph/isolation/sandbox) collide on their identifying key |
| `invalid_threshold` | trust thresholds violate `0 <= quarantined < restricted < baseline <= 100`, or a score is out of range |
| `invalid_enum` | a risk level, action, scope, isolation level or transport kind is not a known enum value |

Validation is **fail-closed**: a config is used only if it passes every check.
Empty/`undefined`/non-array policy collections are rejected rather than silently
defaulted.

## Hot reload (local MVP)

Hot reload is **optional** and **local-only**. `watch()` uses `fs.watch` on the
remembered path — there is no websocket, SSE, polling daemon, or remote push.

On a filesystem change the loader:

1. re-reads and re-validates the file,
2. on success builds a **new** immutable snapshot, replaces the active one, and
   emits `config_reloaded`,
3. on failure keeps the **previous** snapshot and emits `config_reload_failed`.

The server subscribes to these events: a successful (re)load rebuilds the
config-derived policy engines (firewall, routing, privacy, rate limiter,
adaptive defense, capability graph) in place; stateful components (sessions,
approvals, audit, trust) are intentionally preserved across a reload.

The server enables the watcher only when `GRL_CONFIG_WATCH=1` is set.

## Fallback bootstrap

`DEFAULT_RUNTIME_CONFIG` (in `runtime-config/bootstrap.ts`) is the in-memory
fallback used when **no** `GRL_CONFIG_PATH` is provided. It mirrors the legacy
Sprint 3–15 bootstrap constants exactly, so the server behaves identically
whether it boots from this fallback or from a file describing the same policies.

When `GRL_CONFIG_PATH` **is** set but the file is missing or invalid, the server
**fails closed** (refuses to start) rather than silently using defaults.

## Runtime endpoints

All runtime config endpoints return **metadata only** — never a token, secret,
credential, or raw request input.

| Method & path | Description | Codes |
| --- | --- | --- |
| `GET /v1/runtime/config` | Active snapshot: `version`, `loadedAt`, `checksum`, `config` | 200, 405 |
| `GET /v1/runtime/config/checksum` | `{ checksum }` | 200, 405 |
| `GET /v1/runtime/config/version` | `{ version }` | 200, 405 |
| `POST /v1/runtime/reload` | Re-read the current file, replace the active snapshot, return new metadata | 200, 400 invalid config, 404 missing config, 405 |

`POST /v1/runtime/reload` is local-only and operates solely on the already
configured file path; it accepts no body describing a new source.

### Example config

A directly usable example lives at [`examples/grl.config.json`](../examples/grl.config.json).
It describes one `research` compartment, the firewall policies, transport/
routing policies, privacy boundary, adaptive defense and rate-limit policies, a
trust policy, graph transition + isolation rules, and the fully-sandboxed `mock`
transport. Launch the server against it with:

```bash
GRL_CONFIG_PATH=./examples/grl.config.json npm run dev:server
```

### `curl` examples

```bash
# Active config (metadata + policy data, no secrets)
curl -s http://127.0.0.1:8787/v1/runtime/config

# Just the checksum / version
curl -s http://127.0.0.1:8787/v1/runtime/config/checksum
curl -s http://127.0.0.1:8787/v1/runtime/config/version

# Reload the current file from disk (local-only)
curl -s -X POST http://127.0.0.1:8787/v1/runtime/reload
```

## Audit events

The loader's lifecycle is mirrored into the existing audit trail via four new
`SecurityEventType`s, emitted with **minimal metadata** (version, checksum, or
failure reason) and **never** the file's raw contents:

- `config_loaded` — initial load (file-backed or DEFAULT fallback)
- `config_reloaded` — successful reload
- `config_reload_failed` — reload error (previous snapshot retained)
- `config_validation_failed` — validation failure

Config audit events are emitted straight to the audit store (not through the
heuristics `observeSecurity` path) so they can never form a
config → audit → config loop.

## No real network / local-only limits

- **No** networking, fetch, DNS, sockets, browser, websocket/SSE, or proxy/Tor.
- **No** database, Redis, cloud sync, or durable persistence — snapshots are
  in-memory and rebuilt from the local file on every reload.
- **No** authentication, telemetry, or AI/ML.
- **JSON only**, **filesystem only** — never a URL or remote YAML.
- **Never** stores tokens, secrets, or raw caller input — only deterministic
  policy metadata.

## Relationship to Runtime Profiles (Sprint 20)

Sprint 20 introduces a **profile layer** on top of the `RuntimeConfig` system.
`RuntimeProfileResolver` takes the active `RuntimeConfig` snapshot as its
starting point, applies policy packs in order, applies profile overrides, and
produces a frozen `ResolvedRuntimeProfile`. The profile layer never bypasses
the config validation performed by `RuntimeConfigLoader`.

See [`docs/runtime-profiles.md`](runtime-profiles.md) for details.
