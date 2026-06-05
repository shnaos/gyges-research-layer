# GRL Defensive Guarantees

> **Sprint 19 — Defensive Guarantees**

This document formally states the security guarantees that GRL provides by design.
Each guarantee is a property that holds deterministically, without requiring operator action, as long as the [security assumptions](./security-assumptions.md) are satisfied.

---

## 1. Fail-Closed Behavior

**Guarantee:** GRL denies any request that cannot be fully evaluated. There is no implicit allow, no silent fallback, and no degraded mode.

| Scenario | GRL response |
|----------|-------------|
| No matching firewall rule | `403 denied` |
| Unknown compartment | `403 denied` |
| Invalid request body | `400 bad_request` |
| Config load failure (`GRL_CONFIG_PATH` set, file missing) | Server refuses to start |
| Config reload failure | Previous snapshot retained; `config_reload_failed` emitted |
| Transport adapter not registered | Execution denied |
| Sandbox policy mismatch | `execution_sandbox_denied` |
| Capability graph blocks transition | `403 denied` |
| Trust engine quarantines compartment | `403 denied` |
| Privacy boundary blocks cross-compartment access | `403 denied` |
| Rate limit exceeded | Request denied or risk escalated |

**Implementation:** Every policy engine returns an explicit typed decision. The execution pipeline requires all gates to produce `allow` before proceeding. Missing decisions default to deny.

---

## 2. Immutable Runtime Snapshots

**Guarantee:** The active runtime configuration is a deep-frozen, checksummed snapshot. It cannot be mutated at runtime — only atomically replaced by a validated reload.

- The snapshot object graph is `Object.freeze()`-applied recursively after load.
- The checksum is SHA-256 over canonical (key-sorted) JSON — identical configs always produce identical checksums regardless of key insertion order.
- Reload replaces the entire snapshot atomically. Partial updates are not possible.
- Stateful components (sessions, trust, audit, approvals) are preserved across reload.

**Verification:** `GET /v1/runtime/config/checksum` returns the current checksum. Operators can verify config integrity out-of-band.

---

## 3. Deterministic Policy Evaluation

**Guarantee:** Identical inputs always produce identical policy decisions. There is no non-determinism, no random sampling, no probabilistic allow, and no AI/ML classification.

This applies to:
- Capability Firewall (`CapabilityFirewall.evaluate()`)
- Transport Policy Engine (`TransportPolicyEngine.resolve()`)
- Privacy Boundary Engine (`PrivacyBoundaryEngine.evaluate()`)
- Capability Graph (`CapabilityGraphEngine.evaluatePath()`)
- Trust Engine (`CompartmentTrustEngine.getOrCreateProfile()`)
- Adaptive Defense (`AdaptiveDefenseEngine.evaluate()`)
- Rate Limiter (`CapabilityRateLimiter.evaluate()`)
- Sandbox evaluator (`TransportCapabilityRegistry.evaluateSandbox()`)

**Implication:** GRL can be replayed, audited, and reasoned about deterministically. Security decisions are not opaque.

---

## 4. Sandbox Gating

**Guarantee:** No execution runs without a successful sandbox policy evaluation. If the declared transport permissions do not match the configured sandbox policy, execution is denied.

```text
Sandbox evaluation → deny  →  execution_sandbox_denied (no execution)
Sandbox evaluation → allow →  Execution Engine proceeds
```

- `allowBrowser=false` for all configured transports — no browser automation
- `allowFilesystem=false` — no filesystem access from transport adapters
- `allowProcessSpawn=false` — no subprocess spawning from transport adapters
- `allowNetwork` is `true` only for `searxng` (loopback-only) and `false` for `mock`

---

## 5. Trust-Based Gating

**Guarantee:** Compartments with degraded trust are automatically restricted or quarantined. Quarantined compartments are denied execution without operator intervention.

| Trust level | Score range | Behavior |
|-------------|-------------|----------|
| `trusted` | 80–100 | Full execution allowed |
| `neutral` | 50–79 | Execution allowed |
| `restricted` | 20–49 | Execution requires approval |
| `quarantined` | 0–19 | Execution denied |

- Trust scores decay over time (configurable decay policy)
- Incident events reduce trust scores (incident-weighted scoring)
- Recovery is possible through clean execution history (configurable recovery policy)

