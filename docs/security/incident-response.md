# GRL Incident Response

> **Sprint 19 — Incident Response Documentation**

This document describes how the GRL runtime detects, classifies, and manages security incidents, and what actions the operator should take.

---

## 1. Incident Lifecycle

```text
                    Security Event
                    (audit emitted)
                         │
                         ▼
              RuntimeSecurityHeuristicsEngine
              (ingest → evaluate threshold)
                         │
              threshold crossed (once per type)
                         │
                         ▼
                    RuntimeAnomaly
                         │
                         ▼
                  IncidentDetector
              (group anomalies by type)
                         │
                  new or existing open incident
                         │
                         ▼
                 ┌───────────────────┐
                 │  Incident (open)  │
                 │  severity: warning│
                 │  or critical      │
                 └────────┬──────────┘
                          │
                          │ operator reviews
                          │
                          ▼
                 ┌───────────────────┐
                 │ Incident (closed) │
                 │ POST .../close    │
                 └───────────────────┘
```

**Key properties:**
- Incidents do not auto-close — they require explicit operator action
- Duplicate open incidents (same anomaly type) are suppressed
- Each incident aggregates `relatedEventIds` from all contributing anomalies
- Incident status is always `open` or `closed`

---

## 2. Severity Levels

### Warning

Indicates elevated or unusual activity that warrants operator attention but does not immediately block execution.

Examples:
- Repeated denied capabilities below threshold
- Trust score approaching restricted range
- Rate limit approaching (not yet exceeded)
- Single anomalous transition in capability graph

**Operator action:** Review audit events; monitor for escalation.

### Critical

Indicates a condition that has triggered automated defensive action or represents a significant security event.

Examples:
- Trust quarantine applied to a compartment
- Adaptive defense triggered (temporary block applied)
- Repeated failed config reloads
- Sustained burst of denied requests

**Operator action:** Immediate review required. Execution may be blocked pending resolution.

---

## 3. Trust Degradation

Trust scores decrease automatically in response to:

| Event | Score delta |
|-------|-------------|
| `capability_denied` | Negative delta (configurable) |
| `sandbox_violation` | Significant negative delta |
| `trust_quarantined` (other compartment) | No cross-compartment effect |
| `rate_limit_triggered` | Negative delta |
| `incident_opened` | Weighted negative delta (incident-weighted scoring) |

Trust levels map to execution behavior:
- `trusted` (80–100): normal execution
- `neutral` (50–79): normal execution
- `restricted` (20–49): execution requires approval
- `quarantined` (0–19): execution denied

**Audit events:** Every trust score change emits `trust_score_changed`. Threshold crossings emit `compartment_restricted` or `compartment_quarantined`.

---

## 4. Quarantine Flow

```text
Trust score drops below quarantine threshold (default: 20)
         │
         ▼
CompartmentTrustEngine: level → 'quarantined'
         │
         ▼
Audit event: compartment_quarantined
         │
         ▼
Execute pipeline: quarantined → 403 denied
(no execution for any tool in this compartment)
         │
         ▼
Operator reviews: grl trust <compartmentId>
         │
         ▼
Investigation: grl audit --type trust_score_changed
         │
         ▼
Incident closed: POST /v1/security/incidents/:id/close
         │
         ▼
Trust recovery begins (via clean execution history)
(score increases over time per TrustRecovery policy)
```

**Note:** Quarantine is not lifted automatically. Trust recovery requires clean execution events to accumulate.

---

## 5. Runtime Inspection

Use the following to inspect the GRL runtime state during an incident:

### Via CLI

```bash
# Runtime health and config version
grl health

# Open incidents
grl incidents

# Trust scores (all compartments)
grl trust

# Trust score for a specific compartment
grl trust research

# Recent audit events
grl audit --limit 50

# Filter by severity
grl audit --severity critical

# Filter by event type
grl audit --type capability_denied
grl audit --type trust_score_changed
grl audit --type compartment_quarantined
grl audit --type adaptive_defense_triggered
grl audit --type config_reload_failed
```

### Via HTTP

