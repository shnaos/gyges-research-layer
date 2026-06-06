# Behavioral Privacy & Anti-Correlation Engine

Sprint 24 adds a deterministic, in-memory behavioral privacy layer to GRL.

## Guarantees

- In-memory only
- Deterministic and reproducible
- Fail-closed on unknown or critical risk
- No raw input, query, token, or secret storage
- Metadata-only profiles, fragments, and policy views
- No new transports, browser integration, AI/ML, DB/Redis, or cloud sync

## Core components

- `BehavioralPrivacyEngine` — records metadata-only behavior and evaluates risk
- `CorrelationEngine` — tracks repeated topic labels and temporal burst patterns
- `IdentityFragmentManager` — rotates short-lived identity fragments per agent
- `TemporalPrivacyScheduler` — computes deterministic jitter recommendations

## Local API endpoints

- `GET /v1/privacy/behavioral/profiles`
- `GET /v1/privacy/behavioral/profiles/:agentId`
- `GET /v1/privacy/fragments`
- `GET /v1/privacy/fragments/:agentId`
- `GET /v1/privacy/jitter-policies`

All responses expose metadata only.

## Execute flow

During `execute-mock`, the behavioral privacy gate runs after the trust gate and before the capability firewall. Elevated risk may recommend deterministic delay metadata, rotate an identity fragment, or block execution when correlation risk becomes critical.

## CLI and SDK

CLI:

- `grl privacy profiles`
- `grl privacy profile <agentId>`
- `grl privacy fragments [agentId]`

SDK:

- `listBehavioralProfiles()`
- `getBehavioralProfile(agentId)`
- `listIdentityFragments(agentId?)`

---

## Sprint 25 extension: Persona Isolation

Sprint 25 builds on the behavioral privacy layer by adding explicit **per-category persona isolation**. While behavioral privacy tracks correlation risk at the agent level, persona isolation ensures that different research categories (crypto, finance, health, politics, …) receive entirely separate fragment identities and session spaces.

See [`docs/persona-isolation.md`](./persona-isolation.md) for the full Sprint 25 surface.
