# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Gyges Research Layer (GRL) is a **local-first capability firewall and identity-compartmentalization gateway** that sits between AI agents and the web. Every capability request from an agent runs through a deny-by-default, fail-closed policy pipeline before any network call. GRL is a *privacy layer*, not an anonymity system (not Tor, not a VPN, not a crawler).

Core design invariants — preserve these in any change:
- **deny-by-default / fail-closed** — errors and unevaluated requests produce `deny`, never `allow`.
- **transport decided by policy, never by the agent** — an agent that asserts a transport is rejected (no escalation, no silent downgrade to direct).
- **compartment isolation** — no shared sessions, cookies, user-agents, or state across compartments.
- **immutable runtime state** — config is deep-frozen and checksummed after load; no runtime mutation.
- **deterministic evaluation** — no randomness, no ML, no sampling. Identical inputs → identical decisions. (Where "rotation"/"jitter" exists it is *deterministic*, derived from agent/session identifiers.)
- **local-only** — no cloud, no telemetry, in-memory state, raw query content is never persisted to the audit trail.

`CONTRIBUTING.md` restates these as contribution rules.

## Commands

```bash
npm install
npm --prefix apps/grl-cli install   # CLI has its own install step (CI runs this separately)

npm run build        # builds every package + app in dependency order
npm run typecheck    # tsc --noEmit across all packages; `npm run lint` is an ALIAS for this
npm test             # vitest run (all packages/apps)
npm run smoke-test   # offline runtime validation (config load, profiles, CLI dist, SDK import) — no network
```

Per-package test/build helpers exist (`test:core`, `test:cli`, `test:agent-sdk`, `build:core`, etc.). Run a **single test file or pattern** directly with vitest:

```bash
npx vitest run packages/core/test/capability-firewall.test.ts
npx vitest run -t "denies unknown tool"      # by test name
```

Release gate (also the CI sequence in `.github/workflows/ci.yml`): `typecheck → build → test → smoke-test → validate:security-docs → validate:exports → release-check`. Run `npm run release-check` before declaring a change ship-ready.

There is no ESLint/Prettier — "lint" means TypeScript strict typechecking. Tests live in `<package>/test/**/*.test.ts`; some transport tests open real localhost sockets, so vitest uses a 20s timeout.

## Running the system

```bash
npm run dev:server   # local API on 127.0.0.1:8787 — the ACTIVE server, target of the CLI and SDK
npm run cli -- health
npm run cli -- search "privacy"
```

Useful env vars: `GRL_PROFILE` (`strict|balanced|research|development`, default `balanced`), `GRL_CONFIG_PATH`, `GRL_CONFIG_WATCH=1` (hot-reload), `SEARXNG_URL` (default `http://localhost:8080`). Optional local search engine: `docker compose -f docker/docker-compose.yml up -d searxng`.

## Architecture — important: two pipelines coexist

The repo contains an older multi-package design and a newer core-centric one. **Most active development is in `packages/core`.** Know which one you are touching:

**1. Active pipeline — `packages/core` + `apps/grl-server/src/local-api.ts` (port 8787).**
This is what the CLI (`apps/grl-cli`) and SDK (`packages/agent-sdk`) talk to. The entire request pipeline lives as subdirectories of `packages/core/src/`. Order of gates (each gate also emits a `PolicySignal` consumed by the orchestrator):

```
capability-graph → trust-reputation / adaptive-defense → capability-firewall →
approval-queue → privacy-boundary → session-manager → transport-policy →
transport-registry (sandbox) → execution → audit / runtime-security (incidents)
```

Cross-cutting core modules: `behavioral-privacy`, `persona-isolation`, `temporal-obfuscation`, `transport-fingerprint` (deterministic metadata-only privacy layers), `runtime-config` / `runtime-profiles` (immutable snapshot loading), and `runtime-orchestrator` — the **Runtime Policy Orchestrator** (Sprint 28) which collects every gate's signal, resolves conflicts via a static precedence table, and emits one `CompositeRuntimeDecision`. Everything is re-exported from `packages/core/src/index.ts`.

**2. Legacy pipeline — `apps/grl-server/src/index.ts` (port 3000, `npm run start`).**
Wires the standalone Sprint-2 packages: `policy-engine` (YAML deny-by-default, `policies/default.yaml`), `identity-compartment` (sessions/cookie jars), `transport-router` (SOCKS5 `direct`/`tor`/`proxy`), `search-adapter-searxng` (isolated, transport-bound adapter). `docs/architecture.md` describes *this* design; the README's Architecture section describes the active core pipeline. The README's package table marks `policy-engine` as "legacy". When in doubt, prefer the core pipeline.

`apps/grl-server` builds its app via a `createApp` factory for testability. The capability request shape (`agentId`, `compartment`/`compartmentId`, `tool`, `riskLevel`, `input`) deliberately has **no transport field** — the agent never selects transport.

## SDK & CLI surface

- `@gyges/agent-sdk` (`packages/agent-sdk`): `GrlAgentClient` + `isAllowed`/`isPending`/`isDenied` discriminators. Decisions are a tri-state (allowed / pending-approval / denied), not a boolean — handle all three.
- `apps/grl-cli`: command modules under `src/commands/` (`search`, `audit`, `trust`, `runtime`, `privacy`, `agents`, `transports`, `incidents`, `health`); every command supports `--json` for scripting via `src/format/`.

## Conventions

- ESM throughout (`"type": "module"`, `module`/`moduleResolution: NodeNext`). Relative imports use explicit `.js` extensions even from `.ts` sources.
- TypeScript `strict` is on everywhere (`tsconfig.base.json`); each package has its own `tsconfig.json` extending it.
- `examples/` holds runnable usage samples (`npm --prefix examples/<name> run start`); `docs/` has one markdown file per feature/sprint and `docs/security/` holds the threat model, trust boundaries, and defensive guarantees referenced by `validate:security-docs`.
- Work is organized in numbered "Sprints"; new privacy/security features land as a new `packages/core/src/<feature>` module + a `docs/<feature>.md` + an `examples/<feature>` sample, wired into `local-api.ts` and exposed through the SDK and CLI.
