# GRL Trust Boundaries

> **Sprint 19 — Official Trust Boundary Documentation**

This document defines every trust boundary in the Gyges Research Layer runtime, with ASCII diagrams.

---

## Overview

A trust boundary is a line where data or control passes between a more-trusted and a less-trusted zone. GRL enforces multiple layered boundaries so that compromise of one zone does not automatically compromise others.

```text
┌────────────────────────────────────────────────────────────────┐
│                        HOST MACHINE                            │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   GRL RUNTIME BOUNDARY                   │  │
│  │                                                          │  │
│  │  ┌───────────────────────────────────────────────────┐   │  │
│  │  │              CAPABILITY GRAPH BOUNDARY            │   │  │
│  │  │  ┌─────────────────────────────────────────────┐  │   │  │
│  │  │  │           TRUST / DEFENSE BOUNDARY          │  │   │  │
│  │  │  │  ┌───────────────────────────────────────┐  │  │   │  │
│  │  │  │  │         PRIVACY BOUNDARY              │  │  │   │  │
│  │  │  │  │  ┌─────────────────────────────────┐  │  │  │   │  │
│  │  │  │  │  │      SANDBOX BOUNDARY           │  │  │  │   │  │
│  │  │  │  │  │  ┌───────────────────────────┐  │  │  │  │   │  │
│  │  │  │  │  │  │   TRANSPORT BOUNDARY      │  │  │  │  │   │  │
│  │  │  │  │  │  │   (loopback-only egress)  │  │  │  │  │   │  │
│  │  │  │  │  │  └───────────────────────────┘  │  │  │  │   │  │
│  │  │  │  │  └─────────────────────────────────┘  │  │  │   │  │
│  │  │  │  └───────────────────────────────────────┘  │  │   │  │
│  │  │  └─────────────────────────────────────────────┘  │   │  │
│  │  └───────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
│  ┌───────────────────┐   ┌─────────────────────────────────┐   │
│  │  CLI / OPERATOR   │   │        FILESYSTEM BOUNDARY      │   │
│  │  BOUNDARY         │   │  (config JSON, no secrets)      │   │
│  └───────────────────┘   └─────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

---

## 1. Runtime Boundary

**Definition:** The boundary between the GRL server process and everything outside it (local agent, CLI, other local processes).

```text
┌─────────────────────────────────────────────┐
│              UNTRUSTED ZONE                 │
│                                             │
│  Agent process  │  CLI process  │  curl...  │
│                                             │
└──────────────────────┬──────────────────────┘
                       │ HTTP (127.0.0.1:8787 only)
                       │ No TLS — loopback-only by design
                       ▼
┌─────────────────────────────────────────────┐
│               GRL RUNTIME (trusted)         │
│                                             │
│  All requests evaluated by:                 │
│  - Capability Firewall (deny-by-default)    │
│  - Capability Graph                         │
│  - Rate Limiter                             │
│  - Adaptive Defense                         │
│  - Trust Engine                             │
│  - Privacy Boundary                         │
│  - Session Manager                          │
│  - Transport Policy                         │
│  - Sandbox                                  │
│  - Execution Engine                         │
└─────────────────────────────────────────────┘
```

**Controls:**
- Server binds to `127.0.0.1` only (`GRL_HOST=127.0.0.1` enforced)
- All requests require valid JSON body
- Maximum body size enforced (`GRL_MAX_BODY_BYTES`)
- Method enforcement (405 on wrong HTTP verb)

**Trust crossing:** Requests entering from local processes are treated as **untrusted** until validated by the full policy pipeline.

---

## 2. Transport Boundary

**Definition:** The boundary between GRL's policy engines and any external network, even via loopback.

```text
┌────────────────────────────────────────────┐
│          GRL INTERNAL (trusted)            │
│                                            │
│  Transport Policy Engine                   │
│  Sandbox Evaluator                         │
│  Execution Engine                          │
│           │                                │
│           │ transport selected by policy,  │
│           │ never by the agent             │
│           ▼                                │
│  Transport Adapter (mock or searxng)       │
└────────────────┬───────────────────────────┘
                 │ loopback HTTP GET only
                 │ (searxng: 127.0.0.1:8080)
                 │ (mock: no egress at all)
                 ▼
