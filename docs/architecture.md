# Architecture

Gyges Research Layer is a local execution layer between AI agents and network-facing tools.

## Data path

1. Agent submits a capability request with `agentId`, `compartment`, `tool`, `riskLevel`, and `input`.
2. Capability firewall asks the YAML policy engine for a deterministic decision.
3. If allowed, request executes inside a named identity compartment.
4. Session manager stores cache/history/transport metadata per compartment.
5. Tool adapters perform search or HTML fetch.
6. Transport router selects direct or tor-configured transport metadata.

## Current implementation boundaries

- Request-level policy checks only (no continuous runtime sandboxing yet)
- In-memory session state
- Local file logging only
