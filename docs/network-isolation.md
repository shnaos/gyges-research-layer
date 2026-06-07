# Privacy Transport Relay & Network Isolation Layer (Sprint 30)

Sprint 30 adds GRL's first **network privacy layer**: a purely **logical**
relay / route abstraction with compartment-level route separation, a DNS
isolation *metadata model*, and deterministic relay rotation policies.

## What this is — and is not

This layer exists to **reduce unnecessary cross-correlation between outbound
research activities**. Its goal is *not* "hide the agent"; its goal is
"reduce unnecessary cross-correlation between outbound research activities" —
specifically:

- trivial network correlation,
- cross-persona interest aggregation,
- implicit reuse of the same network route across unrelated compartments,
- trivially stable network signatures.

### Explicit non-promises

GRL remains a **privacy layer, not an anonymity system**. This sprint changes
nothing about that:

- GRL is **NOT** an anonymity network.
- GRL does **NOT** replace Tor and does **NOT** route over Tor, a proxy, or a VPN.
- GRL makes **NO** promise of invisibility.
- GRL provides **NO** anti-forensics (it emits an audit trail by design).
- GRL provides **NO** anti-detection or anti-bot capability.
- GRL does **NOT** make a request untraceable and does **NOT** make the agent anonymous.

There is **no real network machinery** in this layer at all. There is no Tor,
no proxy, no VPN, no SOCKS, no DNS resolver, no browser, no headless automation,
no cloud relay, and no network egress. Relays and routes are **opaque local
identifiers and structural metadata** — they represent no real endpoint.

## What is stored — and what is never stored

Stored (in-memory, metadata only): opaque relay profile ids, opaque route ids
(`route-001`, …), compartment/persona/fragment **scope identifiers**, isolation
levels, timestamps, and assignment counts.

**Never stored, anywhere:** an IP address, hostname, URL, DNS name, network
endpoint, credential, token, secret, or raw caller input.

## Model

### Relay profile

A logical relay. Opaque, local-only. Carries no host/IP/endpoint.

| Field | Meaning |
|---|---|
| `id` | opaque local id (e.g. `local-default`) |
| `name` | human label |
| `enabled` | whether routes may be assigned from it |
| `isolationLevel` | `shared` \| `isolated` \| `strict` |
| `supportsDnsIsolation` | whether it can carry per-scope DNS isolation metadata |
| `tags` | free-form labels |
| `createdAt` | unix-ms |

A bootstrap profile `local-default` (`isolated`, DNS-isolation capable) is seeded
at startup.

### Relay route & compartment binding

Each compartment is bound to exactly one **active** logical route (`RelayRoute`,
opaque id). The `NetworkCompartmentBinding` makes that mapping stable so a
compartment keeps a deterministic route — and so two different compartments never
share a route (no cross-compartment route reuse).

### Route isolation model

| `RelayIsolationLevel` | Meaning |
|---|---|
| `shared` | route may be shared across compartments (least isolation) |
| `isolated` | route bound to a single compartment (default) |
| `strict` | route bound to a single compartment and rotated aggressively |

**Default rule:** the `research` compartment (and any compartment) receives an
`isolated` relay route.

### DNS isolation policy — metadata model only

`DnsIsolationPolicy` records operator intent only. **GRL performs no real DNS
resolution and ships no resolver.** The policy drives runtime decisions and
auditability:

| Field | Meaning |
|---|---|
| `enabled` | DNS isolation intent is active |
| `isolatePerCompartment` | separate DNS scope per compartment |
| `isolatePerPersona` | separate DNS scope per persona |
| `isolatePerFragment` | separate DNS scope per identity fragment |

### Relay rotation policy

`RelayRotationPolicy` decides when a compartment's route rotates:

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | rotation active |
| `rotateOnPersonaChange` | `true` | rotate when the persona changes |
| `rotateOnCategoryChange` | `true` | rotate when the research category changes |
| `rotateOnCriticalRisk` | `true` | rotate on a critical behavioral/privacy risk |
| `maxAssignmentsPerRoute` | `50` | rotate once a route has been used this many times |