```bash
# All open incidents
curl http://127.0.0.1:8787/v1/security/incidents

# Specific incident
curl http://127.0.0.1:8787/v1/security/incidents/<id>

# Runtime anomalies
curl http://127.0.0.1:8787/v1/security/anomalies

# Trust profiles
curl http://127.0.0.1:8787/v1/trust/profiles

# Audit events (last 100)
curl "http://127.0.0.1:8787/v1/audit/events?limit=100"

# Active config checksum (integrity check)
curl http://127.0.0.1:8787/v1/runtime/config/checksum

# Defense status
curl http://127.0.0.1:8787/v1/defense/temporary-blocks
curl http://127.0.0.1:8787/v1/defense/rate-limits
```

---

## 6. Audit Review

When an incident occurs, the audit trail is the primary source of truth.

**Recommended review sequence:**

1. Identify the incident: `grl incidents`
2. Note `relatedEventIds` from the incident record
3. Pull those events: `GET /v1/audit/events/:id` for each related event
4. Review the full audit stream: `grl audit --limit 200`
5. Look for patterns:
   - Repeated denials from the same `agentId` / `compartmentId`
   - Unusual tool transitions in the capability graph
   - Trust score changes immediately preceding the incident
   - Config reload failures that left a degraded snapshot
6. Cross-reference with trust events: `grl audit --type trust_score_changed`

---

## 7. Recommended Operator Actions

### Scenario: Repeated capability denials

1. Review which rule is denying: `grl audit --type capability_denied`
2. If legitimate agent: adjust firewall rules in config, reload
3. If unknown agent: investigate `agentId`; do not add rules blindly
4. Monitor trust score: aggressive denials reduce trust

### Scenario: Compartment quarantined

1. `grl trust <compartmentId>` — confirm quarantine
2. Review trust history: `grl audit --type trust_score_changed`
3. Review incidents: `grl incidents`
4. If legitimately compromised: leave quarantine active; investigate agent
5. If false positive: close incident, allow trust recovery, or adjust trust thresholds in config

### Scenario: Config reload failed

1. `grl audit --type config_reload_failed` — get error reason
2. Fix the config file (see schema in `docs/runtime-config.md`)
3. Retry: `grl runtime reload`
4. Verify new checksum: `grl health`

### Scenario: Adaptive defense triggered temporary block

1. `GET /v1/defense/temporary-blocks` — see what is blocked and until when
2. Review rate limit events: `grl audit --type rate_limit_triggered`
3. If legitimate traffic: adjust rate limit policies in config, reload
4. If attack: leave block in place; tighten firewall rules

### Scenario: Approval queue growing (deadlock)

1. `GET /v1/approvals` — review pending requests
2. Approve or reject each: `POST /v1/approvals/:token/approve` or `.../reject`
3. If policy is generating too many approval requests: review `actionOnViolation` in config
4. Consider changing `require_approval` to `block` for high-risk tools if no human is available

---

## 8. Recovery Workflow

```text
INCIDENT DETECTED
      │
      ▼
Inspect audit trail
(grl audit, grl incidents, grl trust)
      │
      ▼
Identify root cause
      │
      ├─ Config issue → fix config → grl runtime reload
      │
      ├─ Agent behavior → investigate agentId → adjust firewall rules
      │
      ├─ Transport issue → check SearXNG → fix config → reload
      │
      ├─ Trust degradation → review events → close incident → wait for recovery
      │
      └─ False positive → close incident → adjust thresholds → reload
      │
      ▼
Close incident
POST /v1/security/incidents/:id/close
      │
      ▼
Monitor for recurrence
(grl incidents, grl audit)
      │
      ▼
RESOLVED
```

---

## 9. Incident API Reference

```bash
# List all incidents
GET /v1/security/incidents

# Get a specific incident
GET /v1/security/incidents/:id

# Close an incident
POST /v1/security/incidents/:id/close

# List anomalies
GET /v1/security/anomalies
```

**Incident record shape:**
```json
{
  "id": "inc-001",
  "type": "repeated_denied_capabilities",
  "severity": "warning",
  "status": "open",
  "openedAt": "2024-01-01T00:00:00.000Z",
  "closedAt": null,
  "summary": "Repeated capability denials detected",
  "relatedEventIds": ["evt-001", "evt-002"]
}
```
