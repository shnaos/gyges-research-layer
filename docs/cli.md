# GRL CLI — Local Operator Interface

The GRL CLI is a local, privacy-first operator interface for the Gyges Research Layer runtime. It connects to the local GRL API server (default: `http://127.0.0.1:8787`) and exposes all runtime inspection and control operations via a minimal, deterministic command-line interface.

**Philosophy:**
- Local-first — connects only to `127.0.0.1`
- Privacy-first — never logs tokens, raw inputs, secrets, or full headers
- Fail-closed — any timeout or error surfaces immediately; no retries
- Deterministic — no spinners, no colour, no analytics, no auto-update

---

## Installation

The CLI is part of the GRL monorepo under `apps/grl-cli`.

```bash
# From the monorepo root
npm install
npm --prefix apps/grl-cli run build
```

The compiled binary is at `apps/grl-cli/dist/cli.js`.

---

## Running via npm

During development, run commands without building:

```bash
npm run cli -- health
npm run cli -- search "bitcoin privacy"
npm run cli -- trust
npm run cli -- audit --type execution_failed
npm run cli -- runtime reload
```

(The `cli` script in the root `package.json` delegates to `tsx apps/grl-cli/src/cli.ts`.)

---

## Commands

### `grl health`

Show GRL runtime status and config checksum.

```bash
grl health
```

Output:
```
status            ok
service           grl-server
config_version    1
config_checksum   a1b2c3...
```

---

### `grl search "<query>"`

Execute a search through the GRL runtime capability pipeline.

```bash
grl search "bitcoin privacy"
```

Calls `POST /v1/capabilities/execute` with compartment `research` and tool `web_search`.

Output:
```
decision             allowed
reason               capability_allowed
trust_level          neutral
trust_score          68
transport            mock
execution_status     success
execution_transport  mock
result_count         5
```

---

### `grl audit`

List security audit events.

```bash
grl audit
grl audit --type execution_failed
grl audit --severity warning
grl audit --limit 20
```

Options:
- `--type <type>` — filter by security event type (e.g. `execution_failed`, `capability_denied`)
- `--severity <severity>` — filter by severity: `debug`, `info`, `warning`, `critical`
- `--limit <n>` — maximum number of events to return

Output:
```
TIMESTAMP                  TYPE                  SEVERITY   MESSAGE
---------                  ----                  --------   -------
2024-01-01T00:00:00.000Z   execution_succeeded   info       Search executed
```

---

### `grl trust [compartmentId]`

List all trust profiles, or inspect a single compartment.

```bash
grl trust
grl trust research
```

Output (list):
```
COMPARTMENT   SCORE   LEVEL     UPDATED_AT
-----------   -----   -----     ----------
research      68      neutral   2024-01-01T00:00:00.000Z
```

Output (single):
```
compartment   research
score         68
level         neutral
updatedAt     2024-01-01T00:00:00.000Z
```

---

### `grl privacy profiles`

List all behavioral privacy profiles.

```bash
grl privacy profiles
```

### `grl privacy profile <agentId>`

Show one agent's behavioral privacy metadata.

```bash
grl privacy profile local-agent
```

### `grl privacy fragments [agentId]`

List identity fragments for all agents or a single agent.

```bash
grl privacy fragments
grl privacy fragments local-agent
```

---

### `grl privacy personas [agentId]`

List search personas for all agents or a single agent (Sprint 25).

```bash
grl privacy personas
grl privacy personas local-agent
```

---

### `grl privacy bindings [agentId]`

List persona-fragment bindings for all agents or a single agent (Sprint 25).

```bash
grl privacy bindings
grl privacy bindings local-agent
```

---

### `grl privacy temporal [agentId]`

List temporal obfuscation profiles for all agents or a single agent (Sprint 26).

```bash
grl privacy temporal
grl privacy temporal local-agent
```

---

### `grl privacy budgets [agentId]`

List temporal privacy budgets for all agents or a single agent (Sprint 26).

```bash
grl privacy budgets
grl privacy budgets local-agent
```

---

### `grl incidents`

List runtime security incidents.

```bash
grl incidents
```

Output:
```
ID       SEVERITY   STATUS   CREATED_AT                 SUMMARY
--       --------   ------   ----------                 -------
inc-1    warning    open     2024-01-01T00:00:00.000Z   Repeated denied capabilities
```

---

### `grl runtime version`

Show the active runtime config version.

```bash
grl runtime version
```

Output:
```
version   1
```

---

### `grl runtime reload`

Reload the runtime configuration from disk (requires `GRL_CONFIG_PATH` on the server).

```bash
grl runtime reload
```

Output:
```
version     2
checksum    a1b2c3...
loaded_at   2024-01-01T00:00:00.000Z
```

---

### `grl runtime profiles`

List all available runtime profiles.

```bash
grl runtime profiles
```

Output:
```
name        strict
enabled     true
packs       strict-defense-pack, strict-sandbox-pack, privacy-hardening-pack, trust-hardening-pack
description Aggressive deny-by-default. ...

name        balanced
enabled     true
packs       balanced-default-pack
description Default recommended profile. ...
```

---

### `grl runtime profile`

Show the currently active runtime profile.

```bash
grl runtime profile
```

Output:
```
name     balanced
enabled  true
packs    balanced-default-pack
```

---

### `grl runtime profile <name>`

Switch the runtime to a named profile (local only, no cloud, no restart required).

```bash
grl runtime profile strict
grl runtime profile balanced
grl runtime profile research
grl runtime profile development
```

