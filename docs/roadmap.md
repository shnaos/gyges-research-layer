# Roadmap

## Sprint 1 (current) — Runnable MVP

- Capability firewall + deny-by-default policy engine
- Identity compartments + session manager
- Isolated SearXNG adapter (no Tor)
- Single `POST /capabilities/execute` endpoint
- Green tests for the allow/deny matrix

## Next — Transport

- Tor / transport router for routed requests
- Per-compartment transport metadata and isolation

## Mid term

- Expand policy conditions (domain rules, rate limits, confirmation hooks)
- Adapter hardening and response sanitization
- Additional search/fetch providers
- Better local observability with structured log utilities

## Long term

- Capability templates for common agent workflows
- Policy simulation and dry-run tooling
- Formalized compartment lifecycle controls
