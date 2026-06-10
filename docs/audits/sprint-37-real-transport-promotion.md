# Sprint 37 — Real Transport Promotion & Runtime Factory Extraction

**Date:** 2026-06-10  
**Branch:** `sprint-37-real-transport-promotion`  
**Baseline:** `main` @ `6729664` (post-#36 merge, post-#35 merge)  
**Status:** Phase 0 complete — audit frozen before first code change

---

## 1. Purpose

This audit maps the current state of the transport layer before any modification.
It distinguishes mocks used legitimately in tests from runtime risks, surfaces
architectural divergences, and identifies concrete targets for Phases 1–3.

---

## 2. Scope map

### 2.1 Two parallel pipelines

GRL currently ships two completely separate server pipelines. They share no
code paths and operate on different ports.

| Pipeline | Entry point | Port | Transport system |
|---|---|---|---|
| **Active** | `apps/grl-server/src/local-api.ts` | 8787 | `packages/core/src/execution/` + `packages/core/src/transports/searxng/` |
| **Legacy** | `apps/grl-server/src/index.ts` | 3000 | `packages/transport-router/src/` |

All sprint work (Sprint 28 onward) targets the **active** pipeline. The legacy
pipeline is kept for compatibility but is not the reference implementation.

---

## 3. Transport-router (legacy pipeline)

**File:** `packages/transport-router/src/index.ts`

| Component | Type | Real network? |
|---|---|---|
| `TransportRouter` | Class, routes by `TransportType` | Yes (SOCKS5, direct) |
| `TransportClient` | Interface returned to adapters | — |
| `SocksEndpoint` | SOCKS5 endpoint config | — |
| `socks5Connect()` | Full SOCKS5 handshake | **Real sockets** |
| Direct transport | `globalThis.fetch()` | **Real HTTP** |

**Assessment:** Fully real SOCKS5 implementation. Wired exclusively into
`apps/grl-server/src/index.ts` (legacy port 3000). The active pipeline
(`local-api.ts`) never imports or calls it. **No divergence risk on the active
path — these are independent systems.**

---

## 4. Active pipeline transport architecture

### 4.1 TransportAdapter interface

**File:** `packages/core/src/execution/types.ts`

```typescript
interface TransportAdapter {
  readonly kind: TransportKind;
  readonly isReal: boolean;  // integrity marker
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}
```

`isReal` is the canonical runtime integrity signal. Any adapter with
`isReal === false` is **structurally blocked** on the `/execute` endpoint
(A-01 guard, `local-api.ts:5016-5026`).

### 4.2 Concrete adapters

| Adapter | Location | `isReal` | Network | Notes |
|---|---|---|---|---|
| `MockTransportAdapter` | `packages/core/src/execution/mock-transport.ts` | `false` | None | Deterministic echo, test/dev only |
| `SearXngTransportAdapter` | `packages/core/src/transports/searxng/adapter.ts` | `true` | **Real HTTPS** to loopback | Only real transport shipped |

`SearXngTransportAdapter` is the **only production-grade transport** in the
active pipeline. It enforces loopback-only (`baseUrl` must be 127.0.0.1,
localhost, or ::1), never stores credentials, never follows result URLs.

### 4.3 ExecutionEngine

**File:** `packages/core/src/execution/engine.ts`

Routing logic only. Selects adapter by `transportKind`, runs sandbox check, calls
`adapter.execute()`. Throws fail-closed when no adapter matches. Performs no
direct network I/O.

### 4.4 TransportCapabilityRegistry

**File:** `packages/core/src/transport-registry/registry.ts`

In-memory manifest registry + sandbox evaluator. Bootstrap manifests:
- `BOOTSTRAP_MOCK_MANIFEST`: kind=`'mock'`, `networkAccess: false`
- `SEARXNG_TRANSPORT_MANIFEST`: kind=`'searxng'`, `networkAccess: true`, `supportedTools: ['search']`

### 4.5 TransportPolicyEngine

**File:** `packages/core/src/transport-policy/engine.ts`

Deterministic, fail-closed routing rule engine. Outputs `transportKind`,
`shouldRotateSession`, `isolationLevel`. **Never mints sessions, never executes.**

Bootstrap rules:
- `tool=search, riskLevel=low` → `preferredTransport: 'searxng'`
- `tool=fetch_html, riskLevel=medium` → `preferredTransport: 'searxng'`

**No bootstrap rule routes to `'mock'`.** Mock can only be resolved if an
agent passes a transport hint (forbidden by contract) or if a non-standard
config is injected in tests.

---

## 5. `/execute` vs `/execute-mock` endpoint analysis

### 5.1 `/v1/capabilities/execute` (active, production)

**Location:** `apps/grl-server/src/local-api.ts:4334`

**Transport protection layers (in order):**

```
1. TransportPolicy resolves transportKind from rules (no mock rule in bootstrap)
2. resolvedKind === 'searxng':
   → SearXNG config absent/disabled → DENY NO_REAL_TRANSPORT_AVAILABLE (line 4814)
   → realSearXngEngine null → DENY TRANSPORT_RUNTIME_FAILURE (line 4829)
3. resolvedKind === 'mock':
   → Explicit deny guard → DENY NO_REAL_TRANSPORT_AVAILABLE (line 4839)
4. resolvedKind === anything else:
   → Fail-closed deny "Transport kind not supported" (line 4852)
5. A-01 integrity guard:
   → adapter.isReal === false → DENY TRANSPORT_RUNTIME_FAILURE (line 5020)
```

**Fail-closed by design on every path.** Real execution only happens when
SearXNG is configured, enabled, and engine is initialized.

**Real SearXNG engine initialization:**
```typescript
// local-api.ts:1933
let realSearXngEngine: ExecutionEngine | null = (() => {
  try {
    return buildSearXngExecutionEngine(activeSnapshot.config);
  } catch {
    return null;  // fail-closed on bad config
  }
})();
```

Rebuilt on every config reload via `applyReloadedSnapshot()`.

### 5.2 `/v1/capabilities/execute-mock` (test/dev only)

**Location:** `apps/grl-server/src/local-api.ts:3152`

**Gating:**
- Returns HTTP 403 unless `NODE_ENV === 'test'` OR `ENABLE_RUNTIME_MOCKS === 'true'`
- Transport is **hardcoded** to `'mock'` regardless of policy
- Always uses `executionEngine` (mock by default), never `realSearXngEngine`

**Assessment:** Correctly isolated. Production cannot reach this path by default.

---

## 6. Mock occurrences classification

### 6.1 Runtime risks — NONE

Every mock reference in the active pipeline (`local-api.ts`, `packages/core/`) is:
- a test-only guard
- an integrity marker (`isReal: false`)
- an explicit denial on the `/execute` path

### 6.2 Test-only (legitimate)

| Location | Usage |
|---|---|
| `apps/grl-server/test/execute-mock-api.test.ts` | Tests the `/execute-mock` endpoint |
| `apps/grl-server/test/execute-api.test.ts` | Uses `startAppWithSearXng()` for `/execute` tests |
| `apps/grl-server/test/runtime-integrity.test.ts` | Tests deny-on-mock, deny-no-transport |
| `apps/grl-server/test/audit-reality.test.ts` | Uses mock HTTP server for SearXNG stub |
| All `startApp()` helpers | Use `buildMockExecutionEngine()` for `/execute-mock` testing |

### 6.3 Dead code (residue from PR #35 rebase)

| Location | Issue | Impact |
|---|---|---|
| `apps/grl-server/test/audit-reality.test.ts:51` | `mockFallbackEnabled: true` — field not in `LocalApiOptions` | None (JS silently ignores) |
| `apps/grl-server/test/transport-fingerprint-api.test.ts:55` | Same | None |
| `apps/grl-server/test/network-isolation-api.test.ts:51` | Same | None |
| `apps/grl-server/test/runtime-policy-parity-api.test.ts:57` | Same | None |

**Risk level:** Zero at runtime. TypeScript doesn't catch it (test files excluded
from `apps/grl-server/tsconfig.json`). Will be cleaned up in this sprint.

