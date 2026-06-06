# Privacy Model Summary

This document complements the detailed security privacy model in
[`docs/security/privacy-model.md`](./security/privacy-model.md).

Sprint 24 adds behavioral privacy controls:

- deterministic temporal jitter recommendations
- identity fragment rotation for elevated correlation risk
- metadata-only behavioral profiles
- fail-closed blocking at critical correlation risk

See [`docs/behavioral-privacy.md`](./behavioral-privacy.md) for the full Sprint 24 surface.

Sprint 25 adds explicit **Persona Isolation** — per-category persona assignment that prevents a single agent from accumulating a unified interest graph across research topics such as crypto, health, finance, and politics.

See [`docs/persona-isolation.md`](./persona-isolation.md) for the full Sprint 25 surface.

Sprint 26 adds **Temporal Obfuscation & Query Scheduling** — a dedicated engine that reduces exploitable timing signatures produced by AI agents: burst patterns, fixed cadence, predictable schedules, and temporal density accumulation. It operates after persona isolation and before the transport layer.

See [`docs/temporal-obfuscation.md`](./temporal-obfuscation.md) for the full Sprint 26 surface.

Sprint 27 adds **Transport Fingerprint Randomization & Header Isolation** — a deterministic layer that rotates secret-free request metadata such as `User-Agent`, `Accept-Language`, and stable header sets. It reduces trivial transport correlation only; it does **not** guarantee anonymity, defeat advanced fingerprinting, or replace Tor/proxy infrastructure.

See [`docs/transport-fingerprint.md`](./transport-fingerprint.md) for the full Sprint 27 surface.
