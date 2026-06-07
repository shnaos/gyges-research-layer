# Pipeline Mapping Audit (Sprint 31)

Verified by reading `apps/grl-server/src/local-api.ts` (the active 127.0.0.1:8787
runtime) on the Sprint 31 branch. Facts only — no marketing.

## The two execution endpoints

| Endpoint | Handler lines | Transport | Purpose |
|---|---|---|---|
| `POST /v1/capabilities/execute-mock` | ~2805–4288 | always mock | deterministic simulation of the full privacy pipeline |
| `POST /v1/capabilities/execute` | ~4309–5048 | mock by default, SearXNG when explicitly enabled+routed | the "real" path |

There is also `POST /v1/capabilities/evaluate` (firewall-only, no execution) and
`POST /v1/capabilities/request` (legacy request shape) — neither runs the gate
pipeline or the orchestrator.

## Which gates actually run, per endpoint

Derived from the policy-signal sources each handler emits (engine helpers
`evaluateMultiAgentGate` / `evaluateNetworkIsolationGate` are invoked by **both**
handlers; behavioral/persona/temporal engines are referenced **15× in
execute-mock, 0× in execute**).

| Gate / signal source | execute | execute-mock | Runtime effect |
|---|---|---|---|
| capability_graph | ✅ | ✅ | real (blocks/approves/forces rotation; **records nodes/edges per request — unbounded, see runtime-coherence.md**) |
| multi_agent | ✅ | ✅ | real (deny/approval/quota from registry state) |
| trust_reputation | ✅ | ✅ | real (quarantine→deny, restricted→approval) |
| behavioral_privacy | ✅ (Sprint 32) | ✅ | **real** on both — correlation eval + fragment rotation (in-memory) |
| persona_isolation | ✅ (Sprint 32) | ✅ | **real** on both — persona create/bind + recordSearch; drives session/fingerprint rotation |
| temporal_obfuscation | ✅ (Sprint 32) | ✅ | **real** on both — and the computed delay is now actually awaited when `executionDelayEnabled` (default off) |
| adaptive_defense (+ rate_limit) | ✅ | ✅ | real (cooldown/temp-block/approval/escalate) |
| capability_firewall | ✅ | ✅ | real (deny-by-default allow/deny/confirm) |
| network_isolation | ✅ | ✅ | logical/metadata (route assign/rotate; fail-closed) — **no real packet effect** |
| transport_policy | ✅ | ✅ | real routing decision (selects mock vs searxng) |
| transport_fingerprint | ✅ | ✅ | real in-memory header assignment; **network effect only when SearXNG is enabled** |
| sandbox | ⚠ conditional | ⚠ conditional | emitted only when the engine returns a sandbox verdict (the mock transport does not on the allowed path) |
| session lifecycle | ✅ | ✅ | real in-memory session create/rotate |
| execution | ✅ mock or SearXNG | ✅ mock | real (mock = synthetic results; SearXNG = real loopback HTTP) |
| audit / incidents | ✅ | ✅ | real in-memory audit trail + incident detection |
| runtime orchestrator | ✅ | ✅ | composite decision is **informational** (surfaced in `runtimePolicy`); enforcement is per-gate |

### Documented gate ordering (execute-mock, the fullest pipeline)

```
capability_graph → multi_agent → trust → behavioral_privacy → persona_isolation
→ temporal_obfuscation → transport_fingerprint → defense(rate+adaptive)
→ capability_firewall → network_isolation → transport_policy(routing)
→ privacy_boundary → session → execution(mock) → sandbox(if any) → audit → orchestrator
```

**Sprint 32 update:** `execute` now runs the **same** behavioral_privacy /
persona_isolation / temporal_obfuscation gates as execute-mock (via the shared
`runPrivacyPipeline` helper), with real engine mutations. The gate SETS and
SIGNALS have converged; the only intended difference is the transport
(mock vs SearXNG) and a minor residual gate-ordering difference (execute computes
network-isolation before transport-fingerprint, so it links route→fingerprint;
execute-mock computes fingerprint before network). See `runtime-convergence.md`.

## Two facts that change how the pipeline should be read

1. **Delays are now REALLY enforced when enabled (Sprint 32).** The server now
   `await`s a bounded `applyExecutionDelay(delayMs)` before execution. The delay
   duration is deterministic (from the temporal/behavioral gates); the wait is a
   real, event-loop-friendly `setTimeout`, capped by `maxExecutionDelayMs`
   (default 2000). It is **OFF by default** (`executionDelayEnabled=false`) so
   tests/CI stay fast; enabling it is a privacy knob, not a security gate. When
   off, delays remain advisory metadata as before.

2. **The composite `runtimePolicy` decision is informational.** Each gate already
   enforces its own decision inline (deny/approval/rotation). The orchestrator
   aggregates and explains; it does not re-gate execution.

## KNOWN GAP — CLOSED in Sprint 32

The Sprint 31 gap (behavioral/persona/temporal absent from `execute`) is now
**closed**. `apps/grl-server/test/audit-reality.test.ts` asserts the inverse —
those three sources are **present on both** endpoints (the `CONVERGED` test). See
`runtime-convergence.md` for what was ported and what remains metadata-only.