┌────────────────────────────────────────────┐
│         UNTRUSTED EXTERNAL COMPONENT       │
│         (SearXNG instance, loopback only)  │
└────────────────────────────────────────────┘
```

**Controls:**
- Transport kind decided by policy, never by the agent
- `baseUrl` must be loopback (`127.0.0.1`, `localhost`, `::1`) — enforced at config load
- `allowBrowser=false`, `allowFilesystem=false`, `allowProcessSpawn=false` for all transports
- Sandbox policy evaluated before any execution
- Timeout enforced via `AbortController`
- No cookies, no custom headers, no redirect following
- Only `GET /search?...` — no POST, no mutation

---

## 3. Sandbox Boundary

**Definition:** The declared permissions surface of each transport adapter, enforced via sandbox policy evaluation.

```text
┌──────────────────────────────────────────────┐
│             SANDBOX POLICY                   │
│                                              │
│  Per transport kind:                         │
│    mock:    allowNetwork=false               │
│             allowFilesystem=false            │
│             allowProcessSpawn=false          │
│             allowBrowser=false               │
│                                              │
│    searxng: allowNetwork=true (loopback)     │
│             allowFilesystem=false            │
│             allowProcessSpawn=false          │
│             allowBrowser=false               │
└──────────────────────┬───────────────────────┘
                       │ evaluate() → allow / deny
                       ▼
              Transport Adapter execution
              (denied → execution_sandbox_denied)
```

**Controls:**
- `TransportCapabilityRegistry.evaluateSandbox()` runs before every execution
- Manifest permissions must match declared sandbox policy
- Mismatched or undeclared transports are denied (fail-closed)

---

## 4. Compartment Boundary

**Definition:** The isolation boundary between identity compartments. No data, session, cookie, or trust state crosses compartment boundaries.

```text
┌─────────────────────┐    ┌─────────────────────┐
│  Compartment A      │    │  Compartment B       │
│                     │    │                      │
│  sessionId: A-001   │    │  sessionId: B-001    │
│  trustScore: 70     │    │  trustScore: 45      │
│  transport: mock    │    │  transport: searxng  │
│  cookieJar: {}      │    │  cookieJar: {}       │
└─────────────────────┘    └─────────────────────┘
         │                           │
         │   NO SHARED STATE         │
         └─────────────┬─────────────┘
                       │
              Privacy Boundary Engine
              (cross-compartment → block
               or require_approval by default)
```

**Controls:**
- `PrivacyBoundaryEngine` evaluates cross-compartment access
- Missing `(source, target)` rule → fail-closed (block)
- Unknown target compartment → block
- Cross-compartment signal → `actionOnViolation` (require_approval or block)
- Sessions never shared between compartments
- Trust scores maintained independently per compartment

---

## 5. CLI / Operator Boundary

**Definition:** The boundary between the human operator (using the CLI) and the GRL runtime.

```text
┌─────────────────────────────────┐
│       OPERATOR (human)          │
│                                 │
│  grl health                     │
│  grl trust                      │
│  grl audit                      │
│  grl runtime reload             │
└───────────────┬─────────────────┘
                │ HTTP GET/POST (127.0.0.1:8787)
                │ Read-only inspection endpoints
                │ POST /v1/runtime/reload (controlled)
                ▼
