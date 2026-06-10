# Transports

A **transport** is how a capability actually reaches (or doesn't reach) the
network. In GRL the transport is **decided by policy, never by the agent**, and
the active runtime is deliberately minimal: a mock transport by default, and one
opt-in, loopback-only real transport.

> Concept page. For the routing gate's place in the pipeline see
> [`architecture.md`](architecture.md); for the per-transport permission sandbox
> see [`transport-registry-sandbox.md`](transport-registry-sandbox.md); for the
> SearXNG adapter see [`searxng-transport.md`](searxng-transport.md).

## The core rule

The agent submits a capability request with **no transport field**. The
transport-policy gate resolves the transport kind from policy
(`transportPolicies`). If an agent asserts a transport, the request is rejected
— there is no escalation and no silent downgrade to direct.

## What the active runtime actually has

This section is intentionally precise; see the verified audits in
[`audits/transport-reality.md`](audits/transport-reality.md) and
[`audits/mock-boundaries.md`](audits/mock-boundaries.md).

| Transport | Status in active runtime | Network effect |
|-----------|--------------------------|----------------|
| `mock` | **default** | none — synthetic, deterministic results |
| `searxng` | **opt-in, off by default** | real HTTP, **loopback-only** (`127.0.0.1`/`localhost`/`::1`) |

- **Default = mock.** Out of the box, even `POST /v1/capabilities/execute` runs
  the mock transport. No real network request is made.
- **The one real transport is SearXNG.** `packages/core/src/transports/searxng/`
  performs a real `fetch` with a hard timeout, **no cookies, no auth, minimal
  headers**. Its `baseUrl` is **loopback-enforced** — a non-loopback URL is
  rejected even when the adapter is explicitly enabled (fail-closed).
- Enabling real search requires the operator to (a) set
  `transports.searxng.enabled = true` with a loopback `baseUrl`, (b) add a
  transport-policy rule routing `search` → `searxng`, and (c) run a local
  SearXNG instance.

## Fail-closed routing

When routing resolves `searxng` but the adapter is disabled, the engine is
absent, or the kind is anything other than `mock`/`searxng`, the request is
**denied** — never downgraded to an unintended network path. This is
HTTP-tested in `apps/grl-server/test/execute-api.test.ts`.

## What the active runtime does NOT have

- **No Tor, no proxy, no VPN, no SOCKS** in the active runtime.
- **No browser, no crawler, no scraping engine.**
- **No real web-fetch transport.** `fetch_html` / `fetch_json` are allowed
  capability *names* in the default policy (they route to `mock`, like `search`),
  but there is **no real HTML/JSON fetch behind them** — execution is mock. A
  real web-fetch tool remains a roadmap non-goal. The only real network egress is
  the opt-in, loopback-only SearXNG **search** adapter above.

The `tor` / `proxy` SOCKS5 transports exist **only** in the legacy
`packages/transport-router`, used by the legacy port-3000 server
(`apps/grl-server/src/index.ts`) — not by the active `dev:server` runtime. The
conceptual diagram in [`architecture.md`](architecture.md) and
[`transport-routing.md`](transport-routing.md) describe that legacy design.

## Not an anonymity layer

Choosing a transport by policy and isolating identities reduces *unnecessary*
correlation. It does **not** make traffic anonymous. GRL is a privacy layer — it
is not Tor, not a VPN, and makes no promise of invisibility or anti-detection.
See [`security/privacy-model.md`](security/privacy-model.md) and the
[`network-isolation.md`](network-isolation.md) reconciliation note (the relay /
route model is **metadata/logical only** — there is no real network relay).

## Inspecting it

```bash
npm run dev:server
npm run cli -- transports          # available transport kinds
npm run cli -- network relays      # logical relay profiles (metadata)
npm run cli -- network routes      # per-compartment logical routes (metadata)
```

A search response includes a `routing` block (`transportKind`, `isolationLevel`)
and an `execution` block (`status`, `transportKind`, `output`).

## Related

- [`searxng-transport.md`](searxng-transport.md) — the one real adapter
- [`transport-registry-sandbox.md`](transport-registry-sandbox.md) — per-transport permissions
- [`transport-fingerprint.md`](transport-fingerprint.md) — deterministic header isolation
- [`network-isolation.md`](network-isolation.md) — logical relay/route abstraction
- [`audits/transport-reality.md`](audits/transport-reality.md) — verified transport reality
