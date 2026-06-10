# GRL Universal Gateway Architecture

**Status:** Architecture and planning document. Implementation gated on
`fix/runtime-integrity-no-mock-fallback` merging first.

For the coupling audit and detailed decoupling recommendations that informed
this document, see [`docs/audits/sprint-35-universal-gateway.md`](audits/sprint-35-universal-gateway.md).

---

## Product positioning

GRL is a **local-first security, privacy and capability gateway for AI agents.**
It sits between any AI agent and the capabilities it requests — network access,
tool execution, web search — and enforces a deny-by-default, fail-closed policy
pipeline before any request is executed.

**GRL is:**
- a local-first agent capability gateway
- a capability firewall (deny-by-default, fail-closed)
- a privacy boundary (compartment isolation, anti-correlation)
- a policy enforcement layer (deterministic, no ML, no randomness)
- a transport adapter layer (policy decides transport, agent never does)

**GRL is NOT:**
- an AI assistant or LLM
- a closed orchestrator or conversation manager
- a browser automation framework
- a replacement for Claude Code, Aider, OpenCode, or Hermes
- an anonymity system (not Tor, not a VPN)
- a crawler or web scraper
- a fake OpenAI API that generates completions
- MCP-dependent (MCP is one optional adapter among others)

The architectural distinction: agents express *what they want to do*; GRL
decides *whether, how, and with what privacy guarantees* it is allowed.

---

## Two server modes (disambiguation)

The repository contains two server implementations. Know which you are using:

| | Legacy | Active |
|---|---|---|
| Entry point | `apps/grl-server/src/index.ts` | `apps/grl-server/src/local-api.ts` |
| Port | 3000 | **8787** |
| Start command | `npm run start` | **`npm run dev:server`** |
| Pipeline | Sprint 2 packages (`policy-engine`, `identity-compartment`, `transport-router`) | `packages/core` end-to-end |
| Status | Legacy (kept for reference) | **Active — all current sprint work** |
| Real SOCKS5 | Yes (via `packages/transport-router`) | No (mock + SearXNG only, for now) |

All new development targets the active pipeline on port 8787. The legacy
pipeline is preserved for reference; `packages/transport-router` (real SOCKS5
for `direct`, `tor`, `proxy`) will be promoted to the active pipeline when the
proxy mode is implemented.

---

## Gateway modes

GRL supports four future operating modes. These are not mutually exclusive —
a single GRL instance may expose several simultaneously.

### Mode A — SDK Gateway Mode (current, active)

Agents call GRL directly via the `@gyges/agent-sdk` or any HTTP client.

```
Agent
  │ POST /v1/capabilities/execute (or /v1/search, etc.)
  │ Using @gyges/agent-sdk or direct HTTP
  ▼
GRL Local API (127.0.0.1:8787)
  │
  ▼
Full pipeline: capability-graph → firewall → approval → privacy →
               session → transport-policy → sandbox → execution → audit
```

**Current status:** Active and working.
**No changes needed** beyond decoupling the closed `CapabilityTool` union
(see audit doc §1.1) to support non-web tools.

---

### Mode B — Tool Gateway Mode (planned)

An OpenAI-compatible or generic tool-call interception surface. Agents
configured with GRL's endpoint as their tool execution URL send tool calls;
GRL applies its full pipeline and returns structured results.

```
Agent (any OpenAI-compatible client, or generic tool client)
  │ POST /v1/gateway/tool
  │ { agentId, tool, riskLevel, input }
  ▼
GRL Local API — policy evaluation, privacy layer, transport selection
  │
  ▼
Execution (via registered transport)
  │
  ▼
Structured result: { decision, result?, auditRef }
```

**Key point:** This surface intercepts tool calls emitted *by* the model.
GRL does not fake model completions. The `/v1/chat/completions` endpoint
(see OpenAI-compatible section below) passes completions through; it only
gates the `tool_calls` field before those tools are executed.

**Current status:** Planned. Requires decoupling `CapabilityTool` first.

---

### Mode C — Proxy Mode (planned, HTTP only in MVP)

