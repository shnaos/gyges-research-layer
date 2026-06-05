# GRL Threat Model

> **Sprint 19 — Official Threat Model**
> This document is authoritative. It supersedes the earlier stub at `docs/threat-model.md`.

---

## 1. Scope

This threat model covers the **Gyges Research Layer (GRL)** runtime as shipped after Sprint 18. GRL is a local-first, privacy-first capability firewall and identity compartmentalization gateway for AI agents performing web research.

**In scope:**
- The GRL local API server (`apps/grl-server`, `127.0.0.1:8787`)
- The GRL CLI operator interface (`apps/grl-cli`)
- The core policy engines (`packages/core`)
- The runtime configuration loader and hot-reload path
- The SearXNG transport adapter (loopback-only)
- The audit and incident pipeline
- The capability graph and trust reputation engines

**Out of scope:**
- The host operating system, kernel, and hardware
- The underlying network stack below the loopback interface
- SearXNG itself (treated as an untrusted external component)
- Any downstream consumer or agent codebase

---

## 2. Protected Assets

| Asset | Description | Value |
|-------|-------------|-------|
| **Agent intent** | The query, tool, risk level, and compartment the agent submits | High — reveals agent purpose and strategy |
| **Runtime policies** | Firewall rules, transport policies, trust thresholds, rate limits | High — compromise enables policy bypass |
| **Compartment isolation** | Session, cookie, and user-agent separation between compartments | High — compromise allows cross-compartment correlation |
| **Audit integrity** | The immutable append-only audit trail | High — tampering hides malicious activity |
| **Trust reputation** | Per-compartment trust scores and history | Medium — manipulation enables bypass of quarantine |
| **Runtime configuration** | The JSON config file loaded at startup or hot-reload | High — corruption can disable all defenses |
| **Operator visibility** | The CLI operator's ability to observe runtime state | Medium — blocking visibility delays incident response |
| **Transport isolation** | The binding of a capability to an explicit transport | High — circumvention allows unapproved egress |
| **Session separation** | Session IDs, rotation history, and lifecycle | Medium — correlation enables de-anonymization |

---

## 3. Adversaries

### 3.1 Malicious Website

- **Goal:** Inject content into search results to influence agent behavior or exfiltrate data.
- **Capabilities:** Controls returned HTML/JSON, can embed misleading metadata, can craft prompt-injection payloads in result titles/snippets.
- **Assumed skills:** Advanced web attacker, familiar with LLM prompt injection.
- **Mitigated by:** GRL never fetches or renders result URLs. Results are returned as structured metadata only. No HTML scraping, no JavaScript execution, no cookie storage.

### 3.2 Compromised Search Engine

- **Goal:** Return fabricated or poisoned results; observe query patterns to build a profile.
- **Capabilities:** Full control over search API responses. Can correlate queries across sessions if session isolation is broken.
- **Assumed skills:** Nation-state or sophisticated operator with access to SearXNG instance.
- **Mitigated by:** SearXNG is loopback-only by config enforcement. Sessions are rotated per policy. Query content is never stored by GRL.

### 3.3 Prompt-Injected Agent

- **Goal:** Cause the agent to request capabilities or compartments it should not use; exfiltrate data through allowed channels.
- **Capabilities:** Can influence the agent's `tool`, `compartment`, `riskLevel`, or `input` fields.
- **Assumed skills:** Knowledge of GRL API surface.
- **Mitigated by:** Firewall denies by default. Compartment isolation. Trust scoring. Capability graph evaluates transition sequences. Approval queue for elevated risk.

### 3.4 Hostile Runtime Plugin

- **Goal:** Register a malicious transport or policy that bypasses defenses.
- **Capabilities:** Requires local code execution access.
- **Assumed skills:** Developer-level access to the GRL codebase.
- **Mitigated by:** No plugin runtime exists. Transport manifests are declared in config. Sandbox policy evaluated per transport.

### 3.5 Over-Privileged Transport

- **Goal:** Perform unauthorized network access, exfiltrate data, or bypass sandbox constraints.
- **Capabilities:** Runs within the GRL process with the permissions of the Node.js runtime.
- **Assumed skills:** Developer who can modify transport adapter code.
- **Mitigated by:** Sandbox policy evaluated before execution. SearXNG is loopback-only. Mock transport has no real egress. `allowBrowser=false`, `allowFilesystem=false`, `allowProcessSpawn=false` for all transports.

### 3.6 Local Malware

- **Goal:** Read GRL config, audit logs, or in-memory runtime state; interfere with policy execution.
- **Capabilities:** Arbitrary read/write on the local filesystem; can inspect process memory and open sockets.
- **Assumed skills:** Advanced persistent threat with host access.
- **Mitigated by:** GRL binds only to `127.0.0.1`. Config file is a local JSON read at startup. GRL does not store secrets, tokens, or raw inputs to disk.
- **Not mitigated:** GRL cannot protect against a compromised host OS (see Section 7).

### 3.7 Operator Mistakes

