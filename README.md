# gyges-research-layer

Local-first capability firewall and identity compartmentalization gateway for AI agents performing private web research.

## Why this exists

AI agents doing web research can leak identity, intent, query correlation, and behavioral fingerprints. Gyges Research Layer (GRL) places a defensive layer between agent tools and the web.

## Architecture

```text
Agent
↓
Capability Firewall
↓
Policy Engine
↓
Identity Compartment
↓
Session Manager
↓
Search / Fetch Adapter
↓
Transport Router
```

## MVP status

What this MVP does:
- TypeScript monorepo with a Node.js API server
- Deny-by-default capability evaluation
- YAML policy loading from `policies/default.yaml`
- Explicit allow rules by `agentId + compartment + tool + riskLevel`
- Identity compartments with per-compartment session state
- Search adapter interface + initial SearXNG adapter
- Fetch HTML adapter
- Transport router abstraction + Tor transport config support
- Local-only log file output (`logs/grl.log`)
- Docker Compose for local SearXNG and optional Tor proxy
- Example local agent client

What this MVP does **not** do:
- It is not a privacy browser
- It does not guarantee anonymity
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

- `GRL_ALLOWED_FETCH_HOSTS` (comma-separated hostnames, default: `example.com`)

Start local dependencies:

```bash
docker compose -f docker/docker-compose.yml up -d searxng
# Optional Tor proxy
# docker compose -f docker/docker-compose.yml --profile tor up -d tor-proxy
```

## Example API calls

Evaluate capability:

```bash
curl -X POST http://localhost:3000/capability/evaluate \
  -H 'Content-Type: application/json' \
  -d '{
    "agentId":"local-agent",
    "compartment":"research-public",
    "tool":"search",
    "riskLevel":"low",
    "input":{"query":"privacy"}
  }'
```

Search:

```bash
curl -X POST http://localhost:3000/search \
  -H 'Content-Type: application/json' \
  -d '{
    "agentId":"local-agent",
    "compartment":"research-public",
    "tool":"search",
    "riskLevel":"low",
    "input":{"query":"ring of gyges"}
  }'
```

Fetch HTML:

```bash
curl -X POST http://localhost:3000/fetch-html \
  -H 'Content-Type: application/json' \
  -d '{
    "agentId":"local-agent",
    "compartment":"research-public",
    "tool":"fetch_html",
    "riskLevel":"medium",
    "input":{"url":"https://example.com"}
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
