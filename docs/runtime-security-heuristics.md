# Runtime Security Heuristics & Incident Detection

Sprint 12 introduces GRL's first **behavioural detection layer**. It turns the
normalised security-event stream produced by the [Audit Trail & Security Event
Engine](./audit-security-events.md) (Sprint 11) into **runtime anomalies** and
**incidents**, without any networking, machine learning, or durable storage.

The layer is a **passive observer**. It never blocks a request, never mutates a
request, and never performs network, DNS, socket, browser, filesystem, process,
or persistence work. A failure inside the heuristics engine can never break the
primary `execute-mock` flow — the integration point is strictly fail-safe.

```
Execution Engine
  ↓
Security Event Engine      (emits SecurityEvent)
  ↓
Runtime Security Heuristics Engine   (ingest → RuntimeAnomaly[])
  ↓
Incident Detector          (process → RuntimeIncident[])
  ↓
Incident Store             (in-memory only)
```

## RuntimeSecurityHeuristicsEngine

The engine maintains a set of static [`HeuristicRule`](#heuristic-rules) plus a
bounded, in-memory history of observed events. On every `ingest(event)` it:

1. projects the event to a minimal, secret-free record (`id`, `timestamp`,
   `type`) and appends it to the sliding history;
2. evaluates every **enabled** rule whose watched event types include the
   event's type, counting matching events within `[timestamp − timeWindowMs,
   timestamp]`;
3. raises a `RuntimeAnomaly` **exactly once**, on the event that brings the
   in-window count up to the rule's `threshold` (so detection is stable and not
   noisy).

It is fully **deterministic**: the window's reference time is the ingested
event's own `timestamp`, so a given event sequence always produces the same
anomalies. There is **no ML, no AI, and no semantic classification** — only
counting.

API:

| Method | Description |
| --- | --- |
| `registerRule(rule)` | Register a rule; duplicate ids are rejected. |
| `listRules()` | List registered rules (defensive copies). |
| `clearRules()` | Remove every rule. |
| `ingest(event)` | Observe one event; returns anomalies it triggered. |
| `queryAnomalies()` | List every raised anomaly (defensive copies). |
| `clearAnomalies()` | Drop all raised anomalies. |

## IncidentDetector

The detector groups anomalies into incidents. On `process(anomalies)` it:

- groups the batch by `RuntimeAnomaly.type`;
- aggregates each group's `anomalyIds` and de-duplicated `relatedEventIds` into
  a single incident;
- **suppresses exact immediate duplicates** — a group whose resulting incident
  is identical to an already-open one does not open a second incident;
- auto-opens incidents with `status: 'open'` and a severity derived from the
  most severe anomaly score in the group.

API:

| Method | Description |
| --- | --- |
| `process(anomalies)` | Open/aggregate incidents; returns affected incidents. |
| `listIncidents(status?)` | List incidents, optionally filtered by status. |
| `getIncident(id)` | Fetch one incident, or `undefined`. |
| `closeIncident(id)` | Close an incident (throws if unknown). |

## IncidentStore

A deterministic, **in-memory** store: `append`, `list(status?)`, `getById`,
`updateStatus`, `clear`, `size`. It makes defensive copies on the way in and
out and preserves stable insertion order. There is **no database, no file, no
network, and no durable persistence** of any kind.

## Heuristic rules

A rule fires when at least `threshold` matching events occur within
`timeWindowMs`:

```ts
interface HeuristicRule {
  id: string;
  name: string;
  anomalyType: RuntimeAnomalyType;
  threshold: number;
  timeWindowMs: number;
  severity: IncidentSeverity; // 'info' | 'warning' | 'critical'
  enabled: boolean;
}
```

### Supported heuristics

| Anomaly type | Triggering security event(s) | Bootstrap threshold |
| --- | --- | --- |
| `repeated_denied_capabilities` | `capability_denied` | 3 / 60s |
| `sandbox_violation_attempts` | `sandbox_blocked` | 2 / 60s |
| `privacy_boundary_violations` | `privacy_boundary_blocked` | 2 / 60s |
| `rapid_session_rotation` | `session_rotated` | 5 / 60s |
| `high_risk_execution_pattern` | `execution_failed` **or** `execution_blocked` | 3 / 60s |
| `approval_rejection_pattern` | `approval_rejected` | 3 / 60s |

The mapping from anomaly type to triggering event types is the closed,
static `ANOMALY_EVENT_TYPES` table.

## Incident lifecycle

```
anomaly(s) ──process()──▶ incident { status: 'open' }
                                   │
                         POST .../close
                                   ▼
                          incident { status: 'closed' }
```

- Incidents are **auto-opened** by the detector — never created over HTTP.
- They aggregate the `relatedEventIds` of every contributing anomaly.
- An identical, still-open incident is **not** re-opened (duplicate suppression).
- Closing an incident is the only externally-driven transition.

## Example anomaly

```json
{
  "id": "a1b2…",
  "createdAt": 1717599999000,
  "type": "repeated_denied_capabilities",
  "score": "high",
  "relatedEventIds": ["evt-1", "evt-2", "evt-3"],
  "summary": "Repeated denied capabilities: 3 capability_denied event(s) within 60000ms.",
  "metadata": {
    "ruleId": "repeated-denied",
    "anomalyType": "repeated_denied_capabilities",
    "eventType": "capability_denied",
    "matchedCount": 3,
    "threshold": 3,
    "timeWindowMs": 60000,
    "severity": "warning"
  }
}
```

## Security endpoints

All responses carry **only normalised, secret-free metadata** — never an
approval token, secret, raw HTTP header, raw environment, raw stack trace, or
raw request input.

| Method & path | Description | Codes |
| --- | --- | --- |
| `GET /v1/security/anomalies` | List detected anomalies | 200, 405 |
| `GET /v1/security/incidents` | List incidents (`?status=open\|closed`) | 200, 400, 405 |
| `GET /v1/security/incidents/:id` | Fetch one incident | 200, 404, 405 |
| `POST /v1/security/incidents/:id/close` | Close an incident | 200, 404, 405 |

### Examples

```bash
# List anomalies
curl http://127.0.0.1:8787/v1/security/anomalies

# List open incidents
curl 'http://127.0.0.1:8787/v1/security/incidents?status=open'

# Fetch one incident
curl http://127.0.0.1:8787/v1/security/incidents/<id>

# Close an incident
curl -X POST http://127.0.0.1:8787/v1/security/incidents/<id>/close
```

## Privacy: non-storage policy

Anomalies and incidents **never** store:

- approval tokens,
- raw request input,
- secrets or credentials,
- `process.env`,
- complete HTTP headers,
- raw stack traces.

Only minimal metadata is retained: event counts, anomaly/event types,
severities, timestamps, and ids.

## Limits of static heuristics

- Detection is purely **threshold + time-window** based; there is no semantic
  understanding of intent and no anomaly scoring beyond the fixed severity map.
- Thresholds are static and global per rule; they are not adaptive or learned.
- The event history is in-memory and non-durable — restarting the server clears
  all anomalies and incidents.
- There is intentionally **no AI/ML, no telemetry, and no real network** in this
  layer.
