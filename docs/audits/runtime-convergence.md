# Runtime Convergence Audit (Sprint 32)

Phase 1 of converging the real `execute` path with `execute-mock` and replacing
critical runtime simulations with real, observable effects. Honest status below.

## What was mock / advisory before (Sprint 31 findings)

- `behavioral_privacy`, `persona_isolation`, `temporal_obfuscation` ran **only on
  execute-mock** — zero effect on the real `execute` path.
- Temporal/behavioral **delays were advisory** — the server had no `setTimeout`
  around execution; `delayMs` was metadata only.
- The audit store was **unbounded**.
- Network isolation was **logical-only** and not consumed by the execution path.

## What was replaced with real effects (Sprint 32)

### 1. Single shared privacy pipeline (convergence)

The behavioral/persona/temporal block was extracted from execute-mock into one
shared `runPrivacyPipeline(collector, ctx)` helper. **Both** `execute` and
`execute-mock` now call it, so they share the same gates, signals, audit events,
and **real engine mutations**:

- behavioral: `evaluateRequest` + `recordBehavior` + real `fragmentManager`
  fragment creation/rotation + `refreshProfile`.
- persona: `evaluatePersonaIsolation` + `getOrCreatePersona` + fragment binding +
  `recordPersonaSearch`.
- temporal: `evaluateTemporalRisk` + `recordExecution`.

Equivalence for execute-mock is guarded by its existing 8 API tests (used as the
extraction oracle); presence on execute is asserted by
`apps/grl-server/test/audit-reality.test.ts` (the former KNOWN-GAP test, now
inverted to `CONVERGED`) and `execute-convergence.test.ts`.

### 2. Real, bounded, opt-in execution delay

`applyExecutionDelay(delayMs)` performs a real, event-loop-friendly
`await new Promise(r => setTimeout(r, ms))` before execution. Properties:

- **Deterministic duration**: the delay value comes from the temporal/behavioral
  gates (no uncontrolled randomness). The wall-clock wait is real; the *duration*
  is deterministic given inputs.
- **Bounded**: capped by `maxExecutionDelayMs` (default 2000), enforced regardless
  of engine output.
- **Opt-in / disable-able**: `executionDelayEnabled` defaults to **false** (so CI
  and tests stay fast). This is a **privacy knob, not a security gate** — toggling
  it never relaxes a fail-closed decision.
- **Observable**: responses report `appliedDelayMs` (the real awaited value).

Proven by `execute-convergence.test.ts`: a spy assertion (real invocation,
deterministic, capped), a real wall-clock assertion (elapsed ≥ delay), and a
default-off assertion (no sleep, `appliedDelayMs === 0`).

### 3. Persona / route changes drive real rotations

- Persona `requiresSessionIsolation` and a relay-route rotation now feed
  `mustRotate` → a **real session rotation** (new `sessionId`, the identity the
  transport actually uses), audit-observable via `session_rotated`.
- A relay-route rotation (persona/category/critical-risk/ceiling) now forces a
  **real transport-fingerprint rotation** on `execute` (route → fingerprint
  linkage).
- The network-isolation gate consumes `criticalRisk` from the behavioral/persona
  gates, so elevated correlation really rotates the route.

### 4. Bounded audit store

`AuditStore` is bounded with FIFO eviction (`maxEvents`, default 50,000). Query
semantics unchanged. Fixes the Sprint 31 unbounded-store finding.

## Final pipelines

**execute** (real path): capability_graph → multi_agent → trust →
**behavioral/persona/temporal (shared)** → defense → firewall → network_isolation
(persona/critical-risk aware) → routing → privacy_boundary → fingerprint
(route/persona-linked) → session (rotates on persona/route) → **await delay** →
execution (SearXNG if enabled+routed, else **mock fallback**) → sandbox → audit →
orchestrator.

**execute-mock**: identical gate set and signals; runs the same shared privacy
pipeline; always uses the mock transport.

## Remaining differences (honest)

| Difference | Status |
|---|---|
| Transport | **Allowed by design** — execute selects mock/SearXNG; execute-mock is always mock. |
| Gate ordering | Minor residual: `execute` runs network-isolation **before** transport-fingerprint (enabling route→fingerprint linkage); `execute-mock` runs fingerprint **before** network. Signals/effects converge; physical order differs. |
| Handler code | Still two handler functions (~1500 lines each). The privacy gates are now shared; full single-function unification is **Phase 2** (not attempted — too high-risk for one sprint). |

## What is still metadata-only / purely logical (unchanged, by design)

- **Network isolation routes / DNS isolation** remain **logical/metadata-only** —
  there is still **no real Tor/proxy/VPN/SOCKS/DNS/egress**. A route rotation now
  has a *real local effect* (session + fingerprint rotation) but changes no real
  network path. This is intentional and within the strict sprint constraints.
- **Orchestrator `runtimePolicy`** remains an informational composite; per-gate
  decisions enforce.
- **Temporal cooldown / budget-exhaustion signals** remain advisory (only the
  pre-execution delay is enforced); they are surfaced, not hard-blocked.

## Why these remain

The sprint forbids real Tor/proxy/VPN/browser/cloud and any anonymity claim, so
network isolation stays a logical correlation-reduction layer. Hard-blocking on
temporal budget exhaustion was left advisory to preserve existing fail-closed
semantics and avoid destabilizing the suite; it can be promoted in a later phase.

## Confirmations

No real Tor/proxy/VPN, no browser, no crawler, no DB/Redis, no AI/ML/NLP, no new
transport, no durable persistence were added. The delay is local wall-clock only.
No token / raw input / secret is stored by any new code path.
