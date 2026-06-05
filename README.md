# gyges-research-layer

Local-first capability firewall and identity compartmentalization gateway for AI agents performing private web research.

## Why this exists

AI agents doing web research can leak identity, intent, query correlation, and behavioral fingerprints. Gyges Research Layer (GRL) places a defensive layer between agent tools and the web.

## Architecture

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
Transport Router      (packages/transport-router, direct / tor / proxy)
↓
SearXNG Adapter       (packages/search-adapter-searxng, isolated, transport-bound)
↓
Web
```

Server entry point: `apps/grl-server` exposes `POST /capabilities/execute`.

## Sprint 2 status — transport isolation + identity compartmentalization

What GRL now does, on top of the Sprint 1 capability firewall:

- TypeScript monorepo with a single Node.js API server (`apps/grl-server`)
- Deny-by-default capability evaluation through the Capability Firewall
- YAML policy loading from `policies/default.yaml`
- Explicit allow rules by `agentId + compartment + tool + risk`, each bound to a transport
- **Transport Router** selecting `direct`, `tor`, or `proxy` — chosen by policy, never by the agent
- **Tor / proxy routing over SOCKS5** with remote DNS (no local DNS leak) and per-session circuit isolation
- **Fail-closed transports**: if Tor/proxy cannot be established the request is denied, never downgraded to direct
- **Identity compartments** that each own isolated runtime state: `sessionId`, `cookieJar`, `userAgent`, `transport`, `dnsPolicy`
- **Session Manager** lifecycle: create, rotate identity, destroy, idle/TTL expiration
- **Anti-correlation guarantees**: no shared cookies, sessions, or user-agents between compartments; no transport mixing within a compartment
- Isolated SearXNG adapter that receives only a sanitized query and a transport-bound fetch client — it never sees the agent, compartment, or policy
- A single capability entry point: `POST /capabilities/execute`
- Local-only log file output (`logs/grl.log`)
- Docker Compose for local SearXNG
- Example local agent client

What this still does **not** do (by design — see Non-goals in the roadmap):
- No VPN, multi-hop routing, browser automation, scraping, or fingerprint spoofing
- It is not a privacy browser and does not guarantee anonymity
- It has no auth, database, UI, or cloud telemetry

## Transports

The transport is decided internally from policy + compartment + session — the
agent only ever requests a `tool`. Supported transports:

| Transport | Routing | DNS |
| --------- | ------- | --- |
| `direct`  | system network | system resolver |
| `tor`     | SOCKS5 (default `127.0.0.1:9050`) with per-session circuit isolation | remote (via Tor) |
| `proxy`   | SOCKS5 (configurable) | remote (via proxy) |

If a policy binds a capability to `tor` and Tor is unreachable, the request is
denied (`502`). There is no silent fallback to `direct`.

## Principles

- deny-by-default
- no implicit capability
- no cloud dependency
- no tracking
- no remote telemetry
- no hidden external calls
- deterministic policy decisions
- explicit `agentId`, `compartment`, `tool`, `riskLevel` for every request
- transport decided by policy, never by the agent
- fail-closed transports, no silent downgrade, no implicit transport escalation
- no cross-compartment state sharing (cookies, sessions, user-agents, transport)
- privacy layer, not anonymity guarantee

## CLI Quickstart (Sprint 18)

The GRL CLI provides a local operator interface to inspect and control the GRL runtime without a web UI.

```bash
# Start the local API server (in one terminal)
npm run dev:server

# In another terminal — check runtime health
npm run cli -- health

# Run a search through the GRL pipeline
npm run cli -- search "bitcoin privacy"

# List trust profiles
npm run cli -- trust

# Inspect audit events filtered by type
npm run cli -- audit --type execution_failed

# Reload runtime config from disk
npm run cli -- runtime reload
```

JSON output for scripting:

```bash
npm run cli -- trust --json
npm run cli -- search "bitcoin privacy" --json
```

See [`docs/cli.md`](docs/cli.md) for the full command reference, configuration, and error model.

## Quickstart

```bash
npm install
npm run typecheck
npm test
npm run start
```

Optional environment:

- `SEARXNG_URL` (default: `http://localhost:8080`)
- `PORT` (default: `3000`)
- `TOR_SOCKS` SOCKS5 endpoint for `tor` transport (default: `127.0.0.1:9050`)
- `PROXY_SOCKS` SOCKS5 endpoint for `proxy` transport (e.g. `127.0.0.1:1080`)
- `TRANSPORT_TIMEOUT_MS` per-request transport timeout

Start the local search engine:

```bash
docker compose -f docker/docker-compose.yml up -d searxng
```

## Capability API

The only endpoint is `POST /capabilities/execute`. Every request is evaluated by
the firewall and denied unless an explicit allow rule matches. The agent never
chooses its transport: the matched policy rule binds the capability to a
transport, and the compartment is permanently isolated on that transport.

Allowed request (executes the search):

```bash
curl -X POST http://localhost:3000/capabilities/execute \
  -H 'Content-Type: application/json' \
  -d '{
    "agentId":"local-agent",
    "compartment":"research",
    "tool":"search",
    "riskLevel":"low",
    "input":{"query":"ring of gyges"}
  }'
```

Denied request (deny-by-default, returns HTTP 403):

```bash
curl -X POST http://localhost:3000/capabilities/execute \
  -H 'Content-Type: application/json' \
  -d '{
    "agentId":"local-agent",
    "compartment":"personal",
    "tool":"search",
    "riskLevel":"low",
    "input":{"query":"ring of gyges"}
  }'
```

Run the example agent:

```bash
npm --prefix examples/local-agent run start
```

## Documentation

- `/docs/architecture.md`
- `/docs/threat-model.md`
- `/docs/roadmap.md`
- `/CONTRIBUTING.md`

## License

MIT
