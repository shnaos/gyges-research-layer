# Runtime Coherence Audit (Sprint 31)

Covers isolation keying, in-memory state/memory risks, and config/profile reality.

## 1. Isolation keying is MIXED (important)

GRL's per-entity state is not uniformly keyed. Verified by inspecting each
engine's `getOrCreate*` / store key:

| Engine | Keyed on | Consequence |
|---|---|---|
| Trust / Reputation | `compartmentId` | shared across agents in the same compartment |
| Session Manager | `compartmentId` | shared across agents in the same compartment |
| Privacy Boundary | `(sourceCompartmentId, targetCompartmentId)` | compartment-scoped |
| Capability Graph (paths) | `compartmentId` | compartment-scoped |
| Network Isolation (routes/bindings) | `compartmentId` | compartment-scoped |
| Behavioral Privacy | `agentId` | shared across compartments for the same agent |
| Persona Isolation | `agentId` | shared across compartments for the same agent |
| Temporal Obfuscation | `agentId` | shared across compartments for the same agent |
| Transport Fingerprint | `agentId` | shared across compartments for the same agent |
| Multi-Agent registry | `agentId` (+ compartment list) | agent-scoped |

**Implication — there is no single isolation boundary:**
- Two **different agents sharing one compartment** share trust, sessions, privacy
  boundary, capability-graph path, and relay route — but have **separate**
  behavioral/persona/temporal/fingerprint state.
- One **agent across two compartments** shares behavioral/persona/temporal/
  fingerprint state — but has **separate** trust/session/route/graph state.

This is a **logical** isolation model, internally consistent per engine but **not
uniform** across the system. It is **not** a hard security boundary (no process,
namespace, or OS isolation). Multi-agent isolation should be described as
"per-key logical separation," not "strong isolation."

## 2. Memory / state audit

All state is in-memory (no DB/Redis/persistence). Process restart clears
everything. Stores classified:

### Bounded / self-managing
| Store | Bounding |
|---|---|
| `RuntimePolicyOrchestrator._signals` | `maxSignals` (default 500), FIFO eviction (Sprint 29) |
| `PolicySignalCollector._signals` | per-request, `maxCollectedSignals` cap, discarded after the request |
| `NetworkIsolationEngine._routes` | `maxRoutes` (default 500), FIFO eviction of inactive routes (Sprint 30) |
| Rate-limiter per-bucket window array | pruned to `windowMs` on each evaluation |

### Unbounded by entity count / no TTL deletion (growth risks)
| Store | Risk |
|---|---|
| **Audit store `events[]`** (`audit/store.ts`) | **No cap, no TTL** — every security event retained for process life; query only slices at read-time. ~10–15 events per execute. **Largest growth risk.** |
| **Capability Graph `nodes` / `edges`** | **Unbounded** — `nodes.set`/`edges.set` are never deleted/pruned; ~2 nodes + 1 edge are added per successful execute (`recordCapabilityRequest`+`addNode`+`addEdge`), plus nodes/edges from transitions (including a minimal node + `blocked` edge on blocked ones). Grows with traffic. |
| Capability Graph `paths` (per compartment) | **Bounded** in effect: a path stops advancing once its length reaches `maxPathLength` (further transitions are blocked and do not advance the path). The `nodes`/`edges` stores above are the real growth, not `paths`. |
| Session Manager `sessions`/`byCompartment` | TTL **lazy-expiry transitions state but does not delete** records → grows by (compartments × rotations). |
| Approval Queue `entries` | TTL transitions to `expired`; entries retained (same pattern as sessions). |
| Trust `profiles`/`recoveryHistory`, Behavioral `topicCounts`/`temporalBuckets`/`behaviorScores`, Temporal `budgets`/windows, Fingerprint `profiles`, Persona `personas`, Multi-agent `runtimes`/`leases` | one entry per distinct `agentId`/`compartmentId`; **no count bound, no TTL**. Bounded in practice only by the number of distinct agents/compartments seen. |

**Net:** safe for local/single-operator/bounded-agent use; **not safe for an
unbounded-lifetime, many-distinct-agent deployment** without periodic restart or
added eviction. The audit trail and capability graph are the first to watch.

*(This sprint documents these; it does not patch them — bounding the audit store
would break audit-history tests and is out of audit scope.)*

## 3. Config / profile coherence

- `DEFAULT_RUNTIME_CONFIG` (`runtime-config/bootstrap.ts`) is the in-memory
  fallback: one `research` compartment, firewall rules for `local-agent`,
  bootstrap transport/privacy/defense/rate-limit policies, trust thresholds.
  **No SearXNG** → mock by default.
- Config is **deep-frozen + checksummed** after load (immutable snapshot); reload
  replaces the snapshot atomically. Reload + validation are covered by
  `runtime-config-api.test.ts`.
- Runtime profiles (`strict`/`balanced`/`research`/`development`) and policy packs
  are resolved deterministically (`runtime-profiles/resolver.ts`,
  `ReadonlyMap`s); covered by `runtime-profiles-api.test.ts`.
- **Fail-safe:** invalid/partial config is rejected by the validator (fail-closed)
  rather than partially applied; the previous immutable snapshot stays in effect.
- **Drift note:** profile differences are real (rate limits, isolation posture);
  the precise per-profile deltas live in `docs/runtime-profiles.md` and were not
  re-derived field-by-field in this audit.
