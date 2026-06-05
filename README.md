# gyges-research-layer

Local-first capability firewall and identity compartmentalization gateway for AI agents performing private web research.

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
- [`docs/agent-sdk.md`](docs/agent-sdk.md)
- [`docs/cli.md`](docs/cli.md)
- [`docs/searxng-transport.md`](docs/searxng-transport.md)
- [`docs/roadmap.md`](docs/roadmap.md)

## License

MIT