┌─────────────────────────────────┐
│         GRL RUNTIME             │
│                                 │
│  Returns metadata only          │
│  (no tokens, no raw inputs)     │
└─────────────────────────────────┘
```

**Controls:**
- CLI connects only to `127.0.0.1`
- All responses contain metadata only — no tokens, no raw request payloads
- `POST /v1/runtime/reload` operates on the already-configured file path only; no body accepted
- CLI never stores state, cache, or session information
- No telemetry, analytics, or cloud connectivity

---

## 6. Filesystem Boundary

**Definition:** The boundary between the GRL runtime and the local filesystem.

```text
┌──────────────────────────────────────────────────┐
│                   FILESYSTEM                     │
│                                                  │
│  grl.config.json      ← read-only at load/reload │
│  (no secrets stored)                             │
│                                                  │
│  NOT stored by GRL:                              │
│    - tokens                                      │
│    - session IDs                                 │
│    - raw query inputs                            │
│    - search results                              │
│    - audit events (in-memory only)               │
└───────────────────────┬──────────────────────────┘
                        │ fs.readFile (local JSON only)
                        │ fs.watch (optional hot-reload)
                        ▼
┌──────────────────────────────────────────────────┐
│           RuntimeConfigLoader                    │
│                                                  │
│  loadFromFile() → validate → freeze → snapshot  │
│  No URL access. No remote YAML.                  │
│  Fail-closed on invalid or missing file.         │
└──────────────────────────────────────────────────┘
```

**Controls:**
- Config loader accepts only a local filesystem path, never a URL
- File is parsed as JSON only (no YAML, no TOML, no exec)
- Deep-frozen immutable snapshot after load — no runtime mutation
- SHA-256 checksum over canonical JSON for integrity verification
- Config contains no secrets (no tokens, no API keys, no credentials)

---

## 7. Config Boundary

**Definition:** The boundary between the runtime configuration and the policy engines derived from it.

```text
┌─────────────────────────────────────────────┐
│          CONFIG FILE (grl.config.json)      │
│          (trusted, operator-controlled)     │
└────────────────────────┬────────────────────┘
                         │ validate → freeze
                         ▼
┌─────────────────────────────────────────────┐
│          IMMUTABLE SNAPSHOT                 │
│          (deep-frozen, checksummed)         │
│                                             │
│  version, loadedAt, checksum, config        │
└────────────────────────┬────────────────────┘
                         │ derive
                         ▼
┌─────────────────────────────────────────────┐
│          POLICY ENGINES (let bindings)      │
│                                             │
│  firewall, routing, privacy, trust, graph,  │
│  rate limiter, adaptive defense, sandbox    │
└─────────────────────────────────────────────┘
```

**Controls:**
- Config never mutated after snapshot creation
- Policy engines derived from snapshot at load time
- Reload replaces all derived engines atomically
- Stateful components (sessions, audit, trust) preserved across reload
- Validation errors → fail-closed (reject, keep old snapshot)

---

## 8. Audit Boundary

**Definition:** The boundary around the audit trail. The audit store is append-only and in-memory.

```text
┌─────────────────────────────────────────────┐
│            ALL POLICY ENGINES               │
│                                             │
│  emit SecurityEvent →                       │
│    - type, severity, timestamp              │
│    - requestId, agentId, compartmentId      │
│    - inputType, inputSizeBytes              │
│    - NO raw content, NO tokens              │
└────────────────────────┬────────────────────┘
                         │ append-only
                         ▼
┌─────────────────────────────────────────────┐
│            AUDIT STORE (in-memory)          │
│                                             │
│  AuditStore.append() — no delete, no edit   │
│  GET /v1/audit/events — metadata only       │
│  GET /v1/audit/events/:id — single event    │
└─────────────────────────────────────────────┘
```

**Controls:**
- Audit events are append-only (no delete, no update)
- Events contain metadata only — never raw inputs, tokens, or secrets
- `inputSizeBytes` recorded instead of raw content
- Config audit events emitted directly to store (not via heuristics) to prevent feedback loops
- In-memory: does not persist across server restarts (by design — no durable storage)
