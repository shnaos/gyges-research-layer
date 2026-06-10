# GRL — Quickstart

Get GRL running in under 5 minutes.

---

## Prerequisites

- Node.js 20 LTS or later
- npm 10 or later

---

## Step 1 — Clone and install

```bash
git clone https://github.com/shnaos/gyges-research-layer.git
cd gyges-research-layer
npm install
npm --prefix apps/grl-cli install
```

---

## Step 2 — Build

```bash
npm run build
```

---

## Step 3 — Start the runtime

```bash
npm run dev:server
```

You should see:

```
GRL Local API listening on 127.0.0.1:8787
```

The server binds only to localhost. No external network access.

---

## Step 4 — Check health

In a second terminal:

```bash
npm run cli -- health
```

Expected output:

```
Status:  ok
Profile: balanced
```

---

## Step 5 — Run a search

```bash
npm run cli -- search "privacy"
```

On a fresh runtime this returns:

```
decision   denied
reason     Denied by default policy.
```

That is **deny-by-default working as designed**: the CLI submits its request as
`agentId: grl-cli` / `tool: web_search`, and the bootstrap firewall ships an
explicit allow rule only for `agentId: local-agent` / `tool: search`. Nothing
reaches execution unless a policy rule permits it.

To see an **allowed** end-to-end flow (decision → mock execution → audit), use
the bootstrap-allowed combination directly:

```bash
curl -s -X POST http://127.0.0.1:8787/v1/capabilities/execute \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"local-agent","compartmentId":"research","tool":"search","riskLevel":"low","input":"privacy"}'
```

It returns `decision: allowed`, runs the mock transport (no real web request),
and records the full audit trail. See [`demo.md`](demo.md) for the annotated
walkthrough. To allow the CLI itself, add a matching `firewallPolicies` rule for
`grl-cli` / `web_search` in your runtime config.

---

## Step 6 — Explore the CLI

```bash
# Audit trail
npm run cli -- audit

# Trust profiles
npm run cli -- trust

# Active runtime profile
npm run cli -- runtime profile

# Available transports
npm run cli -- transports
```

JSON output for scripting:

```bash
npm run cli -- health --json
npm run cli -- search "privacy" --json
```

---

## Step 7 — Use the SDK

```ts
import { GrlAgentClient, isAllowed } from '@gyges/agent-sdk';

const client = new GrlAgentClient(); // defaults to http://127.0.0.1:8787
const result = await client.search('privacy research');

if (isAllowed(result)) {
  console.log(result.results);
}
```

---

## Next steps

- [`docs/installation.md`](installation.md) — detailed install and configuration
- [`docs/packaging.md`](packaging.md) — package layout and build system
- [`docs/distribution.md`](distribution.md) — local distribution and versioning
- [`docs/cli.md`](cli.md) — full CLI command reference
- [`docs/agent-sdk.md`](agent-sdk.md) — full SDK reference
- [`docs/runtime-profiles.md`](runtime-profiles.md) — strict / balanced / research / development profiles
- [`docs/security/threat-model.md`](security/threat-model.md) — security model
