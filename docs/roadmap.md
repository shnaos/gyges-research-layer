# Roadmap

## Sprint 1 — Runnable MVP (done)

- Capability firewall + deny-by-default policy engine
- Identity compartments + session manager
- Isolated SearXNG adapter (no Tor)
- Single `POST /capabilities/execute` endpoint
- Green tests for the allow/deny matrix

## Sprint 2 — Transport router + identity isolation (done)

- `packages/transport-router` with `direct`, `tor`, and `proxy` transports
- Tor / proxy routing over SOCKS5 with remote DNS and per-session circuit isolation
- Fail-closed transports — no silent downgrade, no implicit escalation
- Transport-aware policy enforcement (transport mismatch denies)
- Identity compartments owning isolated state (cookies, session, user-agent, transport)
- Session lifecycle: create, rotate identity, destroy, idle/TTL expiration
- Anti-correlation guarantees: no shared cookies/sessions/user-agents, no transport mixing
- Transport-bound, isolated SearXNG adapter

### Non-goals (still out of scope)

VPN support, browser automation / Playwright, scraping frameworks, fingerprint
spoofing, distributed/multi-hop routing, traffic obfuscation, captcha bypass,
stealth automation, and a `fetch_html` tool.

## Mid term

- Expand policy conditions (domain rules, rate limits, confirmation hooks)
- Adapter hardening and response sanitization
- Persisted, per-compartment session storage with secure rotation policies
- Better local observability with structured log utilities

## Long term

- Capability templates for common agent workflows
- Policy simulation and dry-run tooling
- Formalized compartment lifecycle controls
