# Architecture

> **Two server implementations exist.** This document describes the **legacy
> pipeline** (Sprint 2 design, port 3000, `npm run start`). The **active
> pipeline** (port 8787, `npm run dev:server`) is driven by `packages/core`
> and is described in the README and in [`docs/gateway.md`](gateway.md).
> All current sprint work targets the active pipeline. The legacy pipeline
> is preserved for reference; `packages/transport-router` (real SOCKS5) is
> wired here and will be promoted to the active pipeline in a future sprint.

Gyges Research Layer (GRL) is a local execution layer between AI agents and
network-facing tools. Sprint 1 proved GRL is a **capability firewall**. Sprint 2
adds the **identity isolation** and **transport routing** layers, so GRL is a
defensive execution layer for AI agents — not a simple search proxy.

## Layered path

```text
Agent
↓
Capability Firewall   (packages/core)
↓
Policy Engine         (packages/policy-engine, deny-by-default + transport enforcement)
↓
Identity Compartment  (packages/identity-compartment)
↓
Session Manager       (packages/identity-compartment)
↓
Transport Router      (packages/transport-router)
↓
Search Adapter        (packages/search-adapter-searxng, isolated, transport-bound)
↓
Web
```

## Packages

- `packages/core` — capability contract (`CapabilityRequest`, `CapabilityDecision`, `TransportType`) and the `CapabilityFirewall`.
- `packages/policy-engine` — deny-by-default YAML policy engine. Matches `agentId + compartment + tool + risk`, enforces a `maxRiskLevel` ceiling, and binds each capability to a transport. A request that asserts a different transport is denied (no escalation).
- `packages/identity-compartment` — `IdentityCompartment`, `CookieJar`, and the `SessionManager` lifecycle (create, rotate, destroy, idle/TTL expiration). Each compartment owns isolated runtime state.
- `packages/transport-router` — selects and constructs transport-bound fetch clients for `direct`, `tor`, and `proxy`. Tor/proxy route over SOCKS5 with remote DNS and per-session circuit isolation. Fail-closed.
- `packages/search-adapter-searxng` — isolated SearXNG adapter. Receives only a sanitized query and a transport-bound client; never sees the agent, compartment, or policy.
- `apps/grl-server` — local HTTP server exposing `POST /capabilities/execute` (built via the `createApp` factory for testability).

## Data path

1. Agent submits a capability request (`agentId`, `compartment`, `tool`, `riskLevel`, `input`) to `POST /capabilities/execute`. It does **not** choose a transport.
2. The Capability Firewall asks the policy engine for a deterministic decision. Deny-by-default: refused unless an explicit allow rule matches. The decision carries the policy-resolved transport.
3. The Session Manager binds (or reuses) the named compartment's isolated identity — `sessionId`, `cookieJar`, `userAgent`, `dnsPolicy` — permanently bound to one transport. Transport mixing is rejected.
4. The Transport Router builds a transport-bound fetch client. For `tor`/`proxy` it establishes a SOCKS5 tunnel with remote DNS (ATYP=domain), using the `sessionId` as the circuit credential. If it cannot, the request fails closed (no fallback to direct).
5. The isolated SearXNG adapter performs the search through that client. The agent never reaches the search engine directly.
6. The Session Manager records per-compartment history.

## Identity isolation & anti-correlation

Each `IdentityCompartment` owns isolated state and **no state is shared across
compartments**:

- separate `CookieJar` per compartment
- distinct `sessionId` per compartment
- a `userAgent` never reused by another live compartment
- a single transport per compartment (no transport mixing)
- `dnsPolicy` of `remote` for `tor`/`proxy` (no local DNS leak)

Identity rotation regenerates the `sessionId`, clears cookies, and rotates the
user-agent. For `tor`, the new `sessionId` becomes a new SOCKS circuit
credential, rebuilding the circuit.

## Transports

```ts
type TransportType = 'direct' | 'tor' | 'proxy';
```

- `direct` — system network and system DNS resolver.
- `tor` — SOCKS5 (default `127.0.0.1:9050`), remote DNS, per-session circuit isolation.
- `proxy` — SOCKS5 (configurable), remote DNS.

The router is extensible but ships exactly these three transports — no VPN or
multi-hop placeholders.

## Security posture

- fail closed
- deny by default
- no silent downgrade / no "temporary direct mode"
- no implicit transport escalation
- no cross-compartment memory leakage

## Current implementation boundaries

- Request-level policy checks (no continuous runtime sandboxing yet)
- In-memory session/compartment state
- Local file logging only
- SOCKS5 transports only (no VPN, no multi-hop)