Agents set `HTTP_PROXY=http://127.0.0.1:8789` and GRL intercepts their
outgoing HTTP requests. HTTPS CONNECT tunnels are passed through without
body inspection in the MVP (no HTTPS MITM).

```
Agent process
  env: HTTP_PROXY=http://127.0.0.1:8789
       │
       │ HTTP forward proxy request
       ▼
grl-proxy (port 8789) — apps/grl-proxy
  │ POST /v1/capabilities/execute
  ▼
GRL Local API (port 8787)
  │ Policy decision
  ▼
grl-proxy: allow → forward via policy-assigned transport
           deny  → 403 Forbidden (no bytes forwarded)
```

**Key point:** `grl-proxy` is a thin adapter. Zero policy logic inside it.
The `packages/transport-router` package (real SOCKS5 for `direct`/`tor`/
`proxy`) will be wired as the forwarding transport.

**HTTPS MITM is out of scope for MVP.** Intercepting HTTPS content requires
generating per-domain TLS certificates at runtime — a substantial security-
sensitive undertaking that requires a threat-model update. Until then, GRL
can allow/deny CONNECT tunnels but cannot inspect HTTPS request bodies.

**Current status:** Type contracts in `apps/grl-proxy/src/types.ts`. No server.

---

### Mode D — Wrapper Mode (planned)

GRL wraps an agent process, injecting environment variables and binding it
to a policy context.

```bash
grl exec -- aider --model gpt-4o
grl exec -- opencode
grl wrap -- claude-code
```

The wrapper:
1. Verifies or starts `grl-proxy`
2. Injects into the child process environment:
   ```
   HTTP_PROXY=http://127.0.0.1:8789
   HTTPS_PROXY=http://127.0.0.1:8789
   GRL_AGENT_ID=<derived from command>
   GRL_COMPARTMENT_ID=<from --compartment flag or config>
   GRL_PROFILE=<from --profile flag or GRL_PROFILE env>
   ```
3. Spawns the wrapped process, inheriting stdio (no piping)
4. On exit: flushes audit log, prints summary

**Conventions:**
- `--` separates GRL flags from the wrapped command (POSIX convention)
- `grl exec aider` is an error; `grl exec -- aider` is correct
- All GRL env vars are prefixed `GRL_` to avoid collisions

**Current status:** Type contracts in `apps/grl-proxy/src/types.ts`. No CLI command yet.

---

## Client type abstraction

GRL can detect the type of agent connecting. Detection is **metadata only**.

### What ClientType affects

- Audit log labels (operators see "aider" not "unknown" in `grl audit`)
- Operator UX hints in `grl agents list`
- Which policy *template* an operator may choose to apply at manual registration

### What ClientType does NOT affect

- Policy decisions (allow/deny)
- Capability grants
- Risk level evaluation
- Transport selection

A client that lies about its `User-Agent` gets the policy it was registered
with. If it was never registered: deny. No privilege escalation is possible
through UA spoofing.

### Detection heuristics (future implementation in `grl-proxy`)

```typescript
// Non-authoritative — for audit labels only
function detectClientType(headers: Record<string, string>): ClientIdentity {
  const ua = headers['user-agent'] ?? '';
  const xClient = headers['x-grl-client'] ?? '';

  if (xClient) return { clientType: normalise(xClient), detectedFrom: 'x-grl-client-header', raw: xClient };
  if (ua.includes('aider'))       return { clientType: 'aider',              detectedFrom: 'user-agent', raw: ua };
  if (ua.includes('claude-code')) return { clientType: 'claude-code',        detectedFrom: 'user-agent', raw: ua };
  if (ua.includes('opencode'))    return { clientType: 'opencode',           detectedFrom: 'user-agent', raw: ua };
  if (ua.includes('hermes'))      return { clientType: 'hermes',             detectedFrom: 'user-agent', raw: ua };
  if (ua.includes('openai'))      return { clientType: 'openai-compatible',  detectedFrom: 'user-agent', raw: ua };
  if (ua.startsWith('@gyges/'))   return { clientType: 'grl-sdk',            detectedFrom: 'user-agent', raw: ua };
  return { clientType: 'unknown', detectedFrom: 'inference', raw: ua };
}
```

