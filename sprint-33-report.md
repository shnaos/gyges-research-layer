# Gyges Research Layer — Sprint 33: Runtime Mock Elimination Audit

## Summary

This audit surveyed the entire repository for mock, fake, stub, dummy, simulated, and placeholder runtime logic. Every finding was classified and evaluated for runtime integrity. The primary RUNTIME_CRITICAL finding — the `/v1/capabilities/execute` endpoint silently returning mock transport output instead of denying when no real transport was configured — was resolved by introducing an explicit `mockFallbackEnabled` opt-in flag (default: `false`). All 1197 tests pass, typecheck is clean, smoke tests pass, both audit scripts pass.

---

## Mock Classification Table

| Finding | Location | Classification | Acceptable? |
|---|---|---|---|
| `MockTransportAdapter` class | `packages/core/src/execution/mock-transport.ts` | TEST_ONLY / DEV_ONLY | Yes — used only by `execute-mock` endpoint and tests |
| `buildMockExecutionEngine()` factory | `packages/core/src/execution/engine.ts` | TEST_ONLY / DEV_ONLY | Yes — wires `MockTransportAdapter`; used only by tests and `execute-mock` handler |
| `/v1/capabilities/execute-mock` endpoint | `apps/grl-server/src/local-api.ts` | DEV_ONLY | Yes — explicitly labeled dry-run; runs the full policy pipeline but always uses mock transport by design |
| `execute` fallback to mock transport (pre-sprint) | `apps/grl-server/src/local-api.ts` | RUNTIME_CRITICAL | **Fixed** — now denies by default; mock fallback requires `mockFallbackEnabled: true` |
| Bootstrap transport policy: `preferredTransport: 'mock'` for all rules | `packages/core/src/transport-policy/bootstrap.ts` | RUNTIME_CRITICAL | Acceptable post-fix — the mock denial guard intercepts before execution; these rules drive the `execute-mock` path correctly |
| All runtime profiles: `transportKind: 'mock'` in sandbox policies | `packages/core/src/runtime-profiles/packs.ts` | DEV_ONLY | Acceptable — sandbox policies describe permission surfaces, not live execution routes |
| `DEFAULT_RUNTIME_CONFIG` sandbox: `transportKind: 'mock'` | `packages/core/src/runtime-config/bootstrap.ts` | DEV_ONLY | Acceptable — same as above; execution routing goes through transport-policy engine, not sandbox config |
| `BOOTSTRAP_TRANSPORT_MANIFESTS` contains only mock manifest | `packages/core/src/transport-registry/bootstrap.ts` | DEV_ONLY | Acceptable — transport manifest is permission metadata; real transport (SearXNG) has its own manifest but is gated by config |
| `fetch_html` / `fetch_json` tools: no real transport adapter | All transport adapters | RUNTIME_CRITICAL (residual) | Partially mitigated — mock denial guard causes explicit deny for these tools; no silent fake execution |
| `direct`, `tor`, `proxy`, `browser` transport kinds: declared, no adapters | `packages/core/src/execution/types.ts` | RUNTIME_CRITICAL (residual) | Mitigated — `TransportPolicyEngine` throws `TransportPolicyError('no_rule')` on no match; execute endpoint has `else if (resolvedKind !== 'mock')` fail-closed guard |
| Session manager `transportKind: 'mock'` label on bootstrap compartment | `apps/grl-server/src/local-api.ts:803` | DEV_ONLY | Acceptable — session `transportKind` is overridden at line 4093 by `routing.transportKind`; label does not drive execution |
| Legacy packages: `policy-engine`, `identity-compartment`, `transport-router`, `search-adapter-searxng` | `packages/` (legacy) | LEGACY_UNUSED | Acceptable — wired only to port-3000 legacy server; not imported by `local-api.ts` (verified by coherence audit) |
| Stale comment: "execute-mock-only privacy engines" | `scripts/audit-runtime-coherence.ts` | — | **Fixed** — Sprint 32 wired behavioral/persona/temporal into the `execute` path; comment now reflects reality |
| Stale comment: "does not currently invoke" behavioral gates on execute | `scripts/audit-runtime-coherence.ts` | — | **Fixed** |
| Stale comment: "mock transport" in `buildBootstrapSessionManager` docstring | `apps/grl-server/src/local-api.ts:787` | — | **Fixed** |

