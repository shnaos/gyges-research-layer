# Production Readiness Audit (Sprint 31)

An honest, severe assessment of what GRL is today. No component is upgraded
artificially. Companion docs: `pipeline-mapping.md`, `transport-reality.md`,
`mock-boundaries.md`, `runtime-coherence.md`.

## Readiness vocabulary

- **local-prod-ready** — safe and correct for a single-operator, local-first
  deployment with a bounded set of agents and periodic restarts.
- **demo-ready** — works and is inspectable, but mock/advisory by default.
- **research-only** — sound mechanism, not exercised end-to-end in a real path.
- **metadata-only** — produces information, not enforcement/effect.
- **experimental** — present, minimal coverage of real-world behaviour.

## Readiness matrix

| System | Verdict | Why |
|---|---|---|
| Capability Firewall | **local-prod-ready** | deny-by-default, deterministic, well-tested, real gating |
| Trust / Reputation | **local-prod-ready** | real gating; compartment-keyed |
| Adaptive Defense + Rate Limiter | **local-prod-ready** | real gating; window-pruned |
| Privacy Boundary | **local-prod-ready** | real cross-compartment gating |
| Transport Policy | **local-prod-ready** | real routing decision |
| Sandbox / Transport Registry | **local-prod-ready** | real permission evaluation before execution |
| Session Manager | **local-prod-ready** (memory caveat) | real in-memory lifecycle; expired records not deleted |
| Capability Graph | **demo-ready** | real gating, but **`nodes`/`edges` grow unbounded** per request (paths are bounded by `maxPathLength`); restart needed |
| Multi-Agent isolation | **demo-ready** | logical per-key separation, **mixed keying**, not a hard boundary |
| Runtime Config / Profiles / Packs | **local-prod-ready** | immutable snapshot, validated, reloadable, fail-closed |
| Runtime Policy Orchestrator | **local-prod-ready (as advisory)** | deterministic, bounded buffer; composite decision is informational |
| SearXNG transport | **local-prod-ready when configured** | real loopback HTTP, fail-closed; **off by default** |
| Mock execution | **demo-ready** | explicit simulation |
| Transport Fingerprint | **demo-ready** | real header assignment; only hits wire when SearXNG on |
| Behavioral Privacy | **demo-ready** (Sprint 32) | now runs on **both** execute & execute-mock; real fragment rotation; critical risk → real session/fingerprint rotation |
| Persona Isolation | **demo-ready** (Sprint 32) | now runs on **both**; real persona create/bind; drives real session & fingerprint rotation |
| Temporal Obfuscation | **demo-ready** (Sprint 32) | runs on **both**; computed delay is **really awaited** when `executionDelayEnabled` (default off); advisory otherwise |
| Network Isolation (relays/routes) | **metadata-only** | logical abstraction; **no real network effect** — BUT a route rotation now really drives session + fingerprint rotation (Sprint 32) |
| DNS Isolation | **metadata-only** | intent model; no resolver |
| Audit trail | **local-prod-ready** (Sprint 32) | real + complete, now **bounded** (FIFO, default 50k) |
| CLI | **local-prod-ready** | broad command coverage, `--json`, fail-closed errors |
| SDK | **local-prod-ready** | typed client, tri-state results, fail-closed |

## Security claim audit (docs vs code)

| Claim area | Verdict |
|---|---|
| "GRL is NOT anonymity / Tor / VPN / anti-forensics" | **Consistent** — README, privacy-model, threat-model, network-isolation all negate these; validator enforces phrasing. |
| "local-first, no telemetry, no cloud" | **Consistent** — no network primitive outside the SearXNG adapter + local SDK/CLI clients. |
| "deny-by-default / fail-closed" | **Consistent** — firewall, transport, network-isolation, config validation all fail-closed. |
| Sprint 30 "reduces network correlation" | **Was overclaimed** — it is logical/metadata-only with mock-by-default transport. **Corrected** in `mock-boundaries.md` + a reconciliation note in `docs/network-isolation.md`. |
| Behavioral/persona/temporal as active privacy layers | **Resolved (Sprint 32)** — they now run on the real `execute` path with real engine mutations (the Sprint 31 gap is closed). |
| Temporal/jitter "applied" | **Resolved (Sprint 32)** — the delay is now really awaited when `executionDelayEnabled`; advisory only when disabled (the default). No longer advisory-only as a capability. |

No dangerous "anonymity system" claim was found in the docs. The two real
inconsistencies (network-correlation framing; advisory-vs-enforced) are reconciled
by this audit.

## CLI / SDK reality

- **CLI** (`apps/grl-cli`): commands for health, search, audit, trust, runtime
  (incl. `policy signals` filters), agents, transports, network, privacy. `--json`
  everywhere; errors surface as `CliError` (fail-closed). 
- **SDK** (`@gyges/agent-sdk`): typed client; tri-state results
  (`isAllowed`/`isPending`/`isDenied`); network/runtime methods; fail-closed on
  non-2xx.
- **Test caveat (honest):** CLI and SDK are verified against an **in-process or
  mocked HTTP server**, not a live end-to-end run against `dev:server` with a real
  SearXNG. The spec's "test CLI/SDK against local runtime" is therefore **partially
  met** (mock-transport level), **not** a live network E2E.

## Overall verdict

GRL is a **local-first, privacy-oriented, deny-by-default research gateway** that
is **local-prod-ready for the enforcement gates** (firewall, trust, defense,
privacy boundary, transport policy, sandbox, session, config) and **demo /
metadata-only for the privacy-correlation layers** (behavioral, persona, temporal,
network/DNS isolation) — several of which **do not run on the real `execute`
path** and **none of which enforce timing**. The real transport (SearXNG) is
genuine but **disabled by default**.

It is **not** production-ready as a multi-tenant, long-running, many-agent service
(unbounded audit/graph growth, mixed/logical isolation, in-memory-only state). It
**is** suitable for local, single-operator, bounded-lifetime research use.

## Top remediation candidates (future sprints — NOT done here)

1. ~~Bound/evict the audit store~~ **DONE (Sprint 32)** — audit store is now
   bounded (FIFO, 50k). Capability-graph node/edge GC still deferred (paths
   bounded by `maxPathLength`).
2. ~~Decide whether behavioral/persona/temporal run on `execute`~~ **DONE
   (Sprint 32)** — ported to `execute` via the shared privacy pipeline.
3. Unify (or explicitly document per-engine) the isolation key. *(still open)*
4. ~~Enforce advisory delays~~ **DONE (Sprint 32)** — real bounded delay,
   opt-in via `executionDelayEnabled`.