Output on success:
```
switched_to  strict
packs        strict-defense-pack, strict-sandbox-pack, privacy-hardening-pack, trust-hardening-pack
switched_at  2024-01-01T00:00:00.000Z
```

---

### `grl runtime packs`

List all registered policy packs.

```bash
grl runtime packs
```

Output:
```
id      balanced-default-pack
fields  firewallPolicies, transportPolicies, rateLimitPolicies, ...

id      strict-defense-pack
fields  firewallPolicies, rateLimitPolicies, adaptiveDefensePolicies
```

---

### `grl transports`

List registered transport manifests.

```bash
grl transports
```

Output:
```
KIND   NAME          VERSION   NETWORK   BROWSER   PERMISSIONS
----   ----          -------   -------   -------   -----------
mock   Mock Adapter  1.0.0     no        no        execute_mock
```

---

## Output Formats

### Table (default)

Human-readable, aligned ASCII columns. No colour, no ANSI escape codes.

### JSON

Machine-readable, indented JSON. Enable with `--json`:

```bash
grl trust --json
grl audit --json
grl search "query" --json
```

---

## Configuration

Configuration is resolved in this order (highest precedence first):

1. **CLI flags** — `--base-url`, `--timeout`, `--json`
2. **Environment variables** — `GRL_CLI_BASE_URL`, `GRL_CLI_TIMEOUT_MS`, `GRL_CLI_OUTPUT`
3. **Local config file** — `.grl-cli.json` in the current working directory
4. **Defaults**

### Defaults

```json
{
  "baseUrl": "http://127.0.0.1:8787",
  "timeoutMs": 5000,
  "output": "table"
}
```

### Local config file (`.grl-cli.json`)

Create a `.grl-cli.json` in your project root:

```json
{
  "baseUrl": "http://127.0.0.1:8787",
  "timeoutMs": 10000,
  "output": "table"
}
```

### Environment variables

| Variable              | Description                            | Example                        |
|-----------------------|----------------------------------------|--------------------------------|
| `GRL_CLI_BASE_URL`    | GRL server base URL                    | `http://127.0.0.1:8787`        |
| `GRL_CLI_TIMEOUT_MS`  | Request timeout in milliseconds        | `10000`                        |
| `GRL_CLI_OUTPUT`      | Output format: `table` or `json`       | `json`                         |

---

## Examples

```bash
# Check if the runtime is reachable
grl health

# Run a search
grl search "bitcoin privacy"

# Get machine-readable search output
grl search "bitcoin privacy" --json

# Inspect recent audit events
grl audit --limit 50

# Filter audit events by type
grl audit --type execution_failed

# List trust profiles
grl trust

# Inspect a specific compartment's trust
grl trust research

# List runtime security incidents
grl incidents

# Check runtime version
grl runtime version

# Reload config after editing grl.config.json
grl runtime reload

# List transport manifests
grl transports

# Use a non-default server URL
grl --base-url http://127.0.0.1:9999 health

# Set output to JSON globally via env
GRL_CLI_OUTPUT=json grl trust
```

---

## Agent Management (Sprint 23)

Inspect and control multi-agent runtimes.

```bash
# List all registered agent runtimes
grl agents

# Show a single agent's runtime state
grl agents local-agent

# List active leases for an agent
grl agents leases local-agent

# List leases across all agents
grl agents leases

# Restrict an agent (blocks execution)
grl agents restrict local-agent

# Evict an agent (permanent, clears all counters)
grl agents evict local-agent

# JSON output
grl --output json agents
grl --output json agents local-agent
```

See [`docs/multi-agent-runtime.md`](./multi-agent-runtime.md) for the full isolation model.

---

## Security & Privacy

- **No tokens, secrets, or raw inputs are ever logged** to stdout, stderr, or files.
- Audit output contains only normalised metadata (event types, severities, timestamps) — never raw request payloads.
- The search command sends a query to the runtime but never echoes it back in CLI output.
- The CLI does not store any state, cache, or session information.
- No telemetry. No analytics. No cloud connectivity.
- The `--base-url` must resolve to a local address; the GRL server enforces `127.0.0.1` binding.

---

## Error Model

| Code                  | Exit code | Cause                                              |
|-----------------------|-----------|----------------------------------------------------|
| `invalid_arguments`   | 1         | Bad CLI arguments (e.g. empty query)               |
| `runtime_unreachable` | 2         | Could not connect to the GRL server                |
| `request_timeout`     | 3         | Request exceeded the configured timeout            |
| `invalid_response`    | 4         | Server returned non-JSON or unexpected shape       |
| `command_failed`      | 5         | Server returned a non-200 status code              |

Errors are printed to stderr in the format:

```
error [code]: human-readable message
```

No raw stack traces are printed by default.

---

## MVP Limits

- The CLI only connects to a **locally running** GRL server.
- The `grl search` command uses a fixed compartment (`research`) and tool (`web_search`). Per-request compartment/tool selection is not yet exposed.
- `grl runtime reload` requires the server to have been started with `GRL_CONFIG_PATH` pointing to a valid config file; otherwise it returns a 404.
- No interactive mode, no shell completion, no paging.
- No auth, no TLS — local loopback only by design.

---

### `grl privacy fingerprints [agentId]`

List transport fingerprint profiles for all agents or a single agent (Sprint 27).

```bash
grl privacy fingerprints
grl privacy fingerprints local-agent
```

---

### `grl privacy header-policies`

Show the active transport header-isolation policy (Sprint 27).

```bash
grl privacy header-policies
```

See [`docs/transport-fingerprint.md`](./transport-fingerprint.md) for details.