See `apps/grl-proxy/src/types.ts` for the full `ClientType` and
`ClientIdentity` type definitions.

---

## OpenAI-compatible endpoint — scope definition

### What it is (Option B — tool-call interception)

GRL's future `/v1/chat/completions` endpoint forwards the request to an
upstream model (OpenAI, Anthropic, local Ollama — configured by the operator),
receives the response, and intercepts any `tool_calls` in the response before
they are executed. Each tool call is piped through GRL's policy pipeline.

```
Agent (using OpenAI SDK, base_url pointing at grl-proxy)
  │ POST /v1/chat/completions
  ▼
grl-proxy
  │ Forward to configured upstream model
  ▼
Upstream model response
  │ Extract tool_calls from choices[].message.tool_calls
  │ For each tool call:
  │   POST /v1/capabilities/execute → GRL policy pipeline
  │   allowed → include result in conversation
  │   denied  → replace with { finish_reason: 'grl_denied' }
  ▼
Return filtered response to agent
```

### What it is NOT

- Not a model. GRL does not generate completions.
- Not a streaming endpoint (out of scope for MVP; SSE adds complexity
  orthogonal to the policy architecture).
- Not an auth key proxy. Callers configure their own API keys; GRL never
  forwards `Authorization: Bearer sk-...` headers to upstream.
- Not an OpenAI replacement. GRL is a policy gate, not a model host.

### Current status

Type contracts only (`OpenAICompatToolCall`, `OpenAICompatResponseFragment`
in `apps/grl-proxy/src/types.ts`). No endpoint implementation.

---

## MCP isolation strategy

MCP is an optional adapter. GRL does not depend on MCP.

### Isolation rules

1. `packages/mcp-adapter` (future) MUST NOT import from `packages/core`.
2. `packages/core` MUST NOT import from `packages/mcp-adapter`.
3. The MCP adapter communicates with GRL exclusively via HTTP (`GrlBridge`).
4. `packages/mcp-adapter` is not listed as a dependency of `grl-server`
   or any core package. It is an optional sidecar.
5. GRL's test suite must pass with `packages/mcp-adapter` absent.
6. MCP must not define GRL's core architecture.

### Architecture

```
MCP-capable agent (e.g. Claude Desktop, cline)
  │ MCP protocol (JSON-RPC over stdio or HTTP/SSE)
  ▼
packages/mcp-adapter (future, optional sidecar)
  │ Normalises MCP tool calls to BridgeRequest
  │ POST /v1/capabilities/execute
  ▼
GRL Local API (127.0.0.1:8787)
  │
  ▼
Full GRL pipeline
```

See `McpAdapterInterface` in `apps/grl-proxy/src/types.ts`.

---

## GrlBridge contract

All gateway adapters (proxy, OpenAI-compat, MCP, CLI wrapper) communicate
with the GRL runtime through a single interface:

```typescript
interface GrlBridge {
  evaluate(request: BridgeRequest): Promise<BridgeResponse>;
  health(): Promise<{ ok: boolean; version?: string }>;
}
```

The implementation calls `POST /v1/capabilities/execute` on the GRL Local API
(`http://127.0.0.1:8787` by default). No policy logic lives in the bridge.
If the GRL runtime is unreachable, the bridge fails closed: returns a
synthetic `denied` response.

See `apps/grl-proxy/src/types.ts` for full type definitions.

---

## Compatibility matrix

Current capability status per agent/client. No compatibility is claimed that
does not exist today.

