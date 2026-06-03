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
Policy Engine         (packages/policy-engine, deny-by-default)
↓
Identity Compartment  (packages/identity-compartment)
↓
Session Manager       (packages/identity-compartment)
↓
SearXNG Adapter       (packages/search-adapter-searxng, isolated)
```

Server entry point: `apps/grl-server` exposes `POST /capabilities/execute`.

## Sprint 1 MVP status

What this MVP does:
- TypeScript monorepo with a single Node.js API server (`apps/grl-server`)
- Deny-by-default capability evaluation through the Capability Firewall
- YAML policy loading from `policies/default.yaml`
- Explicit allow rules by `agentId + compartment + tool + riskLevel`
- Identity compartments with per-compartment session state
- Isolated SearXNG search adapter — the agent never calls the search engine directly
- A single capability entry point: `POST /capabilities/execute`
- Local-only log file output (`logs/grl.log`)
- Docker Compose for local SearXNG
- Example local agent client

What this MVP does **not** do (yet):
- No Tor / transport router (planned for a later sprint)
- It is not a privacy browser and does not guarantee anonymity
- It has no auth, database, UI, or cloud telemetry

## Principles

- deny-by-default
- no implicit capability
- no cloud dependency
- no tracking
- no remote telemetry
- no hidden external calls
- deterministic policy decisions
- explicit `agentId`, `compartment`, `tool`, `riskLevel` for every request
- privacy layer, not anonymity guarantee

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

Start the local search engine:

```bash
docker compose -f docker/docker-compose.yml up -d searxng
```

## Capability API

The only endpoint is `POST /capabilities/execute`. Every request is evaluated by
the firewall and denied unless an explicit allow rule matches. In Sprint 1 the
only allowed capability is low-risk `search` from `local-agent` in the
`research` compartment.

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