---

## RUNTIME_CRITICAL Findings (Detail)

### Finding 1 (RESOLVED): `/v1/capabilities/execute` silently ran mock transport

**Before this sprint:** When the transport policy resolved to `'mock'` (the default for all bootstrap rules), the execute endpoint silently fell through to `MockTransportAdapter` and returned `{ decision: 'allowed', execution: { transportKind: 'mock', output: { mock: true, ... } } }`. The mock was "discoverable" (the response carried `execution.transportKind: 'mock'`) but presented as a successful allowed execution — the caller could not distinguish it from a real execution without reading that field.

**The precise code path (pre-fix):**
```
POST /v1/capabilities/execute
  → transport policy resolves (search, low) → 'mock'
  → if (resolvedKind === 'searxng')  // false
  → else if (resolvedKind !== 'mock') // false — mock silently passes through
  → executionEngine (mock) → { mock: true, tool, input, sessionId }
  → response: { decision: 'allowed', execution: { transportKind: 'mock' } }
```

**Fix applied:** Added an explicit guard branch before the unknown-transport fail-closed check:

```typescript
} else if (resolvedKind === 'mock' && !mockFallbackEnabled) {
  collector.emit({ source: 'transport_policy', action: 'deny', severity: 'medium',
    reason: 'Mock transport is not a real transport. Configure a real transport or use /v1/capabilities/execute-mock.' });
  return res.status(200).json({
    decision: 'denied',
    reason: 'No real transport configured. Use /v1/capabilities/execute-mock for dry-run testing, or configure SearXNG in your runtime config.',
    ...
  });
}
```

`mockFallbackEnabled` defaults to `false`. To opt in to mock transport on the execute endpoint (offline development only): pass `mockFallbackEnabled: true` to `createLocalApiApp()`.

**Effect:** SDK `.search()` calls (which send `tool: 'search'`, allowed by the bootstrap firewall) now receive an explicit `decision: 'denied'` with a clear actionable reason rather than simulated mock output when no real transport is configured. The CLI `grl search` sends `tool: 'web_search'`, which has no bootstrap allow rule — it was already denied at the **firewall** layer before this sprint and remains so (unaffected by this fix). The `/v1/capabilities/execute-mock` endpoint is unaffected — it is always mock-only by design and does not go through this guard.

**Examples impact:** Example scripts that call SDK `.search()` against the default dev server (`npm run dev:server`) will now observe `decision: 'denied'` rather than mock-allowed output when SearXNG is not configured. The example code already handles all three decision states (allowed/pending/denied), so nothing crashes — the output simply reflects the honest denial. The stale "mock transport" label in `examples/quickstart/sdk-demo.ts` was updated. Examples requiring real search results need a running SearXNG instance and a `GRL_CONFIG_PATH` pointing to a config with `preferredTransport: 'searxng'`.

**Important nuance:** All security and privacy gates (capability graph, trust engine, adaptive defense, firewall, behavioral privacy, persona isolation, temporal obfuscation, transport fingerprint, network isolation) run **before** the transport guard. A `denied` response from the mock guard still carries a complete `runtimePolicy` block with all signal sources — these gates exercised the request even though transport was denied. This is the correct behavior: privacy evaluation is unconditional.

---

### Finding 2 (RESIDUAL, MITIGATED): `fetch_html` and `fetch_json` have no real transport adapter

No `TransportAdapter` implementation exists for `fetch_html` or `fetch_json` tools beyond the mock. The SearXNG adapter only supports `search`. Under the new default behavior:
- Transport policy resolves `fetch_html` at `medium` risk → `'mock'`
- The mock denial guard fires → explicit `denied` response
- No simulated output is returned

