# gyges-research-layer

Local-first capability firewall and identity compartmentalization gateway for AI agents performing private web research.

## Installation

```bash
git clone https://github.com/shnaos/gyges-research-layer.git
cd gyges-research-layer
npm install
npm --prefix apps/grl-cli install
npm run build
```

Requires Node.js 20 LTS or later. See [`docs/installation.md`](docs/installation.md) for the full guide.

## Quickstart

```bash
# Start the local API server
npm run dev:server

# In another terminal — check health
npm run cli -- health

# Run a search
npm run cli -- search "privacy"

# Run all validations
npm run smoke-test
```

See [`docs/quickstart.md`](docs/quickstart.md) for the 5-minute guide.

## Package Layout

```
packages/
  core/                  @gyges/core          — capability graph, firewall, trust, sessions, audit
  agent-sdk/             @gyges/agent-sdk      — agent client SDK
  policy-engine/         @gyges/policy-engine  — policy engine (legacy)
  identity-compartment/  @gyges/identity-compartment
  transport-router/      @gyges/transport-router
  search-adapter-searxng/ @gyges/search-adapter-searxng
apps/
  grl-server/            grl-server           — local API server (127.0.0.1:8787)
  grl-cli/               @gyges/grl-cli       — CLI operator interface
```

See [`docs/packaging.md`](docs/packaging.md) for the full packaging reference.

## SDK Usage

```ts
import { GrlAgentClient, isAllowed, isPending, isDenied } from '@gyges/agent-sdk';

const client = new GrlAgentClient(); // connects to http://127.0.0.1:8787

// Search
const result = await client.search('privacy research');
if (isAllowed(result)) console.log(result.results);
if (isPending(result)) console.log('Approval required:', result.approvalRequestId);
if (isDenied(result)) console.log('Denied:', result.reason);

// Health check
const health = await client.health();
console.log(health.status); // 'ok'

// Audit events
const events = await client.listAuditEvents({ limit: 10 });
```

See [`docs/agent-sdk.md`](docs/agent-sdk.md) for the full SDK reference.

## CLI Usage

```bash
# Start server first
npm run dev:server

# Health check
npm run cli -- health

# Search
npm run cli -- search "bitcoin privacy"

# Audit events
npm run cli -- audit --type execution_failed

# Trust profiles
npm run cli -- trust

# Runtime profile
npm run cli -- runtime profile

# Reload config from disk
npm run cli -- runtime reload

# JSON output
npm run cli -- health --json
```

See [`docs/cli.md`](docs/cli.md) for the full CLI reference.

## Behavioral Privacy

Sprint 24 adds a deterministic behavioral privacy layer that tracks only metadata:

- behavioral correlation risk per agent
- identity fragment rotation on elevated risk
- deterministic temporal jitter recommendations
- fail-closed blocking at critical correlation risk

Inspect it locally with `grl privacy profiles`, `grl privacy profile <agentId>`, and `grl privacy fragments [agentId]`.
See [`docs/behavioral-privacy.md`](docs/behavioral-privacy.md).

## Persona Isolation

Sprint 25 adds explicit per-category persona isolation to prevent a single agent from developing a unified behavioural profile across unrelated research domains:

- each research category (finance, crypto, health, politics, …) receives an isolated persona
- category changes trigger fragment and session rotation
- high-risk categories enforce transport isolation
- correlation risk is tracked and escalated per persona, not globally

Inspect it locally with `grl privacy personas [agentId]` and `grl privacy bindings [agentId]`.
See [`docs/persona-isolation.md`](docs/persona-isolation.md).

## Temporal Obfuscation & Query Scheduling (Sprint 26)

Sprint 26 adds a dedicated temporal obfuscation engine that reduces exploitable timing signatures produced by AI agents:

- **Cadence smoothing** — detects fixed inter-request rhythms and applies adaptive delays to break predictable patterns
- **Burst fragmentation** — detects rapid request spikes and enforces cooldown periods to reduce temporal density
- **Temporal privacy budget** — enforces per-agent request quotas within rolling time windows
- **Scheduling decisions** — unified computation layer that combines cadence, burst, and budget signals into delay recommendations

Inspect it locally with `grl privacy temporal [agentId]` and `grl privacy budgets [agentId]`.
See [`docs/temporal-obfuscation.md`](docs/temporal-obfuscation.md).

## Runtime Profiles

