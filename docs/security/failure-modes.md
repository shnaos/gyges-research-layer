# GRL Failure Modes

> **Sprint 19 — Failure Mode Documentation**

This document catalogs every known failure mode in the GRL runtime.
Each entry includes: symptom, impact, expected GRL behavior, and recovery strategy.

---

## 1. Config Corruption

**Symptom:**
- `grl.config.json` contains invalid JSON or fails schema validation
- Server logs `RuntimeConfigValidationError` with a `reason` field

**Impact:**
- If at startup: server refuses to start (fail-closed)
- If at hot-reload: reload is rejected, previous snapshot retained

**Expected GRL Behavior:**
- `loadFromFile()` throws `RuntimeConfigValidationError`
- `reload()` emits `config_reload_failed` and keeps the previous snapshot active
- Audit event `config_validation_failed` is recorded with the error reason
- Server remains operational with last-known-good config

**Recovery:**
1. Inspect the validation error reason in audit events (`grl audit --type config_validation_failed`)
2. Fix the config file (see `docs/runtime-config.md` for schema reference)
3. Reload: `grl runtime reload` or restart the server

---

## 2. Invalid Reload

**Symptom:**
- `POST /v1/runtime/reload` returns `400` with `invalid_config` error
- Audit shows `config_reload_failed`

**Impact:**
- New config not applied; previous snapshot remains active
- Runtime continues operating normally

**Expected GRL Behavior:**
- Fail-safe reload: error is caught, old snapshot retained, audit event emitted
- HTTP response: `{ "error": "config_reload_failed", "reason": "<validation reason>" }`

**Recovery:**
1. Read the error body for the validation reason
2. Fix the config file
3. Retry `POST /v1/runtime/reload`

---

## 3. Transport Timeout

**Symptom:**
- `POST /v1/capabilities/execute` or `/execute-mock` returns `execution_failed`
- Audit shows `execution_failed` with timeout-related message
- SearXNG instance is unreachable or slow

**Impact:**
- Request fails; no result returned to agent
- No session state mutation (timeout happens at transport layer)

**Expected GRL Behavior:**
- `AbortController` fires at `timeoutMs` threshold
- Execution engine returns `status: 'failed'`
- Audit event `execution_failed` emitted
- No retry; fail-closed

**Recovery:**
1. Verify SearXNG is running: `curl http://127.0.0.1:8080/search?q=test&format=json`
2. Increase `transports.searxng.timeoutMs` in config if SearXNG is slow
3. Reload config: `grl runtime reload`

---

## 4. Runtime Unreachable

**Symptom:**
- CLI returns `error [runtime_unreachable]: Could not connect to the GRL server`
- Agent receives `ECONNREFUSED` on port 8787

**Impact:**
- All agent and CLI operations fail
- No policy evaluation possible

**Expected GRL Behavior:**
- CLI exits with code `2` and error message to stderr
- No silent retry

**Recovery:**
1. Start the GRL server: `npm run dev:server`
2. Verify it is listening: `curl http://127.0.0.1:8787/v1/health`
3. Check `GRL_PORT` (default `8787`) and `GRL_HOST` (must be `127.0.0.1`)

---

## 5. Sandbox Denial

**Symptom:**
- `/v1/capabilities/execute-mock` or `/v1/capabilities/execute` returns `denied`
- Reason contains `sandbox` or `execution_sandbox_denied`
- Audit shows `execution_sandbox_denied`

**Impact:**
- Capability execution blocked; no transport call made

**Expected GRL Behavior:**
- `TransportCapabilityRegistry.evaluateSandbox()` returns `deny`
- Execution engine receives deny decision and returns `denied` response
- Audit event emitted; session not minted

**Recovery:**
1. Inspect sandbox policies: `curl http://127.0.0.1:8787/v1/transports/audit`
2. Check transport manifest permissions match the sandbox policy
3. If intentional, no action needed (the defense is working correctly)
4. If misconfigured, update `sandboxPolicies` in `grl.config.json` and reload

---

## 6. Trust Quarantine

**Symptom:**
- Requests for a compartment are denied with `trust_quarantine` reason
- `grl trust <compartmentId>` shows `level: quarantined`, `score: <20`