---

## 6. Capability Graph Restrictions

**Guarantee:** Capability transitions that violate the declared graph rules are blocked before any transport or trust evaluation. The graph is evaluated first in the execution pipeline.

Enforced constraints:
- Transitions between tools follow declared `CapabilityTransitionRule`s
- High-risk paths are blocked when `blockOnHighRiskPath=true`
- Cross-tool escalation is blocked when `forbidCrossToolEscalation=true`
- Path length is bounded by `maxPathLength`
- Unknown tools are blocked (fail-closed)

Possible outcomes:
- `allow` → proceed to trust gate
- `require_approval` → enqueue for human approval, no execution
- `force_rotation` → force session rotation before execution
- `block` → deny immediately

---

## 7. Adaptive Defense Guarantees

**Guarantee:** Anomalous request patterns automatically escalate risk levels and can trigger temporary blocks, preventing sustained policy abuse.

- Rate limits enforced with sliding windows per policy and scope
- Temporary blocks applied automatically on threshold crossing
- Risk level escalation applied in-place before firewall evaluation
- `AdaptiveDefenseEngine` maps runtime incidents to defense actions
- Adaptive defense triggers are audit-logged as `adaptive_defense_triggered`

**Note:** Adaptive defense complements, but does not replace, static firewall rules.

---

## 8. Approval Queue Guarantees

**Guarantee:** Requests that require human approval are enqueued and never executed until explicitly approved by the operator. Unapproved requests expire automatically.

- Approval tokens are single-use and opaque
- Expired approvals are rejected on use
- Approval decisions (`approved`, `rejected`) are audit-logged
- The agent cannot approve its own requests
- Pending requests do not execute — they block until approved or expired

---

## 9. Audit Guarantees

**Guarantee:** Every policy decision at every layer produces an audit event. The audit trail is append-only and cannot be modified by the agent or transport layer.

Guaranteed audit events:
- Every firewall decision (`capability_allowed`, `capability_denied`)
- Every routing decision (`session_created`, `session_rotated`, `session_reused`)
- Every privacy boundary decision
- Every sandbox decision (`execution_sandbox_denied`)
- Every execution outcome (`execution_succeeded`, `execution_failed`)
- Every trust change (`trust_score_changed`, `compartment_restricted`, `compartment_quarantined`, `trust_recovered`)
- Every approval action (`approval_approved`, `approval_rejected`)
- Every incident lifecycle event (`incident_opened`, `incident_closed`)
- Every config lifecycle event (`config_loaded`, `config_reloaded`, `config_reload_failed`, `config_validation_failed`)
- Every adaptive defense trigger (`rate_limit_triggered`, `adaptive_defense_triggered`)
- Every capability graph decision (`capability_graph_allowed`, `capability_graph_blocked`)

**Metadata only:** Audit events contain `inputType` and `inputSizeBytes`, never raw content, tokens, or secrets.

---

## 10. Incident Guarantees

**Guarantee:** Security anomalies are detected automatically by the runtime heuristics engine and escalated to incidents. Incidents are not silently suppressed.

- Heuristics fire deterministically at threshold crossings
- Incidents aggregate related anomaly events
- Duplicate open incidents (same type) are suppressed to prevent noise
- Incident status is always `open` or `closed` — no hidden states
- Incident severity is either `warning` or `critical`
- Operators can inspect open incidents via CLI (`grl incidents`) or HTTP (`GET /v1/security/incidents`)
- Closing an incident requires explicit operator action (`POST /v1/security/incidents/:id/close`)

---

## Summary: Security Principles

| Principle | Implementation |
|-----------|----------------|
| **Local-first** | Server binds only to `127.0.0.1`; no cloud, no remote config |
| **Deny-by-default** | No matching rule → deny; unknown compartment → deny |
| **Fail-closed** | Errors produce deny, not allow |
| **Least privilege** | Each transport has the minimum declared permissions |
| **Explicit transports** | Transport kind decided by policy, never by the agent |
| **Explicit permissions** | Every capability requires an explicit allow rule |
| **Immutable runtime state** | Config is deep-frozen and checksummed after load |
| **Deterministic evaluation** | No randomness, no ML, no sampling |
| **Defensive layering** | Multiple independent gates before execution |
