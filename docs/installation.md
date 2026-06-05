# GRL — Installation Guide

Gyges Research Layer (GRL) is a local-first, privacy-first infrastructure for AI agents performing web research. All processing runs on your machine; no cloud, no telemetry, no external dependencies at runtime.

---

## Requirements

| Requirement | Version |
|-------------|---------|
| Node.js | 20 LTS or later |
| npm | 10 or later |
| OS | Linux, macOS, or Windows (WSL2) |

Check your versions:

```bash
node --version   # must be >= 20.0.0
npm --version    # must be >= 10.0.0
```

---

## Install

```bash
git clone https://github.com/shnaos/gyges-research-layer.git
cd gyges-research-layer
npm install
npm --prefix apps/grl-cli install
```

---

## Build

```bash
npm run build
```

This compiles all packages in dependency order:

- `@gyges/core` — core engines
- `@gyges/policy-engine`, `@gyges/identity-compartment`, `@gyges/transport-router`, `@gyges/search-adapter-searxng`
- `@gyges/agent-sdk` — agent SDK
- `grl-server` — local API server
- `@gyges/grl-cli` — CLI operator interface

Build artifacts land in each package's `dist/` directory.

---

## Launch the runtime

```bash
npm run dev:server
```

The local API server starts on `127.0.0.1:8787`. It binds only to localhost and has no external network access by default.

Optional environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `GRL_HOST` | `127.0.0.1` | Bind address (keep local) |
| `GRL_PORT` | `8787` | TCP port |
| `GRL_PROFILE` | `balanced` | Runtime profile (`strict` \| `balanced` \| `research` \| `development`) |
| `GRL_CONFIG_PATH` | — | Path to a custom runtime config JSON file |
| `GRL_CONFIG_WATCH` | — | Set to `1` to enable hot-reload on config changes |
| `GRL_MAX_BODY_BYTES` | `65536` | Maximum request body size in bytes |

Launch with a specific profile:

```bash
GRL_PROFILE=strict npm run dev:server
GRL_PROFILE=research npm run dev:server
```

---

## CLI usage

In a separate terminal, while the server is running:

```bash
# Health check
npm run cli -- health

# Search (mock transport — no real network needed)
npm run cli -- search "privacy research"

# Audit trail
npm run cli -- audit

# Trust profiles
npm run cli -- trust

# Runtime profile and config
npm run cli -- runtime profile
npm run cli -- runtime reload

# Transports
npm run cli -- transports

# JSON output for scripting
npm run cli -- health --json
npm run cli -- audit --json
```

See [`docs/cli.md`](cli.md) for the full command reference.

---

## SDK install

The `@gyges/agent-sdk` package is published as a local package. To use it in another local project:

```bash
npm install /path/to/gyges-research-layer/packages/agent-sdk
```

Or reference via `file:` in your `package.json`:

```json
{
  "dependencies": {
    "@gyges/agent-sdk": "file:../gyges-research-layer/packages/agent-sdk"
  }
}
```

Basic usage:

```ts
import { GrlAgentClient, isAllowed, isPending } from '@gyges/agent-sdk';

const client = new GrlAgentClient();
const result = await client.search('privacy research');

if (isAllowed(result)) console.log(result.results);
if (isPending(result)) console.log('Approval required:', result.approvalRequestId);
```

---

## Troubleshooting

**`vitest: not found`** — Run `npm install` at the root first.

**`Cannot find module 'commander'`** — Run `npm --prefix apps/grl-cli install`.

**Server not responding** — Check that `npm run dev:server` is running and listening on `127.0.0.1:8787`.

**Build errors** — Ensure Node.js >= 20 and TypeScript >= 5.8. Run `npm run typecheck` to diagnose type errors.

**`DEFAULT_RUNTIME_CONFIG` not found** — Run `npm run build:core` to regenerate `packages/core/dist/`.

---

## Verify your installation

```bash
npm run typecheck
npm test
npm run smoke-test
npm run validate:exports
```

All commands should exit with code 0.