The residual risk is that no path to real `fetch_html`/`fetch_json` execution exists. Adding real HTTP fetch adapters is the blocker for convergence on these tools (see Blockers section).

---

### Finding 3 (RESIDUAL, BOUNDED): `direct`, `tor`, `proxy`, `browser` transport kinds declared but no adapters

These kinds appear in `TransportKind` type for future sprint readiness. If a transport policy rule ever resolved to one of them:
1. `TransportPolicyEngine.resolve()` would succeed (a rule could point to them)
2. The execute endpoint's `else if (resolvedKind !== 'mock')` block catches any non-`mock`, non-`searxng` kind → explicit `denied` with "not supported by the execute endpoint"

No silent execution path exists for these kinds. The risk is bounded to configuration errors (a user writing a policy rule pointing to `direct`), which already fail-closed.

---

## Runtime Paths Confirmed Free of Mocks

These execution paths use real implementations throughout; no mock or simulated component is in the normal flow:

| Path | Real? | Notes |
|---|---|---|
| Capability Graph evaluation | ✓ Real | In-memory DAG, deterministic, fail-closed |
| Trust / Reputation engine | ✓ Real | Bounded score 0–100 per compartment, in-memory |
| Adaptive Defense engine | ✓ Real | Threshold-based anomaly → cooldown/block/approval |
| Capability Firewall decision | ✓ Real | YAML-like deny-by-default rule evaluation |
| Rate Limiter | ✓ Real | Sliding-window per (agentId, tool) |
| Transport Policy routing | ✓ Real | Deterministic rule match, fail-closed (throws on no match) |
| Privacy Boundary evaluation | ✓ Real | Correlation/isolation checks, fail-closed on block |
| Session Manager (mint/reuse/rotate) | ✓ Real | In-memory TTL + max-requests, compartment-isolated |
| Behavioral Privacy engine | ✓ Real | In-memory fragment tracking, deterministic jitter/burst logic |
| Persona Isolation engine | ✓ Real | Per-agent persona with fragment binding, category-driven rotation |
| Temporal Obfuscation engine | ✓ Real | Deterministic cadence/burst penalty, bounded delay |
| Transport Fingerprint engine | ✓ Real | Deterministic fingerprint derivation, no randomness |
| Network Isolation engine | ✓ Real | Logical relay route assignment, metadata-only, no real network |
| Approval Queue (human-in-the-loop) | ✓ Real | In-memory TTL queue, explicit approval/denial |
| Audit Store (AuditStore) | ✓ Real | Bounded in-memory (50,000 events, FIFO eviction), non-persistent by design and honest about it |
| PolicySignalCollector / RuntimePolicyOrchestrator | ✓ Real | Composite decision via static precedence table, fail-closed |
| SearXNG transport adapter | ✓ Real | Only real-network transport; loopback-only, mandatory timeout, fail-closed on error |
| Runtime Config Loader | ✓ Real | Deep-frozen, checksummed snapshot; hot-reload; no cloud/telemetry |
| Runtime Profile Resolver | ✓ Real | Static policy packs applied deterministically |
| Agent Registry / Lease Manager / Scheduler | ✓ Real | In-memory multi-agent state, quota enforcement |

---

## Blockers Preventing Full Real-Runtime Convergence

1. **No real HTTP fetch transport (`fetch_html`, `fetch_json`)**
   A real HTTP fetching transport adapter would be required for `fetch_html` and `fetch_json` to produce actual output. The missing component is a `TransportAdapter` implementation (like `SearXngTransportAdapter`) that performs controlled local HTTP GET with sandbox enforcement. Until then, requests for these tools are denied explicitly (not silently mocked).

2. **Bootstrap transport policy defaults to `'mock'` for all tools**
   Every bootstrap transport rule uses `preferredTransport: 'mock'`. The `/v1/capabilities/execute` endpoint now correctly rejects this by default, but the path to real execution for `search` requires the user to have SearXNG configured AND a runtime config that sets `preferredTransport: 'searxng'` for the search rule. No automatic bootstrap upgrade path exists.