---

## 7. Divergence map: transport-router vs core runtime

| Dimension | `transport-router` | Core runtime (active) |
|---|---|---|
| Transport types | `direct`, `tor`, `proxy` | `mock`, `searxng` (others: future) |
| Real SOCKS5 | ✓ | ✗ (not wired) |
| Used by | `apps/grl-server/src/index.ts` (port 3000) | `local-api.ts` (port 8787) |
| Shared code | None | None |
| Status | Legacy, stable | Active development |

**Open divergence:** The active pipeline has no SOCKS5/Tor/proxy transport. The
`TransportKind` enum includes `'tor'` and `'proxy'` but no adapters implement
them in `packages/core`. `TransportPolicyEngine` can route to these kinds but
the execution engine would throw fail-closed (no adapter registered).

**Not a runtime risk today** (no config routes real traffic to those kinds),
but a future gateway/proxy mode will need to bridge or reimplement.

---

## 8. SearXNG adapter status

**File:** `packages/core/src/transports/searxng/adapter.ts`

| Property | Value |
|---|---|
| `isReal` | `true` |
| Supported tools | `search` only |
| Network | Real HTTPS `fetch()` to loopback |
| Loopback enforcement | `baseUrl` must be `127.0.0.1`, `localhost`, or `::1` |
| Credentials | Refused in URL |
| Cookie/session state | None |
| Follow result URLs | Never |

