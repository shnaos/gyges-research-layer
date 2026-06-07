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
| behavioral_privacy | ❌ **GAP** | ✅ | execute-mock only; **no effect on real path** |
| persona_isolation | ❌ **GAP** | ✅ | execute-mock only; **no effect on real path** |
| temporal_obfuscation | ❌ **GAP** | ✅ | execute-mock only; delay is **advisory** (see below) |
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

`execute` runs the same spine **minus** behavioral_privacy, persona_isolation,
and temporal_obfuscation, and selects mock-or-SearXNG at execution.

## Two facts that change how the pipeline should be read

1. **Recommendations are not enforced timing.** `apps/grl-server/src/local-api.ts`
   contains **no `setTimeout`/sleep around execution**. Temporal-obfuscation
   delays, behavioral jitter, and the orchestrator's `requiresDelay`/`delayMs`
   are **surfaced to the caller as metadata** — the server never actually waits.
   Enforcing the delay is the agent/operator's responsibility.
   *(Scope: verified for the server; the mock adapter's internals were not
   inspected and do not need to be.)*

2. **The composite `runtimePolicy` decision is informational.** Each gate already
   enforces its own decision inline (deny/approval/rotation). The orchestrator
   aggregates and explains; it does not re-gate execution.

## KNOWN GAP (pinned by test)

`apps/grl-server/test/audit-reality.test.ts` contains an explicitly-named
`KNOWN GAP` test asserting behavioral/persona/temporal are absent from `execute`.
It exists to make any future change a conscious decision — it is **not** an
endorsement that the gap is correct. See `production-readiness.md`.
