# Policy Engine

GRL is policy-driven: every decision derives from explicit, deterministic rules,
never from heuristics or models. This page explains the policy data model and
clarifies the two policy implementations that coexist in the repository.

> Concept page. For how policies are *enforced* at request time see
> [`capability-firewall.md`](capability-firewall.md); for the immutable config
> snapshot that holds them see [`runtime-config.md`](runtime-config.md).

## Two engines, one principle

The repository contains two policy implementations. Both are **deny-by-default**
and **fail-closed**; they differ in form and in which server uses them.

| | Active (core) | Legacy (Sprint-2) |
|---|---|---|
| Location | `packages/core` (firewall + transport-policy + runtime-config) | `packages/policy-engine` |
| Format | typed runtime config object, deep-frozen on load | YAML (`policies/default.yaml`) |
| Server | `apps/grl-server/src/local-api.ts` (port 8787, `npm run dev:server`) | `apps/grl-server/src/index.ts` (port 3000, `npm run start`) |
| Status | **active** — target of the CLI and SDK | **legacy** — retained, marked legacy in the README |

**When in doubt, use the core pipeline.** The legacy YAML engine is documented
here for completeness; new work lands in core.

## The decision inputs

Both engines match on the same shape — and crucially, **transport is never an
input from the agent**:

```
agentId + compartmentId + tool + riskLevel  →  decision (+ policy-resolved transport)
```

A request that asserts its own transport is rejected — no escalation, no silent
downgrade to direct.

## Policy elements (active core config)

The runtime config (`packages/core/src/runtime-config/`) carries the full policy
set as an immutable snapshot:

- **`firewallPolicies`** — explicit allow rules (`agentId`, `compartmentId`,
  `allowedTools`, `maxRiskLevel`, optional `requiresConfirmationAbove`). See
  [`capability-firewall.md`](capability-firewall.md).
- **`transportPolicies`** — map a tool to a transport kind (default routes
  `search` → `mock`). See [`transports.md`](transports.md).
- **`privacyBoundaryRules`** — cross-compartment access decisions.
- **`adaptiveDefensePolicies` / `rateLimitPolicies`** — cooldown / temp-block /
  escalation thresholds.
- **`trustPolicies`** — baseline score and quarantined/restricted thresholds.
- **`graphTransitionRules`** — allowed capability transitions.
- **`isolationPolicies`** — dependency isolation.
- **`sandboxPolicies`** — per-transport permission grants (the bootstrap `mock`
  sandbox allows no network, no filesystem, no process spawn, no browser).

## Immutability & determinism

- The config is **deep-frozen and checksummed** after load — no runtime mutation.
  (`grl health` reports the active `config_checksum`.)
- Evaluation is **deterministic** — identical inputs always produce identical
  decisions. No randomness, no ML, no sampling.
- Profiles (`strict` | `balanced` | `research` | `development`) select a
  starting policy set; see [`runtime-profiles.md`](runtime-profiles.md).

## Legacy YAML engine (`packages/policy-engine`)

The Sprint-2 engine evaluates `policies/default.yaml`: it matches
`agentId + compartment + tool + risk`, enforces a `maxRiskLevel` ceiling, and
**binds each capability to a transport** (a request asserting a different
transport is denied). It is used only by the legacy port-3000 server. The
conceptual architecture in [`architecture.md`](architecture.md) describes this
design.

## Inspecting it

```bash
npm run dev:server
npm run cli -- runtime profile          # active profile + checksum
npm run cli -- runtime policy           # registered runtime policies
npm run cli -- runtime policy signals   # accumulated per-gate signals
npm run cli -- runtime reload           # reload config from disk (immutably)
```

## Related

- [`capability-firewall.md`](capability-firewall.md) — enforcement of allow rules
- [`runtime-config.md`](runtime-config.md) — immutable snapshot loading
- [`runtime-profiles.md`](runtime-profiles.md) — strict / balanced / research / development
- [`runtime-policy-orchestrator.md`](runtime-policy-orchestrator.md) — composite decisions
- [`transports.md`](transports.md) — policy-decided transport
