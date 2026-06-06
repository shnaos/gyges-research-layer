# GRL Privacy Model

> **Sprint 19 — Privacy Model Documentation**

This document explains GRL's privacy design: why it is local-first, what data it minimizes, and how compartment isolation and trust management protect agent privacy.

---

## 1. Local-First Rationale

GRL is **local-first** by design: all policy evaluation, session management, audit storage, and configuration management run on the operator's machine. There is no cloud service, no remote API, no telemetry server, and no data leaving the local machine (except via explicitly declared and policy-controlled transports).

**Why local-first?**

| Problem with cloud | GRL approach |
|--------------------|-------------|
| Requests visible to cloud provider | All processing on-machine |
| Account linking / user profiling | No accounts, no identifiers |
| Query history stored remotely | No durable remote storage |
| Compliance risk (GDPR, etc.) | No data leaves unless explicitly configured |
| Third-party data breach exposure | No third-party data processor |
| Outage risk | No cloud dependency — works offline |

**Implication:** GRL's privacy guarantees are bounded by the operator's host machine. If the host is compromised, GRL's privacy guarantees do not hold. See [Security Assumptions](./security-assumptions.md).

---

## 2. Metadata Minimization

GRL is designed to minimize the data it processes and records at every layer.

### What GRL records in audit events:

| Field | What is recorded |
|-------|-----------------|
| `agentId` | The agent identifier (as submitted by the agent) |
| `compartmentId` | The compartment identifier |
| `tool` | The tool name (e.g., `search`) |
| `riskLevel` | The risk level (e.g., `low`) |
| `decision` | The policy decision (e.g., `allowed`, `denied`) |
| `inputType` | The type of input (e.g., `string`) |
| `inputSizeBytes` | The size of the input in bytes |
| `timestamp` | Event timestamp |
| `severity` | Event severity |

### What GRL does NOT record:

- Raw query content (the actual search string)
- Search results content
- Session identifiers (beyond what is needed for session lifecycle)
- HTTP headers or user-agent strings
- IP addresses of the agent (all traffic is loopback)
- Approval request content
- Config file raw contents (only version/checksum)
- Any personally identifying information

---

## 3. No Telemetry

GRL emits **zero telemetry**. There is no:
- Analytics
- Usage reporting
- Error reporting to external services
- Version check requests
- Heartbeat to any remote server
- Logging to external log aggregators

All audit events are stored in-memory only and exposed via the local HTTP API.

---

## 4. No Cloud Sync

GRL does not sync any data to any cloud service. Specifically:
- Runtime config is read from a local JSON file only
- Audit events are in-memory only (not persisted to disk or cloud)
- Trust scores are in-memory only
- Session state is in-memory only
- Approval queue is in-memory only
- Incident records are in-memory only

**Implication:** All in-memory state is lost on server restart. This is a deliberate privacy design choice — GRL does not accumulate a long-term behavioral profile.

---

## 5. No Browser Storage

GRL does not use or emulate browser mechanisms:
- No cookies (not stored, not sent, not persisted)
- No `localStorage` or `sessionStorage`
- No `IndexedDB`
- No browser cache
- No HTML rendering or JavaScript execution
- No browser fingerprinting

The SearXNG transport sends a structured HTTP GET request only. It does not follow links, render pages, or execute any content from the returned results.

---

## 6. No Cookie Persistence

GRL does not handle cookies at any layer:
- No cookie jar in the SearXNG transport
- No `Cookie` or `Set-Cookie` header processing
- No cross-request cookie state
- SearXNG requests are stateless HTTP GETs

---

## 7. No Token Persistence

GRL does not persist tokens of any kind:
- No API tokens stored in config or on disk
- No session tokens persisted beyond the in-memory session lifetime
- No authentication tokens (there is no auth layer)
- Approval tokens are ephemeral, single-use, and in-memory only

---

## 8. Compartment Isolation

Compartment isolation is GRL's primary privacy primitive for multi-agent or multi-task scenarios.

```text
┌──────────────────────┐     ┌──────────────────────┐
│  Compartment A       │     │  Compartment B       │
│  (research task 1)   │     │  (research task 2)   │
│                      │     │                      │
│  Session:  A-001     │     │  Session:  B-001     │
│  Transport: mock     │     │  Transport: searxng  │
│  TrustScore: 70      │     │  TrustScore: 45      │
│  AuditEvents: [...]  │     │  AuditEvents: [...]  │
└──────────────────────┘     └──────────────────────┘
         │                            │
         │        NO SHARED STATE     │
         └────────────────────────────┘
```

**Guaranteed isolation properties:**
- No shared sessions between compartments
- No shared cookies or user-agents
- No shared trust scores
- Cross-compartment access requires an explicit privacy boundary rule
- Missing rule → fail-closed (block)
- Unknown compartment → block

**Anti-correlation by design:** An observer who can see the SearXNG query stream cannot link queries from compartment A to queries from compartment B (assuming session rotation is configured).

---

## 9. Trust Decay and Recovery Rationale

GRL's trust system models the intuition that a compartment with a history of policy violations is more likely to represent compromised or misused agent behavior.

### Decay

Trust scores decay over time (configurable) even without incidents. This prevents a compartment from permanently coasting on a historically high trust score after a long period of inactivity.

**Rationale:** Stale trust is unreliable. A compartment that was trusted last month may not reflect the current state of the agent.

### Recovery

Trust scores increase on clean execution events (configurable). This allows legitimate compartments to recover from temporary anomalies without permanent quarantine.

**Rationale:** Recovery must be earned through demonstrated safe behavior, not granted automatically by time alone.

### Incident-weighted scoring

When an incident is open for a compartment, trust score penalties are weighted by the incident's severity. Critical incidents cause larger score drops than warnings.

**Rationale:** Not all anomalies are equal. A single denied capability is not equivalent to a sustained burst of high-risk requests.

---

## 10. Summary: Privacy Properties

| Property | Value |
|----------|-------|
| Data locality | 100% on-machine |
| Telemetry | None |
| Cloud sync | None |
| Browser storage | None |
| Cookie storage | None |
| Token persistence | None |
| Raw input logging | Never |
| Search result storage | None |
| Cross-compartment data sharing | None (by default) |
| Audit event retention | In-memory only; lost on restart |
| Network egress | Loopback only (to local SearXNG) |

---

## 11. What GRL's Privacy Model Does NOT Provide

- **Anonymity guarantee:** GRL does not guarantee that an agent's identity is hidden from a network observer or a compromised SearXNG instance.
- **Traffic analysis resistance:** GRL does not obfuscate query timing, size, or frequency.
- **Content confidentiality:** GRL does not encrypt in-flight data (all traffic is loopback).
- **Anti-forensics:** GRL emits a local audit trail by design. This trail is not encrypted.
- **Host privacy:** GRL cannot protect against an attacker who has access to the host OS.

---

## 12. Behavioral Privacy & Anti-Correlation

Sprint 24 adds a metadata-only behavioral privacy layer.

### What it tracks

- topic labels only (never raw queries or URLs)
- temporal burst patterns
- repeated-behavior score
- active identity fragment counts

### What it does not track

- raw request input
- tokens or secrets
- browser fingerprints
- durable history beyond process memory

### Mitigations

Depending on risk, GRL may recommend deterministic temporal jitter, rotate an identity fragment, or block the request when correlation risk becomes critical.

All state remains in-memory and is lost on restart.
