# Sprint 35 — Architectural Pivot: GRL as Universal Agent Gateway

**Status:** Analysis sprint — NO code changes, NO commits, NO push. Awaiting human validation.  
**Branch:** `feat/grl-universal-gateway`  
**Date:** 2026-06-09  
**Scope:** Full architectural audit + pivot proposal

---

## Table of Contents

1. [Current Coupling Audit](#1-current-coupling-audit)
2. [Gateway Mode Concept](#2-gateway-mode-concept)
3. [Client Type Abstraction](#3-client-type-abstraction)
4. [`grl-proxy` Architectural Base](#4-grl-proxy-architectural-base)
5. [OpenAI-Compatible Endpoint Architecture](#5-openai-compatible-endpoint-architecture)
6. [Proxy Runtime Layer Architecture](#6-proxy-runtime-layer-architecture)
7. [CLI Wrapper Architecture](#7-cli-wrapper-architecture)
8. [MCP Isolation Strategy](#8-mcp-isolation-strategy)
9. [Product Positioning Clarifications](#9-product-positioning-clarifications)
10. [Architecture Verification](#10-architecture-verification)

---

## Deliverables Summary

| Deliverable | Status |
|---|---|
| Full architectural report | This document |
| Diff stat | 0 source files changed; this report (`docs/audits/sprint-35-universal-gateway.md`) is the only new artifact |
| Modified files | None |
| New components / abstractions | Enumerated in §2–8 as code blocks, not written to disk |
| Intentionally NOT implemented | §5.3, §6.3, §8.3 |
| Technical risks | §1 (per coupling) + §10.3 |
| Future compatibility estimate | §10.2 |
| `grl-proxy` proposal | §4 |
| Roadmap | §10.4 |

---

## 1. Current Coupling Audit

### 1.1 CapabilityTool — Closed Literal Union ★★★ CRITICAL

**Location:** `packages/core/src/capability-firewall/types.ts:1`

```typescript
export type CapabilityTool = 'search' | 'fetch_html' | 'fetch_json';
```

**Blast radius** — verified by `grep -rln "CapabilityTool"` on source files (dist excluded):
- `packages/core/src/capability-firewall/types.ts` — definition
- `packages/core/src/capability-firewall/index.ts`
- `packages/core/src/capability-graph/types.ts`
- `packages/core/src/capability-graph/engine.ts`
- `packages/core/src/adaptive-defense/types.ts`
- `packages/core/src/approval-queue/types.ts`
- `packages/core/src/privacy-boundary/types.ts`
- `packages/core/src/transport-policy/types.ts`
- `packages/core/src/transport-registry/types.ts`
- `packages/core/src/transport-registry/registry.ts`
- `packages/core/src/execution/types.ts`
- `packages/core/src/index.ts`
- `apps/grl-server/src/local-api.ts`

Note: `packages/agent-sdk` does NOT directly import `CapabilityTool`; it uses `string` in its request shapes.

**What this prevents:** Any tool an external agent emits that is not one of these three strings is **unrepresentable** in the type system. An aider `bash_command`, a Claude Code `str_replace_editor`, an OpenAI function call — none can even be *named*, let alone evaluated. The deny-by-default policy still holds (an unknown string hits no allow rule → deny), but the *architecture* cannot model "what was attempted."

**Decoupling recommendation:**
Open to `string` + a capability registry. The closed union was the right call for Phase 1 (controlled surface), but it is the single biggest barrier to universal gateway. The security property survives: the registry starts empty; an unregistered tool has no allow rule → deny.

```typescript
// Proposed replacement in packages/core/src/capability-firewall/types.ts
export type CapabilityTool = string;  // open
export const WELL_KNOWN_TOOLS = ['search', 'fetch_html', 'fetch_json'] as const;

export interface CapabilityToolDescriptor {
  id: CapabilityTool;
  riskCategory: 'read' | 'write' | 'execute' | 'network';
  requiresApproval: boolean;
}
```

No code outside `capability-firewall/` needs to know the registry exists. All other packages hold strings, not the union.

---

### 1.2 TransportKind — Closed Literal Union ★★ HIGH

**Location:** `packages/core/src/execution/types.ts`

```typescript
export type TransportKind = 'mock' | 'direct' | 'tor' | 'proxy' | 'searxng' | 'browser';
```

**Observation:** The legacy `packages/transport-router/src/index.ts` already implements real SOCKS5 for `direct`, `tor`, and `proxy`. The active core pipeline (`packages/core/`) has its own `TransportAdapter` interface and `MockTransportAdapter` — these two implementations are diverged and not connected. `TransportRouter` from the legacy package is never used by `local-api.ts`; instead, `local-api.ts` builds a `MockTransportAdapter` or a custom `SearXngTransportAdapter` inline.

**Impact:** Adding a new transport (e.g., an HTTP CONNECT proxy, a custom SOCKS5-without-Tor, a named relay) requires modifying `TransportKind` and every switch/exhaustive-check over it.

**Decoupling recommendation:** Same approach as tools — open to `string`, keep the registry as the security boundary. The `TransportAdapter` interface in core is already close to right:

```typescript
// Already correct — just open the kind field
export interface TransportAdapter {
  kind: string;  // was: TransportKind
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}
```

---

### 1.3 Hardcoded Identity — `'local-agent'` / `'research'` ★★★ CRITICAL

Every bootstrap configuration in the codebase hardcodes the same identity:

| File | Coupling |
|---|---|
| `packages/core/src/runtime-config/bootstrap.ts` | `agentId: 'local-agent'`, compartment `'research'` |
| `packages/core/src/runtime-profiles/packs.ts` | `BALANCED_DEFAULT_PACK` and `STRICT_DEFENSE_PACK` both embed `agentId: 'local-agent'`, `compartmentId: 'research'` in `firewallPolicies` |
| `packages/core/src/capability-graph/bootstrap.ts` | `BOOTSTRAP_DEPENDENCY_ISOLATION_POLICY` hardcodes `compartmentId: 'research'` |
| `apps/grl-server/src/local-api.ts` | `BOOTSTRAP_POLICY = { agentId: 'local-agent', ... }` |
| `packages/agent-sdk/src/types.ts` | `DEFAULT_SDK_CONFIG = { agentId: 'local-agent', compartmentId: 'research' }` |

**Impact:** A universal gateway that receives a request from aider identifying itself as `agentId: 'aider-session-42'` will evaluate against a policy table that has no row for it → deny by default. Correct result, wrong reason. There is no way to *register* a new agent without modifying bootstrap code.

**Decoupling recommendation:** The defaults are fine for development and the existing test suite. What is missing is a **dynamic agent registration path** that derives a compartment from the client type (§3) and applies a template policy pack rather than a hardcoded one. The `DEFAULT_SDK_CONFIG` defaults can stay — they are sensible fallbacks for single-agent local use. The problem is that the bootstrap does not apply these defaults dynamically; it generates a one-time static config.

---

### 1.4 `local-api.ts` — 6 659-Line Monolith ★★ HIGH

**Location:** `apps/grl-server/src/local-api.ts`

This file mixes:
- HTTP routing (Express route handlers, request parsing, response formatting)
- Pipeline orchestration (building and wiring all gate instances)
- Factory functions for subsystem construction (`buildBootstrapEngine`, `buildFirewallFromConfig`, etc.)
- In-process state management (audit store, approval queue, incident store, agent runtime)

**Impact:** There is no seam to insert a new entry point (HTTP proxy receiver, MCP adapter, OpenAI endpoint) without touching this file. Any new client type (§3) requires navigating 6 000+ lines to understand what changes. Testing individual pipeline components requires the full server to be up.

**Decoupling recommendation:** Extract in three passes (to be done in implementation, not here):
1. `GrlPipelineFactory` — a single factory class/function that accepts config and returns the wired pipeline. Pure construction, no HTTP.
2. `GrlLocalApiRouter` — the Express router built on top of `GrlPipelineFactory`.
3. `GrlGatewayServer` — thin entry point that starts the server.

This does not require rewriting; it requires extracting functions that already exist in the file into their own modules.

---

### 1.5 Hard Relative Import Path ★ LOW

**Location:** `apps/grl-server/src/local-api.ts:1` (approximately)

```typescript
import { ... } from '../../../packages/core/src/index.js';
```

**Impact:** This is a workspace path hack, not a package import. It works but prevents `grl-server` from depending on a published `@gyges/core` — adding a second server (e.g., `apps/grl-proxy`) would copy this relative path pattern and drift from it. The standard fix is to use the workspace package name: `import { ... } from '@gyges/core'` after ensuring `packages/core/package.json` exports the right entrypoint.

---

### 1.6 Two-Pipeline Ambiguity ★★ HIGH

**The situation:**
- **Legacy pipeline:** `apps/grl-server/src/index.ts` on port 3000. Uses `packages/policy-engine` (YAML), `packages/identity-compartment`, `packages/transport-router` (real SOCKS5).
- **Active pipeline:** `apps/grl-server/src/local-api.ts` on port 8787. Uses `packages/core` end-to-end. All sprint work since Sprint 28 targets this.

**Key observation (verified):** The legacy `transport-router` already implements production-quality SOCKS5 for `direct`, `tor`, and `proxy` transports. Verified by grep: `transport-router` is imported only by `apps/grl-server/src/index.ts` (port 3000). Neither `local-api.ts` nor any file under `packages/core/src/` imports it — the two implementations are entirely diverged. If Tor/proxy support is ever needed in the active pipeline, there are two options: (a) promote `transport-router` to a shared peer of `core`, or (b) reimplement SOCKS5 inside core. Option (a) is obviously correct.

**Recommendation:** Officially deprecate the legacy pipeline in the README. Remove the `npm run start` alias or clearly label it `legacy`. The transport-router package should be promoted — not abandoned.

---

### 1.7 Policy Packs Embed Agent Identity ★★ HIGH

**Location:** `packages/core/src/runtime-profiles/packs.ts`

```typescript
firewallPolicies: [{
  agentId: 'local-agent',
  compartmentId: 'research',
  allowedTools: ['search', 'fetch_html', 'fetch_json'],
  ...
}]
```

Policy packs should be **agent-agnostic templates**. A pack named `BALANCED_DEFAULT` should express "balanced defaults" not "the balanced defaults for local-agent in the research compartment." The agent/compartment binding should happen at apply-time, not at pack-definition time.

---

### 1.8 `examples/local-agent` — Completely Stale ★ MEDIUM

**Location:** `examples/local-agent/src/index.ts`

Hardcodes:
- `http://localhost:3000` (legacy port; active is 8787)
- `/capabilities/execute` (legacy path; active is `/v1/capabilities/execute`)
- `compartment: 'research'` (field renamed to `compartmentId`)

This runs against the legacy pipeline, not the active one. It is the first thing a new developer runs. It must be updated or clearly labeled "legacy example."

---

### 1.9 Coupling Severity Summary

| # | Coupling | Severity | Effort to decouple |
|---|---|---|---|
| 1.1 | `CapabilityTool` closed union | CRITICAL | Medium |
| 1.3 | Hardcoded `'local-agent'`/`'research'` | CRITICAL | Medium |
| 1.6 | Two-pipeline ambiguity / transport-router unused in core | HIGH | Low (docs + wiring) |
| 1.4 | 6 659-line `local-api.ts` monolith | HIGH | Medium |
| 1.7 | Policy packs embed agent identity | HIGH | Low |
| 1.2 | `TransportKind` closed union | HIGH | Low |
| 1.8 | Stale `examples/local-agent` | MEDIUM | Low |
| 1.5 | Hard relative import path | LOW | Low |

---

## 2. Gateway Mode Concept

GRL currently has one mode: the active pipeline on port 8787, with a fixed SDK/HTTP interface. The architectural pivot introduces four operating modes. These are not mutually exclusive — the same GRL instance can expose multiple modes simultaneously.

### Mode 1 — SDK Gateway Mode (current, keep)

**What it is:** GRL exposes its own HTTP API (`/v1/capabilities/*`, `/v1/search`, etc.). Agents use the `@gyges/agent-sdk` or direct HTTP to talk to it. This is the current mode.

**When to use:** Claude Code with GRL SDK integration, internal Gyges orchestrators.

**No changes needed** other than decoupling the closed types (§1.1, §1.2).

---

### Mode 2 — Tool Gateway Mode

**What it is:** GRL exposes a tool-call interception endpoint. The caller POSTs a generic tool call descriptor; GRL applies its full pipeline (capability-graph → firewall → approval → privacy → transport → execution → audit); returns a structured result. The schema is tool-agnostic.

```typescript
// Proposed: packages/core/src/gateway/types.ts
export interface GatewayToolRequest {
  clientType: ClientType;       // §3
  agentId: string;
  compartmentId: string;
  tool: string;                 // open string, not CapabilityTool
  riskLevel: RiskLevel;
  input: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface GatewayToolResponse {
  decision: 'allowed' | 'pending' | 'denied';
  result?: unknown;
  reason?: string;
  auditRef: string;
}
```

**Entry point:** `POST /v1/gateway/tool` — a new route in `local-api.ts` (or extracted router).

---

### Mode 3 — Proxy Mode

**What it is:** GRL acts as an HTTP/HTTPS forward proxy. Agents configured with `HTTP_PROXY=http://127.0.0.1:8788` route all their outgoing traffic through GRL. GRL intercepts, evaluates the request against its pipeline, and forwards or blocks.

**Key constraint:** This is architecturally separate from the SDK pipeline. A proxy mode requires a TCP/HTTP listener that speaks the HTTP CONNECT protocol (for HTTPS tunneling). See §6 for the full architecture.

---

### Mode 4 — Process Wrapper Mode

**What it is:** GRL wraps an agent process, injecting environment variables (`HTTP_PROXY`, `HTTPS_PROXY`, `MCP_ENDPOINT`) and intercepting tool calls via MCP adapter or proxy. See §7 for CLI architecture.

---

## 3. Client Type Abstraction

GRL must identify which type of client is connecting without letting that identification affect the security invariants.

### 3.1 ClientType Enumeration

```typescript
// Proposed: packages/core/src/gateway/client-type.ts
export type ClientType =
  | 'aider'
  | 'claude-code'
  | 'openai-sdk'
  | 'cursor'
  | 'hermes'
  | 'grl-sdk'       // native @gyges/agent-sdk
  | 'mcp-client'    // any MCP-capable agent
  | 'generic-http'  // anything else speaking HTTP
  | 'unknown';

export interface ClientIdentity {
  clientType: ClientType;
  detectedFrom: 'user-agent' | 'header' | 'explicit' | 'inference';
  raw: string;
}
```

### 3.2 Detection Heuristics

Detection is **metadata-only**, **non-authoritative**, and **not a security control**. The identified client type affects:
- What audit label is applied to requests
- What UX hint the operator sees in `grl agents list`
- Which policy template *the operator* may choose to apply at manual registration time

Detection does **NOT** affect capability grants. Grants come exclusively from the explicit per-agent policy registered by the operator (or denied by default if absent). A client that lies about its `User-Agent` gets the policy it was registered with — nothing more, nothing less. If it was never registered: deny.

```typescript
// packages/core/src/gateway/client-type.ts
export function detectClientType(headers: Record<string, string>): ClientIdentity {
  const ua = headers['user-agent'] ?? '';
  const xClient = headers['x-grl-client'] ?? '';

  // x-grl-client is self-declared; still non-authoritative but explicit
  if (xClient) {
    return { clientType: normalizeClientType(xClient), detectedFrom: 'header', raw: xClient };
  }
  if (ua.includes('aider')) return { clientType: 'aider', detectedFrom: 'user-agent', raw: ua };
  if (ua.includes('claude-code')) return { clientType: 'claude-code', detectedFrom: 'user-agent', raw: ua };
  if (ua.includes('openai-python') || ua.includes('openai-node')) {
    return { clientType: 'openai-sdk', detectedFrom: 'user-agent', raw: ua };
  }
  if (ua.startsWith('@gyges/agent-sdk')) return { clientType: 'grl-sdk', detectedFrom: 'user-agent', raw: ua };
  return { clientType: 'unknown', detectedFrom: 'inference', raw: ua };
}
```

### 3.3 Policy Template Resolution

`CLIENT_POLICY_TEMPLATES` is a **structural hook for operator convenience**, not an automatic grant mechanism. Templates define the *shape* of a policy (which fields to populate) but all values default to deny. Actual `allowedTools`, `maxRisk`, and other grants are set by the operator at registration time.

```typescript
// packages/core/src/gateway/policy-templates.ts

export interface PolicyTemplate {
  // Structural hint only. All fields default to deny.
  // Operator must explicitly populate allowedTools and maxRisk.
  suggestedRiskLevel: RiskLevel;
  requiredFields: string[];
}

// Every client type starts from deny. No implicit grants.
export const CLIENT_POLICY_TEMPLATES: Record<ClientType, PolicyTemplate> = {
  'aider':          { suggestedRiskLevel: 'medium', requiredFields: ['allowedTools', 'compartmentId'] },
  'claude-code':    { suggestedRiskLevel: 'medium', requiredFields: ['allowedTools', 'compartmentId'] },
  'openai-sdk':     { suggestedRiskLevel: 'low',    requiredFields: ['allowedTools', 'compartmentId'] },
  'grl-sdk':        { suggestedRiskLevel: 'high',   requiredFields: ['allowedTools', 'compartmentId'] },
  'mcp-client':     { suggestedRiskLevel: 'low',    requiredFields: ['allowedTools', 'compartmentId'] },
  'generic-http':   { suggestedRiskLevel: 'low',    requiredFields: ['allowedTools', 'compartmentId'] },
  'cursor':         { suggestedRiskLevel: 'low',    requiredFields: ['allowedTools', 'compartmentId'] },
  'hermes':         { suggestedRiskLevel: 'medium', requiredFields: ['allowedTools', 'compartmentId'] },
  'unknown':        { suggestedRiskLevel: 'low',    requiredFields: ['allowedTools', 'compartmentId'] },
};
// Actual allowedTools are set by the operator in config, not derived from ClientType.
```

---

## 4. `grl-proxy` Architectural Base

### 4.1 Package Proposal

```
apps/
  grl-proxy/           # NEW — HTTP forward proxy + OpenAI-compat endpoint
    src/
      index.ts         # entry: starts proxy server (default port 8789)
      proxy-server.ts  # HTTP CONNECT handler (Mode 3)
      openai-compat.ts # OpenAI-compatible routes (Mode 2 variant, §5)
      client-type.ts   # header-based client detection
      pipeline-bridge.ts  # calls GRL Local API on 8787 for every intercepted request
    package.json
    tsconfig.json
```

### 4.2 Responsibilities

- Accept `HTTP CONNECT` tunnels and HTTP forward proxy requests
- For each intercepted request: derive `agentId`/`compartmentId` from connection metadata, call GRL Local API (`POST /v1/gateway/tool`) for a policy decision, forward or block
- Expose `/v1/chat/completions` and `/v1/responses` — passthrough with policy gate (see §5)
- NO pipeline logic inside `grl-proxy` — it is a **thin adapter**. All policy evaluation stays in `local-api.ts` (port 8787)
- NO mock runtime. If `local-api.ts` is not running, proxy refuses connections (fail-closed)

### 4.3 grl-proxy Interface with Core

```typescript
// apps/grl-proxy/src/pipeline-bridge.ts
// The ONLY interface grl-proxy uses to communicate with the GRL runtime
export interface GrlBridge {
  evaluateRequest(req: ProxyRequest): Promise<PolicyDecision>;
}

export interface ProxyRequest {
  clientType: ClientType;
  agentId: string;
  compartmentId: string;
  targetUrl: string;
  method: string;
  headers: Record<string, string>;
  bodyPreview?: string;  // first N bytes, for tool detection — NOT stored
}

export interface PolicyDecision {
  decision: 'allow' | 'deny' | 'pending';
  transport: string;       // assigned by policy, never by agent
  auditRef: string;
  reason?: string;
}
```

The bridge implementation calls `POST http://127.0.0.1:8787/v1/gateway/proxy-eval` (a new route to be added to `local-api.ts`).

---

## 5. OpenAI-Compatible Endpoint Architecture

### 5.1 Scope Clarification — Critical

There is a fundamental ambiguity in "OpenAI-compatible endpoint" that must be resolved before implementation:

**Option A — Proxy the model inference call.**  
GRL intercepts `POST /v1/chat/completions` sent by an agent to an upstream LLM (OpenAI, Anthropic, local Ollama). GRL applies a policy gate: does this agent have permission to call an LLM? With what rate limits? GRL then forwards the request and applies output sanitization.

**Option B — Expose a tool-call interception surface.**  
GRL exposes `/v1/chat/completions` as a **synthetic endpoint**. Tool calls emitted by the model (the `function_call` / `tool_calls` field in the response) are extracted and piped through GRL's capability pipeline before execution.

**These are different features.** Option A is proxy mode (§6). Option B is tool gateway mode with an OpenAI-compatible request wrapper. Both are valid; neither is the other.

**This report recommends Option B as the first target** because it does not require HTTPS MITM (see §6 risk), and it creates clear value: an agent using any OpenAI-compatible SDK can route through GRL by pointing `base_url` at GRL.

### 5.2 Proposed Types (contracts only — NOT implemented)

```typescript
// apps/grl-proxy/src/openai-compat.ts

// Inbound — OpenAI-compatible request shape
export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAIToolDef[];
  tool_choice?: string | { type: 'function'; function: { name: string } };
  stream?: boolean;
  // GRL extensions (optional)
  'x-grl-agent-id'?: string;
  'x-grl-compartment-id'?: string;
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIToolDef {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

// Outbound — GRL-evaluated response (wraps upstream model response)
export interface OpenAIChatResponse {
  id: string;
  object: 'chat.completion';
  model: string;
  choices: OpenAIChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  // GRL audit metadata
  'x-grl-decision'?: 'allowed' | 'pending' | 'denied';
  'x-grl-audit-ref'?: string;
}

export interface OpenAIChoice {
  index: number;
  message: OpenAIMessage;
  finish_reason: 'stop' | 'tool_calls' | 'length' | 'grl_denied';
}
```

### 5.3 What Is NOT Implemented (and Why)

- **No fake LLM responses.** GRL does not generate completions. If no upstream model is configured, the endpoint returns `503 Service Unavailable`.
- **No streaming.** SSE streaming is out of scope for the architectural sprint. It is a non-trivial wrapper that is orthogonal to the policy architecture.
- **No function execution.** The endpoint intercepts tool calls, pipes them through GRL's capability pipeline, but does NOT execute them inline. Execution happens via the standard capability pipeline in `local-api.ts`.
- **No auth proxying.** GRL does not forward `Authorization: Bearer sk-...` headers to upstream. The caller configures its own API key separately.

---

## 6. Proxy Runtime Layer Architecture

### 6.1 What Is Needed

To support `HTTP_PROXY` / `HTTPS_PROXY` style interception:
- A TCP listener that accepts HTTP/1.1 CONNECT tunnels (for HTTPS)
- A plain HTTP forward proxy for HTTP requests
- Request evaluation via the GRL policy pipeline before any bytes are forwarded

### 6.2 Architecture

```
Agent process
  env: HTTP_PROXY=http://127.0.0.1:8789
  env: HTTPS_PROXY=http://127.0.0.1:8789
       │
       │ HTTP CONNECT target.example.com:443
       ▼
grl-proxy (port 8789) — apps/grl-proxy
  │
  ├── ClientType detection (User-Agent / X-GRL-Client header)
  ├── POST http://127.0.0.1:8787/v1/gateway/proxy-eval  ──► GRL Local API
  │     PolicyDecision: { decision: 'allow', transport: 'direct', auditRef }
  │
  ├── decision == 'deny'  → 403 Forbidden (no bytes forwarded)
  ├── decision == 'pending' → 202 + poll URL
  └── decision == 'allow'  → forward via assigned transport
         transport == 'direct'  → native Node fetch/http
         transport == 'tor'     → packages/transport-router SOCKS5 (existing code!)
         transport == 'proxy'   → packages/transport-router SOCKS5 (existing code!)
```

**Key point:** The `transport-router` package already has a production-quality SOCKS5 implementation for `direct`, `tor`, and `proxy`. `grl-proxy` should consume it, not reinvent it. This is the "promote transport-router" recommendation from §1.6.

### 6.3 What Is NOT Implemented (and Why)

- **No HTTPS MITM.** Intercepting HTTPS content (not just the CONNECT tunnel) requires generating per-domain TLS certificates at runtime. This is a substantial security-sensitive feature (it makes GRL a man-in-the-middle, by design, but with all the risks that entails). It is in scope for a future sprint but **not part of this architecture proposal.** Without MITM, GRL can allow/deny the tunnel but cannot inspect request bodies over HTTPS.
- **No transparent proxy.** iptables/nftables redirection to create a transparent (non-configured) proxy is out of scope.
- **No `HTTP_PROXY` autodetection injection.** The CLI wrapper (§7) handles env-var injection; the proxy itself is passive.

---

## 7. CLI Wrapper Architecture

### 7.1 Proposed Commands

```bash
# Wrap a process with GRL proxy env vars injected
grl exec -- aider --model gpt-4o
grl exec -- claude --dangerously-skip-permissions
grl exec -- cursor .

# Shorthand aliases (thin wrappers)
grl aider [aider-args...]
grl claude-code [cc-args...]
grl wrap <command> [args...]
```

### 7.2 Architecture

Each wrapper command:
1. Starts `grl-proxy` if not already running (or verifies it is reachable)
2. Injects environment variables:
   ```
   HTTP_PROXY=http://127.0.0.1:8789
   HTTPS_PROXY=http://127.0.0.1:8789
   GRL_AGENT_ID=<derived from command + pid>
   GRL_COMPARTMENT_ID=<derived from command or --compartment flag>
   ```
3. Spawns the wrapped process as a child, inheriting stdio (no piping of output)
4. On process exit, flushes the audit log and prints a summary

```typescript
// apps/grl-cli/src/commands/exec.ts (proposed)
export interface ExecOptions {
  compartment?: string;
  agentId?: string;
  profile?: string;   // GRL_PROFILE to apply
  noProxy?: boolean;  // use MCP adapter instead of HTTP proxy
}
```

### 7.3 Conventions

- `grl exec --` uses `--` as the separator between GRL flags and the wrapped command (POSIX convention; the CLI already uses Commander which supports this).
- The wrapped process is identified by the executable name for `ClientType` detection.
- No shell spawning without `--` or explicit command — `grl exec aider` is an error; `grl exec -- aider` is correct.
- All GRL env vars are prefixed `GRL_` to avoid collisions.

### 7.4 New CLI Module Structure

```
apps/grl-cli/src/commands/
  exec.ts    # NEW: grl exec -- <cmd> [args]
  wrap.ts    # NEW: grl wrap <name> [args] (alias registry)
```

No changes to existing command modules.

---

## 8. MCP Isolation Strategy

### 8.1 Principle

GRL must NOT depend on MCP. MCP is an adapter format — one of N ways a client can express a capability request. GRL's pipeline is transport-agnostic; MCP is just another entry point that normalizes to a `GatewayToolRequest` (§2).

### 8.2 Proposed Architecture

```
MCP Client (e.g., Claude Desktop, cline)
  │
  │ MCP protocol (JSON-RPC over stdio or HTTP/SSE)
  ▼
packages/mcp-adapter/ (NEW — optional, isolated)
  │ Normalizes MCP tool calls to GatewayToolRequest
  ▼
POST http://127.0.0.1:8787/v1/gateway/tool
  │
  ▼
GRL Core Pipeline (capability-graph → ... → execution → audit)
```

### 8.3 Isolation Rules

1. `packages/mcp-adapter` MUST NOT import from `packages/core`. It is a protocol translator that talks to GRL via HTTP only.
2. `packages/core` MUST NOT import from `packages/mcp-adapter`. Zero dependency in the other direction.
3. MCP adapter is an optional workspace package — not listed as a dependency of `grl-server` or any core package. It is started separately (`npm run mcp-adapter` or as a sidecar to `grl-proxy`).
4. GRL's test suite must pass with `packages/mcp-adapter` absent.

### 8.4 What Is NOT Implemented (and Why)

The MCP adapter is an **architecture proposal only.** MCP's SDK has its own versioning and update cadence. Integrating it prematurely before the core gateway abstraction (§2, §3) is stable would create exactly the coupling this sprint aims to eliminate.

---

## 9. Product Positioning Clarifications

### 9.1 Current README Problems

The README description is accurate but narrow:

> "local-first capability firewall and identity compartmentalization gateway for AI agents performing private web research"

The phrase "private web research" creates the impression GRL is a specialized tool for web search agents only. The architectural pivot shows GRL is a general-purpose capability execution layer — web research is one use case, not the definition.

### 9.2 Proposed README First Paragraph Replacement

```
GRL (Gyges Research Layer) is a local-first security, privacy and capability
gateway for AI agents. It sits between any AI agent and the capabilities it
requests — network access, tool execution, web search — and enforces a
deny-by-default, fail-closed policy pipeline before any request is executed.

GRL is not an orchestrator. It does not generate responses or manage
conversations. It is a defensive execution layer: agents express what they
want to do; GRL decides whether, how, and with what privacy guarantees it
is allowed.
```

### 9.3 Architecture Section: Two-Pipeline Disambiguation

Add a boxed note to the README architecture section:

> **Two server modes exist.**
> - `npm run dev:server` — Active pipeline (port 8787, `local-api.ts`). This is what all sprints since Sprint 28 target. Use this.
> - `npm run start` — Legacy pipeline (port 3000, Sprint 2 design). Kept for reference. The `transport-router` package (real SOCKS5) is wired here.

### 9.4 `GRL DOES NOT` Section Update

Add:
```
GRL IS NOT:
- An orchestrator or conversation manager
- A chatbot or assistant
- An anonymity system (not Tor, not a VPN)
- A crawler or scraper
- An OpenAI API replacement (the OpenAI-compatible endpoint is a policy gate, not a model)
```

### 9.5 `docs/roadmap.md` Overhaul

The roadmap currently documents only Sprints 1–2. It must be updated to reflect actual Sprint history (Sprints 1–34) and the forward roadmap. This is a documentation-only change; it does not require validation of this architectural report.

---

## 10. Architecture Verification

### 10.1 Modularity and Composability Assessment

| Principle | Current State | Target State |
|---|---|---|
| Deny-by-default | ✓ Preserved in all gates | ✓ No change needed |
| Fail-closed | ✓ ExecutionEngine, TransportRouter | ✓ No change needed |
| Transport decided by policy | ✓ Agent cannot assert transport | ✓ No change needed |
| Compartment isolation | ✓ No shared sessions | ✓ No change needed |
| Immutable runtime state | ✓ Deep-frozen config | ✓ No change needed |
| Deterministic evaluation | ✓ No ML/randomness | ✓ No change needed |
| Local-only | ✓ No telemetry | ✓ No change needed |
| CapabilityTool extensibility | ✗ Closed union | Open string + registry |
| TransportKind extensibility | ✗ Closed union | Open string + registry |
| Agent-agnostic policy packs | ✗ Hardcoded identity | Template + instantiation |
| Multi-mode entry points | ✗ Single HTTP API | SDK / Tool / Proxy / Wrapper |
| Client type awareness | ✗ None | Metadata-only detection |

All seven core design invariants are preserved by the proposed changes. The changes are purely additive extensions to the surface area — the security model is unchanged.

### 10.2 Future Compatibility Estimate

| Client | SDK Mode | Tool Gateway | Proxy Mode | CLI Wrapper | MCP |
|---|---|---|---|---|---|
| `@gyges/agent-sdk` (current) | ✓ now | ✓ after §2 | n/a | n/a | n/a |
| Claude Code | — | ✓ after §2 | ✓ after §6 | ✓ after §7 | ✓ after §8 |
| Aider | — | ✓ after §2 | ✓ after §6 | ✓ after §7 | n/a |
| Hermes / OpenCode | — | ✓ after §2 | ✓ after §6 | ✓ after §7 | n/a |
| OpenAI Python SDK | — | ✓ after §5 | ✓ after §6 | ✓ after §7 | n/a |
| Cursor | — | — | ✓ after §6 | ✓ after §7 | n/a |
| MCP-capable agents | — | — | — | — | ✓ after §8 |

### 10.3 Technical Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Opening `CapabilityTool` to `string` breaks strict typing in 8+ modules | MEDIUM | Add `WELL_KNOWN_TOOLS` const array; update type guards to use `as const` narrowing where needed |
| HTTPS proxy without MITM means GRL cannot inspect HTTPS tool call content | HIGH | Clearly documented limitation (§6.3); MITM is a future sprint with threat-model update required |
| Two implementations of transport (legacy transport-router vs core TransportAdapter) will diverge further if not reconciled | MEDIUM | Promote transport-router to core dependency at the same time as the proxy is built |
| `local-api.ts` monolith — extracting the factory is risky if done carelessly | MEDIUM | Extract only (move code, no rewrites); maintain all existing test coverage |
| MCP protocol versioning — MCP SDK updates may require adapter rework | LOW | Isolation rule (§8.3) limits blast radius to the adapter package |
| OpenAI endpoint scope creep — "compatible endpoint" will attract requests to generate real responses | LOW | README and endpoint response must be explicit: GRL is a gate, not a model |

### 10.4 Realistic Roadmap (No Marketing)

**Sprint 35 (this sprint) — Architecture only, no code**
Validate this report. Decide on scope for Sprint 36.

**Sprint 36 — Decouple core types**
- Open `CapabilityTool` to `string` + capability registry
- Open `TransportKind` to `string`
- Decouple policy packs from hardcoded agent identity
- Update `examples/local-agent` to active pipeline
- Update `docs/roadmap.md`

Estimated effort: 2–3 days. Zero breaking API changes. Tests pass.

**Sprint 37 — Pipeline factory + gateway route**
- Extract `GrlPipelineFactory` from `local-api.ts`
- Add `POST /v1/gateway/tool` route (Tool Gateway Mode)
- Add client-type detection (§3)
- Replace hard relative import with workspace package import

Estimated effort: 3–4 days. `local-api.ts` shrinks; behavior unchanged.

**Sprint 38 — `grl-proxy` base**
- Create `apps/grl-proxy` package skeleton
- HTTP forward proxy (HTTP, not HTTPS) + CONNECT tunnel pass-through
- Wire to `/v1/gateway/proxy-eval` on local-api
- Wire `packages/transport-router` as the forwarding transport

Estimated effort: 4–5 days. Real SOCKS5 from transport-router; no reinvention.

**Sprint 39 — CLI wrapper**
- `grl exec -- <cmd>` with env-var injection
- `grl wrap` aliases
- Auto-start grl-proxy if not running

Estimated effort: 2–3 days.

**Sprint 40 — OpenAI-compatible endpoint (Option B)**
- `/v1/chat/completions` passthrough with tool-call interception
- Upstream model configurable; GRL gates tool calls only
- No streaming, no fake responses

Estimated effort: 3–4 days.

**Sprint 41+ — MCP adapter, HTTPS MITM, streaming**
These require threat-model updates and careful security review. Not sequenced here.

---

## Appendix: Files Requiring Changes (not modified in this sprint)

These files will need changes in implementation sprints:

| File | Change Required |
|---|---|
| `packages/core/src/capability-firewall/types.ts` | Open `CapabilityTool` union |
| `packages/core/src/execution/types.ts` | Open `TransportKind` union |
| `packages/core/src/runtime-config/bootstrap.ts` | Template-based agent registration |
| `packages/core/src/runtime-profiles/packs.ts` | Decouple agent identity from packs |
| `packages/core/src/capability-graph/bootstrap.ts` | Remove hardcoded `'research'` compartment |
| `apps/grl-server/src/local-api.ts` | Extract factory; add gateway routes |
| `packages/agent-sdk/src/types.ts` | Keep defaults, add docs |
| `examples/local-agent/src/index.ts` | Update to active pipeline |
| `docs/roadmap.md` | Full overhaul |
| `README.md` | Positioning update (§9) |

**New files/packages (to be created in implementation sprints):**

| Path | Purpose |
|---|---|
| `packages/core/src/gateway/types.ts` | `GatewayToolRequest`, `PolicyDecision` |
| `packages/core/src/gateway/client-type.ts` | `ClientType`, `detectClientType()` |
| `packages/core/src/gateway/policy-templates.ts` | `CLIENT_POLICY_TEMPLATES` |
| `apps/grl-proxy/` | HTTP forward proxy + OpenAI-compat endpoint |
| `apps/grl-cli/src/commands/exec.ts` | `grl exec --` wrapper command |
| `packages/mcp-adapter/` | Optional MCP protocol translator |

---

**STOP — awaiting human validation. No commit, no push.**