| Profile | Description |
|---------|-------------|
| `strict` | Maximum restrictions — highest isolation, approval-first |
| `balanced` | Default — balanced security and usability |
| `research` | Relaxed rate limits for research workflows |
| `development` | Low friction for local development |

```bash
GRL_PROFILE=strict npm run dev:server
GRL_PROFILE=research npm run dev:server
```

See [`docs/runtime-profiles.md`](docs/runtime-profiles.md) for details.

## Local Distribution

Install `@gyges/agent-sdk` in another local project:

```bash
npm install /path/to/gyges-research-layer/packages/agent-sdk
```

Or via `file:` reference in `package.json`:

```json
{
  "dependencies": {
    "@gyges/agent-sdk": "file:../gyges-research-layer/packages/agent-sdk"
  }
}
```

See [`docs/distribution.md`](docs/distribution.md) for the full distribution guide.

## Why this exists

AI agents doing web research can leak identity, intent, query correlation, and behavioral fingerprints. Gyges Research Layer (GRL) places a defensive layer between agent tools and the web.

## GRL is NOT

- a browser
- a crawler
- a proxy chain
- a Tor replacement
- an anonymous VPN
- a guarantee of anonymity or perfect OPSEC

GRL is a **privacy layer**, not an anonymity system. See [Security Model](#security-model) and [Non-Goals](#non-goals) below.

## Architecture

```text
Agent
↓
Capability Graph           (packages/core — transition rules, isolation)
↓
Trust / Adaptive Defense   (packages/core — trust scoring, rate limits, anomaly detection)
↓
Capability Firewall        (packages/core — deny-by-default decision)
↓
Approval Queue             (packages/core — human-in-the-loop, when required)
↓
Privacy Boundary           (packages/core — compartment isolation, anti-correlation)
↓
Session Manager            (packages/core — session lifecycle, rotation)
↓
Transport Policy           (packages/core — decides transport/isolation)
↓
Sandbox                    (packages/core — per-transport permission evaluation)
↓
Execution Engine           (packages/core — runs the chosen transport)
↓
Audit / Incidents          (packages/core — append-only audit trail, incident detection)
```

Server entry point: `apps/grl-server` exposes `POST /v1/capabilities/execute` and `POST /v1/capabilities/execute-mock`.

## Security Model

GRL enforces a **deny-by-default, fail-closed, local-first** security model:

- Every capability request is evaluated by a full policy pipeline before execution
- No implicit allows — every allowed capability requires an explicit firewall rule
- Transport is decided by policy, never by the agent
- Compartments are isolated — no shared sessions, cookies, or state between compartments
- Trust scores degrade on anomalous behavior and recover on clean execution
- The audit trail is append-only; every decision is logged
- Immutable runtime snapshots — config cannot be mutated at runtime

For the complete security documentation:

- [`docs/security/threat-model.md`](docs/security/threat-model.md) — assets, adversaries, threat matrix
- [`docs/security/trust-boundaries.md`](docs/security/trust-boundaries.md) — all trust boundaries with ASCII diagrams
- [`docs/security/security-assumptions.md`](docs/security/security-assumptions.md) — what GRL assumes about its environment
- [`docs/security/defensive-guarantees.md`](docs/security/defensive-guarantees.md) — formal security guarantees
- [`docs/security/failure-modes.md`](docs/security/failure-modes.md) — failure mode catalog with recovery strategies
- [`docs/security/attack-surfaces.md`](docs/security/attack-surfaces.md) — attack surface analysis
- [`docs/security/incident-response.md`](docs/security/incident-response.md) — incident lifecycle and operator actions
- [`docs/security/privacy-model.md`](docs/security/privacy-model.md) — privacy design and data minimization

## Threat Model

GRL's threat model (see [`docs/security/threat-model.md`](docs/security/threat-model.md)) addresses:

**Protected assets:** agent intent, runtime policies, compartment isolation, audit integrity, trust reputation, runtime configuration, operator visibility, transport isolation, session separation.

**Adversary classes:** malicious website, compromised search engine, prompt-injected agent, hostile runtime plugin, over-privileged transport, local malware, operator mistakes, configuration corruption.

## Privacy Model

GRL is **privacy-first** (see [`docs/security/privacy-model.md`](docs/security/privacy-model.md)):

- All processing is local — no cloud, no remote API, no telemetry
- Raw query content is never stored in the audit trail
- No cookies, no browser storage, no token persistence
- Compartment isolation prevents cross-task correlation
- In-memory state only — no durable storage of sessions or audit events

## Runtime Guarantees

From [`docs/security/defensive-guarantees.md`](docs/security/defensive-guarantees.md):

| Guarantee | Description |
|-----------|-------------|
| Fail-closed | Unknown/unevaluated requests are denied |
| Immutable snapshots | Config is deep-frozen and checksummed after load |
| Deterministic evaluation | Identical inputs always produce identical decisions |
| Sandbox gating | No execution without sandbox policy evaluation |
| Trust-based gating | Quarantined compartments are denied automatically |
| Audit completeness | Every decision at every layer is audit-logged |

## Non-Goals

**GRL DOES NOT:**

- guarantee endpoint anonymity
- replace Tor or any onion routing network
- replace browser sandboxing or OS-level process isolation
- prevent host or kernel compromise
- guarantee perfect OPSEC
- classify the semantic maliciousness of search results
- provide anti-forensics (GRL emits an audit trail by design)
- enforce network-level firewalling

## Security Principles

- **local-first** — no cloud dependency, all processing on-machine
- **deny-by-default** — no implicit capability
- **fail-closed** — errors produce deny, not allow
- **least privilege** — each transport has minimum declared permissions
- **explicit transports** — transport decided by policy, never by the agent
- **explicit permissions** — every capability requires an explicit allow rule
- **immutable runtime state** — config deep-frozen and checksummed after load
- **deterministic evaluation** — no randomness, no ML, no sampling
- **defensive layering** — multiple independent gates before execution

## CLI Quickstart (Sprint 18)

The GRL CLI provides a local operator interface to inspect and control the GRL runtime without a web UI.

```bash
# Start the local API server (in one terminal)
npm run dev:server

# In another terminal — check runtime health
npm run cli -- health

# Run a search through the GRL pipeline
npm run cli -- search "bitcoin privacy"

# List trust profiles
npm run cli -- trust

# Inspect audit events filtered by type
npm run cli -- audit --type execution_failed

# Reload runtime config from disk
npm run cli -- runtime reload
```

JSON output for scripting:

```bash
npm run cli -- trust --json
npm run cli -- search "bitcoin privacy" --json
```

See [`docs/cli.md`](docs/cli.md) for the full command reference, configuration, and error model.

## Quickstart

```bash
npm install
npm run typecheck
npm test
npm run start
```

Optional environment:

- `SEARXNG_URL` (default: `http://localhost:8080`)
- `PORT` (default: `3000`)
- `GRL_PROFILE` — runtime profile (`strict` | `balanced` | `research` | `development`, default: `balanced`)
- `GRL_CONFIG_PATH` — path to runtime config JSON file
- `GRL_CONFIG_WATCH=1` — enable hot-reload on config file changes

Launch with a named profile:

```bash
GRL_PROFILE=strict npm run dev:server
GRL_PROFILE=research npm run dev:server
```

Start the local search engine:

```bash
docker compose -f docker/docker-compose.yml up -d searxng
```

## Capability API

The primary execution endpoint is `POST /v1/capabilities/execute`. Every request is evaluated by the full policy pipeline (capability graph → trust/defense → firewall → privacy boundary → session → sandbox → execution → audit) and denied unless all gates pass.

```bash
curl -X POST http://127.0.0.1:8787/v1/capabilities/execute \
  -H 'Content-Type: application/json' \
  -d '{
    "agentId":"local-agent",
    "compartmentId":"research",
    "tool":"search",
    "riskLevel":"low",
    "input":"ring of gyges"
  }'
```

Run the example agent:

```bash
npm --prefix examples/local-agent run start
```

## Documentation

### Security

- [`docs/security/threat-model.md`](docs/security/threat-model.md)
- [`docs/security/trust-boundaries.md`](docs/security/trust-boundaries.md)
- [`docs/security/security-assumptions.md`](docs/security/security-assumptions.md)
- [`docs/security/defensive-guarantees.md`](docs/security/defensive-guarantees.md)
- [`docs/security/failure-modes.md`](docs/security/failure-modes.md)
- [`docs/security/attack-surfaces.md`](docs/security/attack-surfaces.md)
- [`docs/security/incident-response.md`](docs/security/incident-response.md)
- [`docs/security/privacy-model.md`](docs/security/privacy-model.md)

### Agent SDK (Sprint 21)

The `@gyges/agent-sdk` package provides a typed, privacy-first client for local AI agents:

```ts
import { GrlAgentClient, isAllowed, isPending } from '@gyges/agent-sdk';

const client = new GrlAgentClient();
const result = await client.search('bitcoin privacy');

if (isAllowed(result)) console.log(result.results);
if (isPending(result)) console.log('Approval required:', result.approvalRequestId);
```

See [`docs/agent-sdk.md`](docs/agent-sdk.md) for the full reference.

### Architecture

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/runtime-profiles.md`](docs/runtime-profiles.md)
- [`docs/runtime-config.md`](docs/runtime-config.md)
- [`docs/multi-agent-runtime.md`](docs/multi-agent-runtime.md)
- [`docs/agent-sdk.md`](docs/agent-sdk.md)
- [`docs/cli.md`](docs/cli.md)
- [`docs/searxng-transport.md`](docs/searxng-transport.md)
- [`docs/roadmap.md`](docs/roadmap.md)

### Multi-Agent Runtime Isolation (Sprint 23)

Multiple local AI agents can use GRL simultaneously with fully isolated runtime state:

```ts
import { GrlAgentClient } from '@gyges/agent-sdk';

const client = new GrlAgentClient();

// Inspect registered agent runtimes
const agents = await client.listAgents();

// Restrict or evict an agent
await client.restrictAgent('agent-a');
await client.evictAgent('rogue-agent');
```

```bash
# CLI
grl agents
grl agents local-agent
grl agents restrict local-agent
grl agents evict rogue-agent
```

See [`docs/multi-agent-runtime.md`](docs/multi-agent-runtime.md) for the full reference.

## License

MIT

## Transport Fingerprint Randomization & Header Isolation (Sprint 27)

Sprint 27 adds deterministic transport fingerprint rotation to reduce trivially stable request metadata:

- rotates `User-Agent` and `Accept-Language` profiles per agent
- varies safe transport headers and deterministic header ordering
- exposes metadata-only read APIs, SDK helpers, and CLI commands
- does **not** guarantee anonymity or prevent advanced fingerprinting

Inspect it locally with `grl privacy fingerprints [agentId]` and `grl privacy header-policies`.
See [`docs/transport-fingerprint.md`](docs/transport-fingerprint.md).

## Runtime Policy Orchestrator & Composite Privacy Policies (Sprint 28)

Sprint 28 adds the first **central runtime arbitration layer** in GRL. Each existing privacy and security gate now also emits a `PolicySignal`. The `RuntimePolicyOrchestrator` collects all signals, detects conflicts, resolves them deterministically, and produces a single `CompositeRuntimeDecision` — included in every `execute-mock` response as a `runtimePolicy` block.

Key properties:
- **Deterministic** — same inputs always produce the same decision.
- **Inspectable** — every signal and conflict is recorded and queryable.
- **fail-closed** — unknown critical signals produce `deny` by default.
- **No AI/ML** — pure static precedence table comparisons only.
- **No new transport** — the orchestrator is in-memory only.

Inspect it locally:

```bash
grl runtime policy                  # list registered policies
grl runtime policy signals          # list accumulated signals
grl runtime policy last-decision    # show last composite decision
```

See [`docs/runtime-policy-orchestrator.md`](docs/runtime-policy-orchestrator.md).

## Real Execute Orchestrator Integration & Signal Parity (Sprint 29)

Sprint 29 wires the Runtime Policy Orchestrator into the **real**
`POST /v1/capabilities/execute` endpoint, achieving full parity with
`execute-mock`:

- both endpoints collect gate signals through a shared per-request
  `PolicySignalCollector` and return a `runtimePolicy` block on **every** decision
  path (allowed, denied, pending) — even when a gate short-circuits before
  execution;
- for the same authorised request the **common signal sources** match across both
  endpoints; the only difference is the transport (mock vs SearXNG when enabled);
- the `multi_agent` source now emits real signals (registered / quota-exceeded /
  restricted / evicted);
- the orchestrator's signal inspection buffer is **bounded** (FIFO eviction,
  default 500) — memory can never grow without bound, and a
  `runtime_policy_signal_evicted` audit event records evictions;
- the signals endpoint, CLI, and SDK gain `source` / `action` / `severity` /
  `limit` filters (invalid values are rejected fail-closed with HTTP 400).

```bash
grl runtime policy signals --source multi_agent --severity high --limit 20
```

No new transport, browser, Tor/proxy, crawler, DB/Redis, or AI/ML is introduced —
the only real transport remains SearXNG. See
[`docs/runtime-policy-orchestrator.md`](docs/runtime-policy-orchestrator.md#sprint-29--execute-parity-bounded-buffer-and-filters).