**Impact:**
- All capability execution for the affected compartment is denied
- No execution proceeds until operator intervention

**Expected GRL Behavior:**
- `CompartmentTrustEngine` returns `quarantined` level
- Execute pipeline: quarantined → `403 denied`, reason `trust_quarantined`
- Audit event `compartment_quarantined` already in trail

**Recovery:**
1. Review what caused the score drop: `grl audit --type trust_score_changed`
2. Review open incidents: `grl incidents`
3. If the compartment is legitimately compromised, leave quarantine active
4. If false positive or resolved: close the incident (`POST /v1/security/incidents/:id/close`) and allow trust to recover via clean execution (trust recovery policy applies)

---

## 7. Incident Escalation

**Symptom:**
- `grl incidents` shows open `critical` severity incidents
- Multiple anomalies detected in a short window
- Adaptive defense has escalated risk levels

**Impact:**
- Requests in affected compartments may be denied or require approval
- Risk levels escalated automatically by adaptive defense

**Expected GRL Behavior:**
- `RuntimeSecurityHeuristicsEngine` fires anomaly at threshold crossing (once)
- `IncidentDetector` groups anomalies into an incident
- Incident is opened with `open` status and severity
- Audit events emitted; incident queryable via CLI and HTTP

**Recovery:**
1. Review the incident: `grl incidents`
2. Review related audit events: `grl audit`
3. Take operator action (e.g., adjust config, close compartment)
4. Close incident: `POST /v1/security/incidents/:id/close`
5. Monitor trust scores after closure

---

## 8. Approval Deadlock

**Symptom:**
- Agent receives `decision: pending` on repeated requests
- `GET /v1/approvals` shows queue growing
- No human operator is available to approve

**Impact:**
- Requests requiring approval are enqueued indefinitely until approval or expiry
- Agent cannot proceed autonomously

**Expected GRL Behavior:**
- Pending requests are not executed
- Approval tokens expire after their TTL
- Expired approvals return `expired` on attempt to use

**Recovery:**
1. Review pending approvals: `GET /v1/approvals`
2. Approve or reject via the approval API
3. If the approval queue is growing due to policy misconfiguration, review firewall/privacy rules
4. Consider adjusting `actionOnViolation` from `require_approval` to `block` if no human is available

---

## 9. Compartment Restriction

**Symptom:**
- Requests for a compartment return `decision: pending` (require_approval)
- `grl trust <compartmentId>` shows `level: restricted`, `score: 20–49`

**Impact:**
- Execution requires human approval; no autonomous operation

**Expected GRL Behavior:**
- `CompartmentTrustEngine` returns `restricted` level
- Execute pipeline: restricted → enqueue approval request → `pending` response
- Audit event emitted

**Recovery:**
1. Review trust events: `grl audit --type trust_score_changed`
2. If the restriction is legitimate, monitor and approve requests selectively
3. If false positive, allow trust to recover or adjust trust thresholds in config and reload

---

## 10. Session Rotation Exhaustion

**Symptom:**
- Session creation fails or produces errors
- `grl audit` shows repeated `session_rotated` events
- Compartment appears to loop on session rotation

**Impact:**
- Execution may be denied if session cannot be created
- Rapid rotation increases audit event volume

**Expected GRL Behavior:**
- `SessionManager.getOrCreateSession()` creates a new session on rotation
- Failed sessions (denied or pending) do not create new sessions
- Each rotation is audit-logged

**Recovery:**
1. Review audit events for `session_rotated` frequency
2. Inspect transport policy to check if `forceRotateOnHighRisk` is too aggressive
3. Adjust rotation policy in `transportPolicies` and reload config
4. If rotation is triggered by capability graph `force_rotation`, review graph transition rules

---

## General Recovery Principles

1. **Fail-closed:** GRL always fails toward deny. A failure that stops execution is safer than one that allows it.
2. **Audit first:** Always start recovery by reviewing audit events — they contain the full decision trail.
3. **Reload, don't restart:** Most config issues can be resolved without restarting the server (`grl runtime reload`).
4. **Preserve stateful state across reload:** Sessions, trust scores, audit events, and incidents are preserved on reload by design. Only policy engines are rebuilt.
5. **Close incidents explicitly:** Incidents do not auto-close. Operator must close them after investigation.
