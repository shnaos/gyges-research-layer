# Transport Fingerprint Randomization & Header Isolation

Sprint 27 adds a deterministic, in-memory transport fingerprint layer that rotates secret-free HTTP request metadata.

## What it does

- assigns per-agent fingerprint profiles
- rotates `User-Agent` and `Accept-Language` deterministically
- varies safe header sets and header ordering
- exposes metadata-only inspection endpoints and SDK/CLI helpers
- never stores raw input, approval tokens, or secrets

## What it does **not** do

- it does **not** guarantee anonymity
- it does **not** prevent advanced fingerprinting
- it does **not** spoof TLS, JA3, canvas, WebRTC, or browser state
- it does **not** add Tor, proxy chains, or browser automation
- it does **not** persist state across restarts

## API surface

- `GET /v1/privacy/fingerprints`
- `GET /v1/privacy/fingerprints/:agentId`
- `GET /v1/privacy/header-profiles`
- `GET /v1/privacy/header-policies`

## CLI

- `grl privacy fingerprints [agentId]`
- `grl privacy header-policies`

## SDK

- `listFingerprintProfiles()`
- `getFingerprintProfile(agentId)`
- `listHeaderProfiles()`
- `getHeaderPolicies()`

## Privacy boundary

Only metadata is returned publicly. Header values are used in-memory for execution, but the read APIs expose only the assigned fingerprint id, risk, language, user-agent, and policy/profile lifecycle metadata.

---

## Sprint 28 extension: Runtime Policy Orchestrator

Sprint 28 adds a central arbitration layer above the transport fingerprint engine. Transport fingerprint isolation now also emits a `PolicySignal` with `source: 'transport_fingerprint'` for each execute-mock request. The `RuntimePolicyOrchestrator` aggregates this signal alongside signals from all other gates to produce a single `CompositeRuntimeDecision`.

See [`docs/runtime-policy-orchestrator.md`](./runtime-policy-orchestrator.md) for details.

## Sprint 30 relationship: Network Isolation

Transport fingerprint randomization reduces *trivially stable request metadata*
(User-Agent, Accept-Language, header ordering). It is **distinct from** and
**complementary to** the Sprint 30 [Network Isolation layer](./network-isolation.md),
which reduces *network-route* correlation by binding each compartment to an
isolated logical relay route and rotating it deterministically. In the execute
pipeline the network-isolation gate runs **before** fingerprint isolation:

```
… → network isolation → transport policy → transport fingerprint → sandbox → SearXNG
```

Neither layer promises anonymity, invisibility, anti-forensics, or anti-detection;
both are logical/runtime correlation-reduction layers only.
