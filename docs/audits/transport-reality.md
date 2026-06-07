# Transport Reality Audit (Sprint 31)

Verified by reading the transport code and grepping every network primitive in
`packages/*/src` and `apps/*/src` (excluding `dist`).

## The single real transport: SearXNG

`packages/core/src/transports/searxng/adapter.ts` is the only real network egress
in the **active** runtime. Findings:

- It performs a real `fetch(url, …)` (line ~186) with a hard `AbortController`
  timeout, **no cookies, no auth, minimal headers**.
- `baseUrl` is **loopback-enforced**: `packages/core/src/transports/searxng/config.ts`
  restricts the host to `127.0.0.1`, `localhost`, `::1`, `[::1]`. A non-loopback
  URL is rejected **even when the adapter is explicitly enabled** (fail-closed).
- It is reached only through the execution engine + sandbox
  (`SEARXNG_SANDBOX_POLICY`), never directly.

### It is OFF by default

- `DEFAULT_RUNTIME_CONFIG` (`packages/core/src/runtime-config/bootstrap.ts`) has
  **no `transports.searxng`** key → `buildSearXngExecutionEngine` returns `null`.
- The bootstrap transport policy routes `search` → **`mock`**
  (`packages/core/src/transport-policy/bootstrap.ts`).
- Therefore, out of the box, **even `POST /v1/capabilities/execute` runs the mock
  transport**. Real network requires the operator to: (a) enable
  `transports.searxng.enabled=true` with a loopback `baseUrl`, (b) add a transport
  policy rule routing `search`→`searxng`, and (c) run a local SearXNG instance.

### Fail-closed paths (real, pipeline-triggered)

In `execute`, when routing resolves `searxng`: if disabled, if the engine is
absent, or for any non-`mock`/`searxng` kind → `decision: 'denied'` (no network).
HTTP-tested in `apps/grl-server/test/execute-api.test.ts` and
`network-isolation-api.test.ts`.

## No hidden transport (active runtime)

`grep` of network primitives across source:

| Location | Primitive | Status |
|---|---|---|
| `packages/core/src/transports/searxng/adapter.ts` | `fetch` | ✅ the one real transport (loopback) |
| `packages/agent-sdk/src/client.ts` | `fetch` | ✅ SDK → local API only |
| `apps/grl-cli/src/client/api-client.ts` | `fetch` | ✅ CLI → local API only |
| `packages/transport-router/src/index.ts` | `net.connect`, `tls.connect`, `fetch` | ⚠ **legacy SOCKS/tor/proxy** — imported **only** by `apps/grl-server/src/index.ts` (legacy port-3000 server), **NOT** by the active `local-api.ts` |
| `packages/search-adapter-searxng/src/index.ts` | `fetch` | ⚠ legacy adapter — legacy server only |
| `apps/grl-server/src/local-api.ts` | — | ✅ **zero** network primitives; delegates to the execution-engine adapter |

The `dns` matches in `local-api.ts` are the `dnsPolicy` **metadata** field
(network-isolation), not the node `dns` module.

This is enforced as an executable invariant by
`npm run audit:coherence` and `npm run audit:mocks`, and pinned by
`apps/grl-server/test/audit-reality.test.ts`.

## Tor / proxy / VPN

- The active runtime has **no** Tor, proxy, or VPN. The `tor`/`proxy`
  SOCKS5 transports exist only in the **legacy** `packages/transport-router` used
  by the legacy `apps/grl-server/src/index.ts` (port 3000), which is a separate,
  Sprint-2-era server and not the documented/active entrypoint (`dev:server` →
  `local-api.ts`).

## Verdict

| Aspect | Verdict |
|---|---|
| SearXNG adapter executable | **Yes** — real loopback HTTP when enabled |
| Wired into active runtime | **Yes**, but disabled by default (mock fallback) |
| Default behaviour | **mock-only** (no network) |
| Fail-closed | **Yes** — non-loopback rejected, disabled→deny, no fallback to network |
| Hidden/implicit transport | **None** in the active runtime (enforced by audit scripts) |
| Tor/proxy/VPN | **None** in active runtime (legacy server only) |

**Transport reality: local-prod-ready when SearXNG is explicitly configured with a
local instance; demo/mock-ready by default.**
