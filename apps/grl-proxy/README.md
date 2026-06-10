# grl-proxy

**Status: architectural skeleton — types only, no runtime implementation.**

`grl-proxy` is the future gateway adapter layer for GRL. It will translate
external agent protocols (HTTP forward proxy, OpenAI-compatible API, MCP,
process wrapper) into calls to the GRL Local API runtime and return policy
decisions to the caller.

---

## What this is

A thin adapter. `grl-proxy` contains no policy logic. Every capability
evaluation goes to the GRL runtime (`apps/grl-server`, `127.0.0.1:8787`).
`grl-proxy` translates, forwards, and returns — nothing else.

```
External agent
  │ (HTTP_PROXY, OpenAI API, MCP, stdin/env)
  ▼
grl-proxy (port 8789 — future)
  │ POST /v1/capabilities/execute
  ▼
GRL Local API (port 8787 — apps/grl-server)
  │
  ▼
Full GRL policy pipeline
(capability-graph → firewall → approval → privacy → transport → execution → audit)
```

## What this is NOT

- Not a second policy engine. All allow/deny decisions happen in `grl-server`.
- Not an LLM or model endpoint. `/v1/chat/completions` will gate tool calls,
  not generate completions.
- Not a fake proxy. Until implemented, nothing here listens on a port.
- Not a replacement for GRL's existing SDK mode.
- Not MCP-dependent. MCP is one optional adapter among others.

## Current contents

```
src/types.ts   — type contracts: ClientType, GrlBridge, BridgeRequest, etc.
src/index.ts   — re-exports all types; no implementation
```

## Future implementation plan

Implementation is gated on the `fix/runtime-integrity-no-mock-fallback` branch
merging first. Real gateway execution against a mock fallback transport is
meaningless and misleading.

Planned order:
1. `fix/runtime-integrity-no-mock-fallback` merges
2. Implement `GrlBridge` HTTP client calling `POST /v1/capabilities/execute`
3. HTTP forward proxy listener (plain HTTP, no HTTPS MITM in MVP)
4. OpenAI-compatible `/v1/chat/completions` tool-call interception
5. `grl exec -- <cmd>` CLI wrapper (`apps/grl-cli`)
6. Optional MCP adapter (`packages/mcp-adapter`, isolated)

## Architecture constraints

- `grl-proxy` MUST NOT import from `packages/core` directly.
- `grl-proxy` communicates with GRL exclusively via HTTP (`GrlBridge`).
- If the GRL runtime is unreachable, `grl-proxy` must fail closed (deny).
- Client type detection (`ClientType`) is metadata only — it grants no
  permissions and does not affect the policy decision.
- HTTPS MITM is out of scope for the initial implementation.

## Key types

See `src/types.ts` for the full contract surface:

- `ClientType` — agent classification (metadata only, no auto-grants)
- `ClientIdentity` — detection result with source annotation
- `GatewayMode` — `sdk | tool | proxy | wrapper`
- `BridgeRequest` / `BridgeResponse` — normalised request/response shape
- `GrlBridge` — the only interface grl-proxy uses to call the GRL runtime
- `GrlProxyConfig` — future proxy configuration shape
- `WrapperOptions` / `InjectedEnv` — future CLI wrapper contracts
- `McpAdapterInterface` — MCP isolation contract
