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

---

## Sprint 26 extension: Temporal Obfuscation

Sprint 26 adds explicit **Temporal Obfuscation & Query Scheduling** on top of the behavioral privacy and persona isolation layers. Where behavioral privacy tracks correlation risk at the agent level, temporal obfuscation targets the timing signature itself: cadence patterns, burst spikes, and temporal density accumulation.

See [`docs/temporal-obfuscation.md`](./temporal-obfuscation.md) for the full Sprint 26 surface.

---

## Sprint 27 extension: Transport Fingerprint Randomization

Sprint 27 extends the privacy stack below the behavioral, persona, and temporal layers by rotating transport metadata such as `User-Agent`, `Accept-Language`, and safe header sets. It complements behavioral privacy, but it does **not** claim to defeat transport fingerprinting completely.

See [`docs/transport-fingerprint.md`](./transport-fingerprint.md) for details.

---

## Sprint 28 extension: Runtime Policy Orchestrator

Sprint 28 adds a central arbitration layer above the behavioral privacy engine. Behavioral privacy now also emits a `PolicySignal` with `source: 'behavioral_privacy'` for each execute-mock request. The `RuntimePolicyOrchestrator` aggregates this signal alongside signals from all other gates to produce a single `CompositeRuntimeDecision`.

See [`docs/runtime-policy-orchestrator.md`](./runtime-policy-orchestrator.md) for details.