- **Goal:** Accidental misconfiguration that weakens defenses.
- **Capabilities:** Edit `grl.config.json`, set environment variables, restart the server.
- **Assumed skills:** Legitimate operator without full security expertise.
- **Mitigated by:** Config validation is fail-closed (server refuses to start on invalid config). Schema validation with machine-readable errors. Immutable snapshots prevent runtime mutation. Audit trail records all reloads.

### 3.8 Configuration Corruption

- **Goal:** Cause GRL to run with weakened or inconsistent policies.
- **Capabilities:** Corrupt the config file on disk (filesystem attack, operator error, or process crash).
- **Mitigated by:** Fail-safe reload: invalid reload keeps the previous snapshot. Config checksum (SHA-256 over canonical JSON) enables integrity verification. Audit events `config_reload_failed` and `config_validation_failed` are emitted immediately.

---

## 4. Security Assumptions

See [`security-assumptions.md`](./security-assumptions.md) for the full list.

Key assumptions:
- The host OS and Node.js runtime are not compromised.
- The operator controls the machine on which GRL runs.
- The loopback interface (`127.0.0.1`) is not accessible from remote hosts.
- The config file is written by a trusted operator.
- SearXNG runs locally and is not accessible from the internet.

---

## 5. Attack Surfaces

See [`attack-surfaces.md`](./attack-surfaces.md) for the detailed breakdown.

Summary:

| Surface | Exposure | Risk |
|---------|----------|------|
| HTTP API (`127.0.0.1:8787`) | Loopback only | Medium (local processes) |
| Runtime config loader | Filesystem read | Medium (config corruption) |
| Local filesystem | Config + no secrets | Low |
| Transport adapters (mock, SearXNG) | Loopback only | Low |
| CLI | Local subprocess | Low |
| SearXNG integration | Loopback HTTP | Medium |
| Audit pipeline | In-memory append | Low |
| Runtime reload | POST endpoint | Medium |
| Mock transport | No egress | Minimal |
| Capability graph | In-memory | Low |

---

## 6. Trust Boundaries

See [`trust-boundaries.md`](./trust-boundaries.md) for the full diagram and description.

Primary trust boundary crossings:

```text
Agent (untrusted)
  ↓ [HTTP: 127.0.0.1:8787]
GRL Runtime (trusted)
  ↓ [loopback HTTP]
SearXNG (untrusted external component, loopback-gated)
```

---

## 7. Non-Goals

**GRL DOES NOT:**

- Guarantee endpoint anonymity
- Replace Tor or any onion routing network
- Replace browser sandboxing or OS-level process isolation
- Prevent host compromise (kernel, OS, hardware)
- Protect against kernel-level rootkits or hypervisor attacks
- Guarantee perfect OPSEC for the operator or agent
- Classify the semantic maliciousness of search results or agent queries
- Provide anti-forensics — GRL emits a local audit trail by design
- Enforce network-level firewalling (it relies on the OS loopback interface)
- Provide authentication or authorization for the HTTP API
- Protect against timing-based side-channel attacks
- Guarantee unlinkability across multiple GRL instances
- Provide traffic analysis resistance

---

## 8. Residual Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Local process reads GRL config | Medium | Medium | Config contains no secrets |
| Prompt injection in search results influences agent | Medium | High | GRL cannot control agent reasoning; operators must apply agent-level defenses |
| Session correlation via SearXNG query patterns | Low | Medium | Session rotation, compartment isolation |
| Config hot-reload race condition | Low | Low | Fail-safe: old snapshot retained on error |
| Audit events not reviewed by operator | Medium | Medium | Incident detection, CLI inspection |
| Trust score manipulation via repeated low-risk requests | Low | Medium | Rate limiting, adaptive defense |
| Operator misconfigures compartment rules | Medium | High | Schema validation, fail-closed defaults |
| SearXNG instance becomes publicly accessible | Low | High | Config enforces loopback-only; operator responsible for network config |

---

## 9. Threat Matrix

| Threat | Actor | Asset | Likelihood | Impact | Mitigated |
|--------|-------|-------|-----------|--------|-----------|
| Prompt injection via search results | Malicious website | Agent intent | High | Medium | Partial — GRL does not control agent |
| Query correlation across sessions | Compromised SearXNG | Session separation | Medium | Medium | Yes — session rotation |
| Policy bypass via malformed request | Prompt-injected agent | Runtime policies | Medium | High | Yes — firewall + graph |
| Trust score manipulation | Prompt-injected agent | Trust reputation | Low | Medium | Yes — rate limiting |
| Config corruption on disk | Local malware | Runtime configuration | Low | High | Partial — fail-safe reload |
| Unauthorized local API access | Local malware | Operator visibility | Medium | Medium | Partial — loopback-only |
| Cross-compartment data leakage | Prompt-injected agent | Compartment isolation | Low | High | Yes — privacy boundary |
| Audit trail tampering | Local malware | Audit integrity | Low | High | Partial — in-memory only |
| Transport escalation to disallowed network | Over-privileged transport | Transport isolation | Low | High | Yes — sandbox + loopback |
| Config validation bypass | Operator mistake | Runtime policies | Low | High | Yes — fail-closed validation |
