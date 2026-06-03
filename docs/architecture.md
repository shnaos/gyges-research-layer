# Architecture

Gyges Research Layer (GRL) is a local execution layer between AI agents and
network-facing tools. Sprint 1 proves GRL is a **capability firewall**, not just
a search proxy.

## Packages

- `packages/core` — capability contract (`CapabilityRequest`, `CapabilityDecision`) and the `CapabilityFirewall`.
- `packages/policy-engine` — deny-by-default YAML policy engine and allowlist matching.
- `packages/identity-compartment` — identity compartments and per-compartment session state (Session Manager).
- `packages/search-adapter-searxng` — isolated SearXNG adapter (the only component that talks to the search engine).
- `apps/grl-server` — local HTTP server exposing `POST /capabilities/execute`.

## Data path

1. Agent submits a capability request with `agentId`, `compartment`, `tool`, `riskLevel`, and `input` to `POST /capabilities/execute`.
2. Capability firewall asks the YAML policy engine for a deterministic decision.
3. Deny-by-default: the request is refused unless an explicit allow rule matches.
4. If allowed, the request executes inside a named identity compartment and the session manager records history.
5. The isolated SearXNG adapter performs the search on the agent's behalf — the agent never reaches the search engine directly.

## Current implementation boundaries

- Request-level policy checks only (no continuous runtime sandboxing yet)
- Only low-risk `search` in the `research` compartment is allowed
- In-memory session state
- Local file logging only
- No Tor / transport router yet (planned for a later sprint)
