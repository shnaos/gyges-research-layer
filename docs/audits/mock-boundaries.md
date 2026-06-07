# Mock Boundary Audit (Sprint 31)

Classifies every GRL subsystem by the **kind of effect** it actually has, so no
layer is mistaken for more than it is. Verified in code.

## Effect taxonomy

- **execution effect** — changes what is actually executed/returned.
- **network effect** — causes (or shapes) a real outbound request.
- **logical runtime effect** — changes in-memory runtime state / control flow
  (allow/deny/approval/rotation), deterministically, with no network.
- **metadata-only** — computes/records information surfaced to the caller or
  audit trail; does not by itself alter execution, timing, or the network.

## Classification

| Subsystem | Effect class | Notes |
|---|---|---|
| Capability Firewall | logical runtime | deny-by-default; allow/deny/confirm gates execution. Real. |
| Capability Graph | logical runtime | blocks/approves/forces rotation; records nodes/edges (grows per success). Real. |
| Trust / Reputation | logical runtime | quarantine→deny, restricted→approval. Real. |
| Adaptive Defense + Rate Limiter | logical runtime | cooldown/temp-block/approval/escalate. Real. |
| Privacy Boundary | logical runtime | block/approval/rotate across compartment pairs. Real. |
| Transport Policy | logical runtime | selects transport kind (mock/searxng); gates routing. Real. |
| Session Manager | logical runtime | create/rotate/expire session identity in-memory. Real (in-memory). |
| Sandbox (transport registry) | logical runtime | permission evaluation before execution. Real (when a verdict is produced). |
| Multi-Agent registry/quotas | logical runtime | allow/deny/approval/quota from agent state. Real (read-only quota in pipeline). |
| Execution Engine (mock) | execution | synthetic deterministic results; **no network**. |
| Execution Engine (SearXNG) | execution + network | real loopback HTTP; **off by default**. |
| Transport Fingerprint | logical runtime + (network when SearXNG on) | assigns headers in-memory; only reaches the wire if SearXNG executes. |
| Behavioral Privacy | logical runtime (Sprint 32) | now runs on **both** execute & execute-mock; real fragment rotation; critical risk → real session/fingerprint rotation. |
| Persona Isolation | logical runtime (Sprint 32) | now runs on **both**; real persona create/bind/recordSearch; drives real session & fingerprint rotation. |
| Temporal Obfuscation | logical runtime + real timing when enabled (Sprint 32) | computes deterministic delay; the server **really awaits** it when `executionDelayEnabled` (default off), bounded by `maxExecutionDelayMs`. Advisory when disabled. |
| **Network Isolation (Sprint 30)** | logical/metadata-only | logical relay/route abstraction. **No real Tor/proxy/VPN/SOCKS/DNS/egress.** Reduces *logical/runtime* correlation only; routes/DNS scopes are opaque metadata. |
| DNS Isolation Policy | metadata-only | intent model; **no real DNS resolver**. |
| Runtime Policy Orchestrator | metadata-only | composite decision is **informational**; per-gate decisions enforce. |
| Audit / Security Events | metadata-only | in-memory append-only trail (see runtime-coherence: unbounded). |
| Incident Detector / Heuristics | logical runtime (observational) | feeds adaptive defense; never blocks directly. |

## Things that are recommendations, not enforcement

- **`delayMs` / temporal cooldown / behavioral jitter** — Sprint 32: the primary
  pre-execution delay is now **really awaited** when `executionDelayEnabled`
  (default off). When disabled it is advisory. Cooldown/budget signals remain
  advisory (surfaced via runtimePolicy, not hard-enforced).
- **The orchestrator `runtimePolicy` block** — informational composite.
- **`networkIsolation` block + relay rotation** — logical metadata; changes no
  real *network* route. Sprint 32: a relay-route rotation now really drives
  **session + fingerprint rotation**, so the logical route is consumed by the
  execution path (not just surfaced).

## Stubs / placeholders / simulation

- The **mock execution engine** is an explicit simulation (synthetic results).
- **No other stub/placeholder** masquerades as real: the audit scripts
  (`audit:mocks`, `audit:coherence`) enforce that the SearXNG adapter is the only
  real `fetch` in core and that network-isolation contains no network primitive.

## Reconciliation with earlier sprint claims

Sprint 30 framed network isolation as reducing *network* correlation. **Corrected
here:** it is **metadata/logical only**, and because the transport is mock by
default, the reduction it provides today is **logical/runtime correlation only**
(stable per-compartment route ids, rotation signals, audit trail) — not any real
network-level unlinkability. `docs/network-isolation.md` carries a Sprint 31
reconciliation note to the same effect.