3. **`direct`, `tor`, `proxy`, `browser` transports: no adapters**
   These are declared in `TransportKind` for future sprints. Until adapters exist, any policy rule routing to them produces an explicit denial. Implementation requires a future sprint.

---

## Changes Made in This Sprint

### `apps/grl-server/src/local-api.ts`
- Added `mockFallbackEnabled?: boolean` option to `LocalApiOptions` (default: `false`). Documents clearly that this is an offline dev opt-in, not a production knob.
- Added `const mockFallbackEnabled = options.mockFallbackEnabled ?? false;` extraction in `createLocalApiApp`.
- Added explicit mock denial guard in the `/v1/capabilities/execute` transport selection block: when `resolvedKind === 'mock' && !mockFallbackEnabled`, emits a `transport_policy` / `deny` signal and returns `decision: 'denied'` with a clear actionable message.
- Updated the inline comment describing the transport selection logic to reflect the new default behavior.
- Fixed stale comment in `buildBootstrapSessionManager` docstring ("for the mock transport" → removed; the session manager is not mock-specific).

### `scripts/audit-runtime-coherence.ts`
- Fixed stale check label: "execute-mock-only privacy engines" → "core privacy engines (behavioral, persona, temporal)".
- Fixed stale invariant comment: removed "even if the live `execute` path does not currently invoke them" — Sprint 32 wired these into the real execute path.

### `apps/grl-server/test/execute-convergence.test.ts`
- Updated the transport-selection `describe` block: the old single test asserting `decision: 'allowed'` with `transportKind: 'mock'` is replaced by two tests:
  - "execute denies by default when transport policy resolves to mock (no real transport)" — tests the new default
  - "execute allows mock transport when mockFallbackEnabled is explicitly set" — tests the opt-in path
- Added `mockFallbackEnabled: true` to all tests that exercise post-execution fields (`appliedDelayMs`, `fingerprint`, `networkIsolation.shouldRotate`) since these require full execution to complete.

### Test files updated to reflect opt-in mock fallback
The following test files had their local `startApp()` wrapper or specific test call updated to pass `mockFallbackEnabled: true`. These tests test the "allowed path" of the execute endpoint — they exercise real policy gate behavior using the mock transport as the execution substrate, which is the explicit DEV_ONLY use case:
- `apps/grl-server/test/execute-api.test.ts` — updated failing test name and added `mockFallbackEnabled: true`
- `apps/grl-server/test/network-isolation-api.test.ts` — `mockFallbackEnabled: true` in `createLocalApiApp` inside local `startApp`
- `apps/grl-server/test/runtime-policy-parity-api.test.ts` — same
- `apps/grl-server/test/transport-fingerprint-api.test.ts` — same
- `apps/grl-server/test/audit-reality.test.ts` — same

---

## Verification

All checks pass after the changes:

```
npm test          → 1197 tests passed (68 test files)
npm run typecheck → clean (no errors)
npm run smoke-test → all smoke tests passed
npm run audit:mocks → all mock-boundary invariants hold
npm run audit:coherence → all runtime-coherence invariants hold
```

---

## What Was NOT Changed (and Why)

- **`MockTransportAdapter` was not deleted.** It is the execution substrate for `execute-mock` and all tests that exercise the full policy pipeline in an offline environment. This is the explicit DEV_ONLY use case. Deleting it would break the dry-run development workflow.
- **Bootstrap transport policy rules still say `preferredTransport: 'mock'`.** These drive the `execute-mock` endpoint correctly and are the correct default for the dry-run path. The execute endpoint now guards against them.
- **The `execute-mock` endpoint was not changed.** It is explicitly mock-only by design and by documentation. The mock denial guard was added only to the real `execute` endpoint.
- **Legacy packages were not touched.** They are LEGACY_UNUSED in the active pipeline and correctly isolated.
- **In-memory audit store was not changed.** It is a real implementation, not a mock. Non-persistence is honest and documented.