**Config path when `SEARXNG_URL` not set:**  
Config missing → `buildSearXngAdapter()` returns `null` → `realSearXngEngine = null`  
→ `/execute` returns `denied` with `NO_REAL_TRANSPORT_AVAILABLE`. Fail-closed.

**SearXNG is the first and only real transport in the active pipeline.**  
Its `isReal: true` marker is already present but not yet surfaced in the HTTP
response (Sprint 37 Phase 2 target).

---

## 9. `local-api.ts` complexity assessment

| Metric | Value |
|---|---|
| Total lines | 6649 |
| Exported functions (builders, constants) | ~30 |
| `createLocalApiApp` function start | line 1813 |
| Dependency initialization block | lines 1813–1970 (~157 lines) |
| Route handlers | lines 1970–6510 (~4540 lines) |
| Config/server helpers | lines 6510–6649 |

**The dependency initialization block (157 lines) is the Phase 1 extraction
target.** Route handlers stay in place — they capture the initialized deps via
closure and must not be disturbed.

---

## 10. Phase targets derived from this audit

### Phase 1 — Runtime factory extraction
- **Target file:** `apps/grl-server/src/runtime-factory.ts` (new)
- Extract `RuntimeDependencies` interface and `buildRuntimeDependencies()` from
  lines 1813–1970 of `local-api.ts`
- Extract `ReloadableDependencies` + `buildReloadableDependencies()` for the
  config-derived engines (firewall, transport policy, etc.)
- `createLocalApiApp` shrinks by ~157 lines, API surface unchanged

### Phase 2 — Real transport promotion
- **Target file:** `apps/grl-server/src/api-contract.ts`
- Add `isReal?: boolean` to `ExecuteMockCapabilityHttpResponse` (additive)
- **Target:** `apps/grl-server/src/local-api.ts` execute response builder
- Wire `isReal: true` on `/execute` allowed path (adapter confirmed real)
- Wire `isReal: false` on `/execute-mock` allowed path
- Clean up `mockFallbackEnabled: true` dead-code in 4 test files

### Phase 3 — E2E runtime integrity tests
- **New file:** `apps/grl-server/test/execute-real-transport.test.ts`
- Cover: allowed (real SearXNG), deny-no-transport, deny-transport-disabled,
  deny-mock-resolution, audit events, sandbox, fingerprint, no implicit fallback

---

## 11. Remaining open divergences (not in Sprint 37 scope)

| Divergence | Risk | Proposed sprint |
|---|---|---|
| `TransportKind` has `'tor'`/`'proxy'` but no adapters | Low (no config routes there) | Sprint 38+ |
| `transport-router` SOCKS5 not reused in active pipeline | Medium (duplication) | Sprint 38 gateway |
| `buildMockExecutionEngine()` exported from `local-api.ts` | Low (test helper, not production) | Sprint 38 cleanup |
| `/execute-mock` gating relies on `NODE_ENV`/env var | Low (consistent) | Sprint 39 |

---

## 12. Glossary

| Term | Definition |
|---|---|
| `isReal` | Boolean flag on `TransportAdapter` — `true` = real network I/O, `false` = deterministic mock |
| `resolvedKind` | `TransportKind` chosen by `TransportPolicyEngine` for a given request |
| `realSearXngEngine` | `ExecutionEngine` instance built with only `SearXngTransportAdapter`; `null` when disabled |
| `execute` | Production endpoint — real transport only, fail-closed |
| `execute-mock` | Test/dev endpoint — mock transport only, gated by env flag |
| `mockFallbackEnabled` | **Removed** option (PR #36). Dead code residue in 4 test files (no effect at runtime) |
