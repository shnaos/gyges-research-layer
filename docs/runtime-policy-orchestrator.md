# Runtime Policy Orchestrator & Composite Privacy Policies

Sprint 28 introduces the first **central runtime arbitration layer** in GRL.

> **Sprint 29 update.** The orchestrator is now wired into the **real**
> `/v1/capabilities/execute` endpoint as well as `execute-mock`, both endpoints
> collect signals through a shared per-request `PolicySignalCollector`, the
> `multi_agent` source now emits real signals, and the orchestrator's signal
> inspection buffer is **bounded** (FIFO eviction, default 500). See
> [Sprint 29 — execute parity, bounded buffer, filters](#sprint-29--execute-parity-bounded-buffer-and-filters)
> below.

Until now each privacy and security gate in the execution pipeline — Capability
Graph, Trust Reputation, Behavioral Privacy, Persona Isolation, Temporal
Obfuscation, Transport Fingerprint, Adaptive Defense, Capability Firewall,
Privacy Boundary, Transport Policy, Session Manager, and Sandbox — operated
independently and produced its own decision. A request passed through them
sequentially; there was no single point that composed, compared, or explained
the collective result.

Sprint 28 adds the `RuntimePolicyOrchestrator` as an **inspectable, explainable
arbitration layer** that sits above the individual gates. It does not replace
them — it aggregates and explains their collective output.

Like every other GRL layer it performs **no** networking, fetch, DNS, socket,
browser, websocket/SSE, database, Redis, durable persistence, authentication,
telemetry, or AI/ML work. It processes in-memory signal records only and
**never** stores tokens, secrets, or raw caller input.

---

## Why it exists

Imagine the following simultaneous signals for a single request:

| Source                    | Requested action     | Severity |
|---------------------------|----------------------|----------|
| `persona_isolation`       | `rotate_fragment`    | medium   |
| `temporal_obfuscation`    | `delay`              | low      |
| `transport_fingerprint`   | `rotate_fingerprint` | low      |
| `trust_reputation`        | `require_approval`   | high     |
| `adaptive_defense`        | `cooldown`           | medium   |
| `capability_graph`        | `rotate_session`     | medium   |
| `capability_firewall`     | `deny`               | critical |

Without an orchestrator, the pipeline must select one path and silently discard
the rest. There is no audit record of the conflict, no explanation of why
`deny` was selected over `require_approval`, and no way for an operator to
inspect the reasoning.

The `RuntimePolicyOrchestrator` provides:

1. **Signal collection** — each gate emits a typed `PolicySignal`.
2. **Conflict detection** — incompatible signals produce typed `PolicyConflict` records.
3. **Deterministic merge** — one of three strategies resolves all signals into a single `UnifiedPrivacyAction`.
4. **Composite decision** — a `CompositeRuntimeDecision` records the final action, all flags, every signal, and every conflict with its resolution.
5. **Explainability** — the `reason` field on the decision is a human-readable summary of why the final action was chosen.

---

## Architecture

```
Agent request
  ↓
Signal collection (each gate → PolicySignal)
  ↓
RuntimePolicyOrchestrator.evaluate(signals)
  ↓
CompositePrivacyPolicy  (which policy governs?)
  ↓
DecisionMergeStrategy   (how are conflicts resolved?)
  ↓
CompositeRuntimeDecision
  ↓
Execution pipeline      (existing gates unchanged)
  ↓
Audit / Incidents       (3 new event types)
```

The existing gates continue to run unchanged. Each gate additionally emits a
`PolicySignal`. The orchestrator is evaluated **after all gates** and its
decision is surfaced in the response's `runtimePolicy` block alongside the
individual gate decisions.

---

## Signal sources

Each source maps to one of the 12 established GRL engines:

| `PolicySignalSource`      | Engine                              | Sprint |
|---------------------------|-------------------------------------|--------|
| `capability_graph`        | CapabilityGraphEngine               | 15     |
| `multi_agent`             | Multi-Agent Isolation               | —      |
| `behavioral_privacy`      | BehavioralPrivacyEngine             | 24     |
| `persona_isolation`       | PersonaIsolationEngine              | 25     |
| `temporal_obfuscation`    | TemporalObfuscationEngine           | 26     |
| `transport_fingerprint`   | TransportFingerprintEngine          | 27     |
| `trust_reputation`        | CompartmentTrustEngine              | 14     |
| `adaptive_defense`        | AdaptiveDefenseEngine               | 13     |
| `capability_firewall`     | CapabilityFirewall                  | 3      |
| `privacy_boundary`        | PrivacyBoundaryEngine               | —      |
| `transport_policy`        | TransportPolicyEngine               | 8      |
| `sandbox`                 | TransportCapabilityRegistry         | 10     |

---

## Unified privacy actions

Actions are ordered from least to most restrictive:

```
allow < delay < rotate_* < require_approval < cooldown < temporary_block < deny
```

| `UnifiedPrivacyAction`    | Meaning                                          |
|---------------------------|--------------------------------------------------|
| `allow`                   | No restriction.                                  |
| `delay`                   | Inject temporal jitter before execution.         |
| `rotate_session`          | Rotate the active session before execution.      |
| `rotate_fragment`         | Rotate the identity fragment before execution.   |
| `rotate_fingerprint`      | Rotate transport headers before execution.       |
| `require_approval`        | Block until a human approves the request.        |
| `cooldown`                | Enter a timed cooldown window; reject until end. |
| `temporary_block`         | Reject for a fixed temporary period.             |
| `deny`                    | Permanently reject this request.                 |

Rotation actions (`rotate_session`, `rotate_fragment`, `rotate_fingerprint`) are
**not** mutually exclusive — they accumulate. Any number of rotation signals can
be simultaneously active.

---

## Merge strategies

### `most_restrictive` (default)

Scan all signals, apply the full precedence table, collect all rotation flags,
preserve delay if present alongside rotations. `deny` always wins.

### `source_precedence`

The active policy's `precedence` array defines a ranked list of sources. The
action from the **first source** in precedence order that has a signal is
selected. Rotations from all sources still accumulate.

### `deny_first`

Scan signals; if **any** signal is `deny`, the result is immediately `deny`
regardless of source precedence. Otherwise behaves like `most_restrictive`.

---

## Conflict resolution

Conflicts are detected between any two non-rotation signals with different
actions. Each conflict is recorded with a typed `conflictType` and a
`resolution` field:

| Conflict scenario                   | `conflictType`       | `resolution`                    |
|-------------------------------------|----------------------|---------------------------------|
| `deny` vs. anything                 | `approval_vs_deny`   | `deny_wins`                     |
| `temporary_block` vs. `cooldown`    | `action_conflict`    | `most_restrictive_wins`         |
| `cooldown` vs. `delay`              | `delay_vs_block`     | `cooldown_wins_over_delay`      |
| `require_approval` vs. `delay`      | `timing_conflict`    | `approval_wins_over_delay`      |
| Any other pair of different actions | `action_conflict`    | `most_restrictive_wins`         |

Rotation signals never conflict with each other.

`allow` vs. any more-restrictive action is not recorded as a conflict — the
more-restrictive action simply wins without requiring a conflict record.

---

## fail-closed behaviour

The active policy's `failClosed` flag controls what happens when a critical
signal with an **unknown** action is encountered (e.g. an action string not
present in the precedence table):

- `failClosed: true` → the decision is **`deny`** immediately.
- `failClosed: false` → the unknown action is treated as `allow`.

The bootstrap `default-composite-privacy-policy` sets `failClosed: true`.

---

## Bootstrap policy

A single default policy is pre-registered at startup:

```json
{
  "id": "default-composite-privacy-policy",
  "enabled": true,
  "precedence": [
    "capability_firewall",
    "sandbox",
    "trust_reputation",
    "adaptive_defense",
    "privacy_boundary",
    "capability_graph",
    "multi_agent",
    "transport_policy",
    "transport_fingerprint",
    "persona_isolation",
    "temporal_obfuscation",
    "behavioral_privacy"
  ],
  "defaultAction": "allow",
  "failClosed": true,
  "mergeStrategy": "most_restrictive"
}
```

The precedence array is used only by the `source_precedence` merge strategy;
for `most_restrictive` the order of signals does not affect the result.

---

## Example composite decision

```json
{
  "action": "require_approval",
  "allowed": false,
  "requiresDelay": true,
  "requiresApproval": true,
  "requiresSessionRotation": false,
  "requiresFragmentRotation": true,
  "requiresFingerprintRotation": false,
  "reason": "Most restrictive action selected: require_approval (from trust_reputation, severity=high) over delay (from temporal_obfuscation, severity=low).",
  "signals": [
    { "source": "trust_reputation",     "action": "require_approval", "severity": "high"   },
    { "source": "temporal_obfuscation", "action": "delay",            "severity": "low"    },
    { "source": "persona_isolation",    "action": "rotate_fragment",  "severity": "medium" }
  ],
  "conflicts": [
    {
      "conflictType": "timing_conflict",
      "resolution": "approval_wins_over_delay",
      "reason": "\"require_approval\" wins over \"delay\"."
    }
  ]
}
```

---

## HTTP inspection endpoints

Three read-only metadata endpoints are added:

| Method | Path                                                   | Description                       |
|--------|--------------------------------------------------------|-----------------------------------|
| `GET`  | `/v1/runtime/policy-orchestrator/policies`             | List registered composite policies|
| `GET`  | `/v1/runtime/policy-orchestrator/signals`              | List buffered policy signals (Sprint 29: `?source=&action=&severity=&limit=` filters) |
| `GET`  | `/v1/runtime/policy-orchestrator/last-decision`        | Get the last composite decision   |

All responses contain **metadata only** — never raw request input, tokens, or secrets.

---

## CLI inspection

```bash
grl runtime policy                  # list registered policies
grl runtime policy signals          # list buffered signals
grl runtime policy last-decision    # show last composite decision

# Sprint 29 — filters
grl runtime policy signals --source multi_agent
grl runtime policy signals --severity high
grl runtime policy signals --action deny --limit 20
grl runtime policy signals --source multi_agent --json
```

---

## SDK inspection

```ts
const client = new GrlAgentClient();

const policies = await client.listRuntimePolicyOrchestratorPolicies();
const decision = await client.getLastRuntimePolicyDecision();

// Sprint 29 — listRuntimePolicySignals accepts optional filters.
const all      = await client.listRuntimePolicySignals();
const filtered = await client.listRuntimePolicySignals({
  source: 'multi_agent',
  action: 'deny',
  severity: 'critical',
  limit: 20
});
```

An invalid filter value is rejected server-side with HTTP 400 and surfaces as a
fail-closed error (`GrlAgentSdkError` in the SDK, `CliError` in the CLI).

---

## Audit events

Three new event types are emitted by the orchestrator (via `SecurityEventEngine` directly — not via `observeSecurity` to prevent an orchestrator→audit→orchestrator loop):

| `SecurityEventType`                  | When emitted                                      |
|--------------------------------------|---------------------------------------------------|
| `runtime_policy_evaluated`           | After every `evaluate()` call.                    |
| `runtime_policy_conflict_detected`   | When one or more conflicts are found.             |
| `runtime_policy_decision_applied`    | When the composite decision is attached to a response.|
| `runtime_policy_signal_evicted`      | (Sprint 29) When the bounded buffer evicts oldest signals FIFO; metadata `{ evictedCount, maxSignals }`.|

---

## Sprint 29 — execute parity, bounded buffer, and filters

### execute / execute-mock parity

Both `POST /v1/capabilities/execute-mock` and the real `POST /v1/capabilities/execute`
now run the identical orchestration path:

```
POST /v1/capabilities/execute(-mock)
  ↓
gates emit PolicySignals into a per-request PolicySignalCollector
  ↓
collector.evaluate() → RuntimePolicyOrchestrator
  ↓
runtimePolicy block on EVERY decision response (allowed | denied | pending)
  ↓ (execute only)
SearXNG / mock execution if allowed
```

- **Every decision path carries `runtimePolicy`.** Even when a gate short-circuits
  (a deny or a pending approval before execution), the composite decision is
  evaluated from exactly the signals collected up to that point and injected into
  the response.
- **Parity rule.** For the same authorised request (e.g. `search` / `low`), the
  **common signal sources** present in `execute-mock` are also present in
  `execute`. The only allowed difference is the transport: `execute-mock` always
  runs the mock transport, while `execute` runs the SearXNG transport when it is
  enabled (and falls back fail-closed otherwise). `execute-mock` additionally
  emits the `behavioral_privacy`, `persona_isolation`, and `temporal_obfuscation`
  sources for its richer simulated pipeline; `execute` emits the shared core
  sources (`capability_graph`, `multi_agent`, `trust_reputation`,
  `capability_firewall`, `transport_policy`, `privacy_boundary`,
  `transport_fingerprint`, `sandbox`, and `adaptive_defense` when triggered).

This answers questions such as *why was this search delayed / approved / denied /
rotated / fingerprint-isolated?* directly from the real endpoint's `runtimePolicy`
block and the `/signals` inspection endpoint.

### Per-request signal isolation (`PolicySignalCollector`)

Sprint 28 emitted signals directly into the orchestrator's shared buffer and
evaluated the **whole** buffer, which leaked signals across requests (and across
concurrent in-flight requests). Sprint 29 introduces `PolicySignalCollector`:

- one collector per request gathers only that request's signals;
- `collector.evaluate()` records those signals into the orchestrator's rolling
  inspection buffer **and** derives the composite decision from this request's
  signals only;
- decisions are therefore never contaminated by other requests, and the rolling
  buffer's eviction can never change decision correctness.

### Bounded signal buffer (FIFO)

The orchestrator's inspection buffer is bounded by `maxSignals` (default **500**):

```ts
new RuntimePolicyOrchestrator({ maxSignals: 500 });
```

- When recording would exceed `maxSignals`, the **oldest** signals are evicted FIFO.
- Memory can never grow without bound.
- `lastDecision` is preserved across eviction.
- When eviction occurs during a request, a `runtime_policy_signal_evicted` audit
  event is emitted with `{ evictedCount, maxSignals }` (no other metadata).
- A non-positive `maxSignals` is clamped to `1` (fail-closed: always bounded).

### `multi_agent` signals

The `multi_agent` source now emits real signals from the agent registry state,
evaluated as a gate right after the capability graph:

| Agent state                         | `action`          | `severity` | Pipeline outcome |
|-------------------------------------|-------------------|------------|------------------|
| registered / healthy, within quota  | `allow`           | `info`     | continue         |
| concurrent execution quota exceeded | `temporary_block` | `high`     | denied           |
| restricted                          | `require_approval`| `high`     | pending (approval)|
| evicted / quarantined               | `deny`            | `critical` | denied           |

The gate is **read-only** with respect to quota accounting: it idempotently
registers the agent (a fresh agent starts `idle`, under quota) and inspects
status/counts. It does not wire execution-count lifecycle into the request path —
that remains out of scope; the quota-exceeded signal is derived read-only from
registry counts.

### `/signals` endpoint filters

`GET /v1/runtime/policy-orchestrator/signals` accepts optional, composable filters:

| Query param | Validated against                | On invalid value |
|-------------|----------------------------------|------------------|
| `source`    | the 12 `PolicySignalSource` values | HTTP 400        |
| `action`    | the 9 `UnifiedPrivacyAction` values | HTTP 400        |
| `severity`  | `info\|low\|medium\|high\|critical` | HTTP 400        |
| `limit`     | positive integer (clamped to `maxSignals`) | HTTP 400 |

Filters compose with AND semantics; `limit` keeps the **most recent** matching
signals. Unknown filter values are rejected fail-closed (400) rather than
silently ignored.

```bash
curl 'http://127.0.0.1:8787/v1/runtime/policy-orchestrator/signals?source=multi_agent&severity=high&limit=20'
```

---

## MVP limits

- **No persistence** — the signal buffer and last decision are in-memory only; restarting the process clears them.
- **Bounded, not time-windowed** — the buffer is bounded by count (FIFO eviction, default 500), not by age. A future sprint may add time-windowed signal buffers.
- **No priority queuing** — conflicts are detected but not queued for retry; a denied or cooled-down request is simply rejected.
- **Single active policy** — multiple policies can be registered, but only the first enabled one governs each evaluation.
- **`multi_agent` quota signal is read-only** — execution-count lifecycle (increment/decrement around real executions) is not wired into the request path; the quota-exceeded signal reflects registry counts as set by the registry/management endpoints.

---

## Why this is not AI

The orchestrator uses **no** machine learning, neural networks, probabilistic
modelling, heuristics trained on data, or any form of inference beyond simple
comparisons of typed enum values in a static precedence table. Every decision
is fully determined by the signals provided and the registered policy's
`mergeStrategy` field. Given identical inputs the output is always identical.

---

## What the orchestrator does NOT guarantee

- **Anonymity** — the orchestrator cannot prevent fingerprinting at the network level, content level, or by a search engine observing query patterns.
- **Untraceability** — rotating headers, sessions, and fragments reduces trivial correlation surface but does not prevent an adversary with access to multiple data sources.
- **Completeness** — if a gate does not emit a signal (e.g. because it was skipped due to an early deny), that gate's perspective is absent from the composite decision.
- **Real-time enforcement** — the `runtimePolicy` block in a response is informational. Enforcement happens through the individual gate decisions that already ran.
