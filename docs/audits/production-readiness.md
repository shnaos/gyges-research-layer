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
| Behavioral Privacy | **research-only** | runs only on execute-mock; **no effect on real `execute`** |
| Persona Isolation | **research-only** | runs only on execute-mock |
| Temporal Obfuscation | **metadata-only** | recommendations only; server never sleeps |
| Network Isolation (relays/routes) | **metadata-only** | logical abstraction; no real network effect |
| DNS Isolation | **metadata-only** | intent model; no resolver |
| Audit trail | **demo-ready** | real + complete, but **unbounded store** |
| CLI | **local-prod-ready** | broad command coverage, `--json`, fail-closed errors |
| SDK | **local-prod-ready** | typed client, tri-state results, fail-closed |

## Security claim audit (docs vs code)

| Claim area | Verdict |
|---|---|
| "GRL is NOT anonymity / Tor / VPN / anti-forensics" | **Consistent** — README, privacy-model, threat-model, network-isolation all negate these; validator enforces phrasing. |
| "local-first, no telemetry, no cloud" | **Consistent** — no network primitive outside the SearXNG adapter + local SDK/CLI clients. |
| "deny-by-default / fail-closed" | **Consistent** — firewall, transport, network-isolation, config validation all fail-closed. |
| Sprint 30 "reduces network correlation" | **Was overclaimed** — it is logical/metadata-only with mock-by-default transport. **Corrected** in `mock-boundaries.md` + a reconciliation note in `docs/network-isolation.md`. |
| Behavioral/persona/temporal as active privacy layers | **Risk of overread** — they are real engines but **do not run on the real `execute` path**. Now documented as a KNOWN GAP and pinned by test. |
| Temporal/jitter "applied" | **Risk of overread** — delays are advisory; the server does not enforce timing. Documented. |

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

1. Bound/evict the audit store and capability graph (or add TTL/restart guidance).
2. Decide intentionally whether behavioral/persona/temporal should run on `execute`
   (close or formally accept the gap).
3. Unify (or explicitly document per-engine) the isolation key.
4. Optionally enforce advisory delays, or rename them to make "advisory" explicit
   in the API.
