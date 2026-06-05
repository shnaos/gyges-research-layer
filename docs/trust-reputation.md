# Compartment Trust Scoring & Reputation Engine

Sprint 14 introduces GRL's first **reputation layer**. Until now GRL could apply
policies, rate-limit, cool down, temporarily block, escalate risk, detect
anomalies and open incidents — but it had **no memory of how a compartment has
behaved over time**. This layer adds a deterministic, in-memory **trust score**
per identity compartment that rises and falls with runtime events and feeds back
into the `execute-mock` decision pipeline.

Like every other GRL layer it performs **no** networking, fetch, DNS, socket,
browser, websocket/SSE, database, Redis, durable persistence, authentication, or
AI/ML/semantic classification work, and it **never** stores tokens, secrets, or
raw caller input — only minimal metadata. GRL remains fully agnostic: there is
no coupling to any external product.

```
Agent (local)
  ↓
Compartment Trust Engine        ← Sprint 14
  ↓
Adaptive Defense Engine
  ↓
Capability Firewall
  ↓
Approval Queue
  ↓
Privacy Boundary Engine
  ↓
Session Manager
  ↓
Transport Policy Engine
  ↓
Transport Capability Registry
  ↓
Adapter Sandbox
  ↓
Execution Engine
  ↓
Security Event Engine
  ↓
Runtime Security Heuristics Engine
  ↓
Incident Detector
  ↓
Incident Store
  ↓
Audit Store
  ↓
Mock Transport only
```

## Role of the CompartmentTrustEngine

The `CompartmentTrustEngine` (`packages/core/src/trust-reputation`) maintains one
`ReputationProfile` per compartment. Each profile holds the current `TrustScore`
and the append-only list of `ReputationEvent`s that produced it. The engine is:

- **deterministic** — every event maps to a fixed delta; injectable `now` /
  `generateId` make timestamps and ids reproducible in tests;
- **in-memory only** — nothing is persisted to disk, DB, or cache;
- **defensive** — `getProfile`, `listProfiles` and event lists are always
  returned as deep copies, so callers can never mutate engine state;
- **bounded** — every score is clamped to `0..100`.

## Trust levels

The score maps to a `TrustLevel` band:

| Level         | Score range |
| ------------- | ----------- |
| `trusted`     | 80..100     |
| `neutral`     | 50..79      |
| `restricted`  | 20..49      |
| `quarantined` | 0..19       |

A freshly created profile starts at the **neutral baseline of 70**.

## Scoring table

Each `ReputationEventType` applies a fixed adjustment:

| Event type                          | Delta |
| ----------------------------------- | ----- |
| `capability_allowed`                | +0    |
| `clean_execution`                   | +1    |
| `capability_denied`                 | -2    |
| `approval_rejected`                 | -4    |
| `privacy_boundary_blocked`          | -8    |
| `sandbox_blocked`                   | -10   |
| `execution_failed`                  | -6    |
| `incident_opened` (warning)         | -12   |
| `incident_opened` (critical)        | -25   |
| `incident_closed`                   | +5    |

The negative refusal deltas are static. The recovery deltas
(`clean_execution`, `incident_closed`) come from the `TrustRecoveryPolicy`, and
the incident deltas come from the `IncidentWeightedScoringPolicy`, so they can be
tuned without touching engine logic.

## Score lifecycle

1. A compartment is created at **70 (neutral)** on first sight.
2. Defensive refusals (denied capability, rejected approval, privacy/sandbox
   block, failed execution) **lower** the score.
3. Opened incidents lower it more sharply, weighted by severity.
4. Clean executions and closed incidents **restore** it.
5. The score is always clamped: it never rises above 100 nor drops below 0.

## Decay & recovery

In this engine **decay means progressive restoration toward a healthy neutral
state**, not punishment:

- `applyDecay(now?)` nudges profiles **below** the decay `maxScore` (70) upward by
  `recoveryDelta`, throttled per-compartment by `intervalMs`.
- A score **at or above 70 is never artificially inflated** by decay.
- `clean_execution` restores a little; `incident_closed` restores more.
- The `TrustRecoveryPolicy` caps total positive recovery to
  `maxRecoveryPerWindow` within a sliding `windowMs`, so a flood of clean events
  cannot instantly whitewash a degraded compartment.
- No restoration ever exceeds 100; no drop ever goes below 0.

## Interaction with audit & incidents

The local server wraps security-event emission in a fail-safe `observeSecurity`
helper. After an event is emitted and fed to the heuristics engine, the helper:

- maps the security event to a `ReputationEventType` (when a `compartmentId` is
  present) and records it on the trust engine;
- records `incident_opened` (with `warning` / `critical` severity) for incidents
  newly opened by the detector, remembering the owning compartment;
- records `incident_closed` when an incident is closed via the API.

Whenever a recorded event changes the score, the server emits **new audit
events** through the Security Event Engine:

| Audit event              | Emitted when                                   |
| ------------------------ | ---------------------------------------------- |
| `trust_score_changed`    | the numeric score changes                      |
| `trust_recovered`        | the score increases                            |
| `compartment_restricted` | the level transitions into `restricted`        |
| `compartment_quarantined`| the level transitions into `quarantined`       |

To avoid an **audit → trust → audit** loop, trust audit events are emitted
**directly** through the engine and are deliberately **excluded** from the
security-event-to-reputation mapping, so they never re-adjust the score.

## Impact on `execute-mock`

Trust is evaluated **before** the adaptive defense pipeline:

1. The compartment profile is fetched (created if missing).
2. **`quarantined`** → request is **denied** with reason
   `Compartment quarantined.` — nothing executes.
3. **`restricted`** → request is forced through **human approval**
   (`decision: "pending"`), the documented MVP choice over silent risk
   escalation, so a degraded compartment cannot act unattended.
4. **`neutral` / `trusted`** → the request continues normally.

A successful response includes a `trust` block reflecting the post-execution
score:

```json
{
  "trust": {
    "compartmentId": "research",
    "score": 71,
    "level": "neutral"
  }
}
```

## Endpoints

All trust endpoints return **metadata only** — never tokens, secrets, or raw
input. They are `GET`-only; other methods return `405`.

| Method & path                              | Description                          |
| ------------------------------------------ | ------------------------------------ |
| `GET /v1/trust/profiles`                   | list all reputation profiles         |
| `GET /v1/trust/profiles/:compartmentId`    | one profile (`404` if unknown)       |
| `GET /v1/trust/events`                     | all reputation events                |
| `GET /v1/trust/events?compartmentId=research` | events for one compartment        |

### Example requests

```bash
curl http://127.0.0.1:8787/v1/trust/profiles
curl http://127.0.0.1:8787/v1/trust/profiles/research
curl http://127.0.0.1:8787/v1/trust/events
curl "http://127.0.0.1:8787/v1/trust/events?compartmentId=research"
```

## Guarantees & limits

- **No AI / ML / semantic classification** — scoring is a fixed lookup table.
- **No real network** — no fetch, DNS, socket, browser, websocket/SSE; the mock
  transport remains the only transport.
- **No durable persistence** — all profiles and events live in memory and are
  lost on restart.
- **No secrets** — only `compartmentId`, event type, delta, reason and optional
  related event/incident ids are stored; tokens, secrets and raw input are never
  recorded.
- **No external coupling** — GRL stays fully agnostic.