| Agent / Client | Likely integration mode | Current status | Required future work | Risks |
|---|---|---|---|---|
| **`@gyges/agent-sdk`** | SDK Gateway (Mode A) | Working | Decouple `CapabilityTool` union for non-web tools | None significant |
| **Claude Code** | SDK Gateway, Proxy (Mode A+C), Wrapper (Mode D) | No integration today | `grl-proxy` HTTP listener, `grl exec -- claude-code`, explicit agent registration | claude-code uses its own tool execution; GRL must intercept at proxy layer |
| **Aider** | Proxy (Mode C), Wrapper (Mode D) | No integration today | `grl-proxy` HTTP listener, `grl exec -- aider` | Aider uses `requests`/`httpx`; respects `HTTP_PROXY` env var — low integration friction |
| **OpenCode** | Proxy (Mode C), Wrapper (Mode D) | No integration today | Same as Aider | Behaviour depends on OpenCode's HTTP stack |
| **Hermes Agent** | SDK Gateway (Mode A), Tool Gateway (Mode B) | No integration today | Hermes would need to call `/v1/gateway/tool` or be proxied | API shape TBD pending Hermes public API stabilisation |
| **OpenAI SDK clients** | Tool Gateway (Mode B) | No integration today | `/v1/chat/completions` passthrough with tool-call interception | Streaming clients will need SSE support (out of MVP scope) |
| **Cursor-like agents** | Proxy (Mode C) | No integration today | `grl-proxy` HTTP listener; Cursor embeds its own browser — proxy coverage is partial | Limited to HTTP tool calls; browser automation not interceptable |
| **MCP clients** | MCP adapter (optional sidecar) | No integration today | `packages/mcp-adapter` isolated package | MCP protocol versioning; SDK update cadence |

---

## Roadmap

Realistic sequence. Marketing language removed.

### Phase 0 — prerequisite (other branch)

**`fix/runtime-integrity-no-mock-fallback` must merge first.**

That branch removes mock fallback from the execution path, adds `isReal` to
`TransportAdapter`, and guards `/execute-mock`. Real gateway execution against
a mock transport is meaningless. Nothing in the gateway roadmap below is
trustworthy until the runtime is honest about which transports are real.

### Phase 1 — decouple core types

- Open `CapabilityTool` union to `string` + capability registry
- Open `TransportKind` to `string`
- Decouple policy packs from hardcoded `'local-agent'`/`'research'` identity
- Update `examples/local-agent` to target active pipeline (port 8787, correct paths)
- Overhaul `docs/roadmap.md` to reflect Sprints 1–35 history

Estimated effort: 2–3 days. Zero breaking API changes.

### Phase 2 — pipeline factory + gateway route

- Extract `GrlPipelineFactory` from `local-api.ts` (6 659 lines today)
- Add `POST /v1/gateway/tool` route (Tool Gateway Mode B)
- Add client-type detection middleware (metadata only)

Estimated effort: 3–4 days. Behaviour unchanged; `local-api.ts` shrinks.

### Phase 3 — `grl-proxy` HTTP listener

- Implement `GrlBridge` HTTP client (calls `POST /v1/capabilities/execute`)
- HTTP forward proxy listener (plain HTTP; no HTTPS MITM)
- CONNECT tunnel: pass-through or 405, operator-configurable
- Wire `packages/transport-router` (real SOCKS5) as forwarding transport
- **Promotion of `packages/transport-router` into the active pipeline**

Estimated effort: 4–5 days.

### Phase 4 — OpenAI-compatible endpoint

- `POST /v1/chat/completions` passthrough with `tool_calls` interception
- Upstream model configurable per operator; GRL gates tool calls only
- No streaming, no fake responses, no auth proxying

Estimated effort: 3–4 days.

### Phase 5 — CLI wrapper

- `grl exec -- <cmd>` with env-var injection (HTTP_PROXY, GRL_AGENT_ID, etc.)
- `grl wrap` alias registry
- Auto-start `grl-proxy` if not running

Estimated effort: 2–3 days.

### Phase 6 — SDK hardening

- Workspace package import (`@gyges/core`) instead of hard relative path
- Agent registration API (dynamic registration beyond bootstrap defaults)
- Policy templates as operator-facing config, not hardcoded code

Estimated effort: 2–3 days.

### Phase 7 — optional MCP adapter

- `packages/mcp-adapter` (isolated, optional sidecar)
- Implements `McpAdapterInterface`, calls `GrlBridge`
- No dependency in either direction between `mcp-adapter` and `packages/core`

Estimated effort: 3–4 days + MCP SDK integration time.

---

*This document describes planned architecture. Nothing beyond Phase 0 is
implemented. Do not cite these phases as existing capabilities.*