## NetworkIsolationEngine

Deterministic, in-memory, fail-closed. Key methods: `registerRelayProfile`,
`assignRoute`, `resolveRoute`, `rotateRoute`, `listRelayProfiles`, `listRoutes`,
`listBindings`, `getBinding`, `evaluateIsolation`.

`evaluateIsolation(context)` returns a `RouteSelectionDecision`:

```ts
interface RouteSelectionDecision {
  allowed: boolean;
  relayProfileId?: string;
  relayRouteId?: string;
  isolationLevel: RelayIsolationLevel;
  shouldRotate: boolean;
  reason: string;
}
```

**Fail-closed rules** (`allowed: false`):

- the compartment is quarantined,
- the outbound transport is disabled,
- no enabled relay is available.

Otherwise the engine ensures the compartment has a route (assigning one on first
sight), rotates it when the rotation policy demands (persona/category change,
critical risk, or assignment ceiling), and returns the effective route.

The retained-routes list is **bounded** (`maxRoutes`, default 500) with FIFO
eviction of inactive routes — memory can never grow without bound.

## Execute integration

The network-isolation gate runs in both `POST /v1/capabilities/execute` and
`POST /v1/capabilities/execute-mock`, after the capability firewall and before
transport routing:

```
persona isolation → behavioral privacy → network isolation → transport policy → fingerprint → sandbox → SearXNG
```

Every decision response carries a `networkIsolation` block:

```json
{
  "networkIsolation": {
    "allowed": true,
    "relayProfileId": "local-default",
    "relayRouteId": "route-001",
    "isolationLevel": "isolated",
    "shouldRotate": false
  }
}
```

A fail-closed route-selection decision denies the request.

## Runtime policy integration

The gate emits a `network_isolation` runtime policy signal consumed by the
[Runtime Policy Orchestrator](./runtime-policy-orchestrator.md):

| Situation | `action` | `severity` |
|---|---|---|
| route assigned / reused | `allow` | `info` |
| route rotated | `rotate_identity` | `medium` |
| fail-closed (quarantine / no relay / transport disabled) | `deny` | `critical` |

`rotate_identity` is part of GRL's rotation action family (alongside
`rotate_session` / `rotate_fragment` / `rotate_fingerprint`) and surfaces as
`requiresIdentityRotation` on the composite decision. (`require_approval` and
`rotate_session` are also valid `network_isolation` actions but are not emitted
by the MVP gate.)

## Audit events

| Event | When |
|---|---|
| `relay_route_assigned` | a compartment's first route is assigned |
| `relay_route_rotated` | a compartment's route is rotated |
| `network_isolation_enforced` | an allowed isolation decision is applied |
| `network_isolation_denied` | a fail-closed isolation decision |

All carry minimal metadata only (isolation level, opaque route id, rotation
flag). Never a host, IP, DNS name, endpoint, or token.

## HTTP endpoints (metadata only)

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/network/relays` | relay profiles (`?limit=`) |
| `GET` | `/v1/network/routes` | logical routes (`?limit=`) |
| `GET` | `/v1/network/bindings` | compartment bindings (`?limit=`) |
| `GET` | `/v1/network/isolation` | DNS + rotation policy metadata |

An invalid `limit` is rejected fail-closed with HTTP 400. Responses never carry a
host, IP, URL, DNS name, endpoint, credential, or raw input.

## CLI

```bash
grl network relays
grl network routes --limit 20
grl network bindings --json
grl network isolation
```

## SDK

```ts
const relays   = await client.listRelayProfiles({ limit: 20 });
const routes   = await client.listRelayRoutes();
const bindings = await client.listNetworkBindings();
const policies = await client.getNetworkIsolation();
```

## Limits

- Routes and DNS scopes are **logical metadata only** — they do not change how
  any real packet is routed or resolved.
- The pipeline currently triggers rotation on persona/category change (via the
  scope identifier) and the assignment ceiling; richer critical-risk wiring is
  reserved for a future sprint (the engine already supports it).
- In-memory only; state is cleared on restart.
