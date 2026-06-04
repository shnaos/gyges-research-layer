# Session Manager & Identity Compartments (Sprint 7)

Sprint 7 introduces the first **Session Manager** and formalises **Identity
Compartments** for the Gyges Research Layer. It defines *which session identity*
an authorised execution runs under — when a session is reused, rotated, expired,
or revoked — while shipping **no real network, browser, or persistence**.

> **Scope note (Sprint 7).** This layer performs **no real network I/O**. There
> is no `fetch`, no DNS resolution, no socket, no Tor, no proxy, no SearXNG, no
> browser automation, no database, and no Redis. All state is held **in memory**
> and is lost when the process exits. The Session Manager is strictly separate
> from the Transport Adapter layer: it decides session *identity*, never how a
> connection is opened.

## Where the Session Manager sits

```
Local agent / local UI
        │
        ▼
   GRL Local API            (apps/grl-server)
        │
        ▼
 Capability Firewall        (@gyges/core — deny-by-default decision)
        │
        ▼
   Approval Queue           (@gyges/core — human-in-the-loop, when required)
        │
        ▼
   Session Manager          (@gyges/core — mints/reuses/rotates sessions)
        │
        ▼
  Execution Engine          (@gyges/core — selects a transport, runs it)
        │
        ▼
  Transport Adapter         (@gyges/core — Mock transport only)
```

## Identity Compartments

An **Identity Compartment** is a named isolation boundary that owns sessions.
It groups sessions that share a transport kind and a reuse/rotation policy. A
compartment carries **no secrets, credentials, or real transport configuration**
— only the metadata needed to mint and rotate sessions deterministically.

```ts
interface IdentityCompartment {
  id: string;
  label?: string;
  transportKind: TransportKind;     // 'mock' in this sprint
  reusePolicy: SessionReusePolicy;  // 'reuse_active' | 'always_rotate'
  ttlMs: number;                    // session lifetime
  maxRequests: number;              // recorded-use ceiling before rotation
  createdAt: number;
}
```

Compartments are **statically bootstrapped**. There is intentionally **no
dynamic creation endpoint** in this sprint — the goal is a stable read surface
before any write surface is exposed.

## Sessions and their lifecycle

A **session** is a single identity minted for a compartment. Its public shape
carries **no token, credential, or transport handle** — only lifecycle metadata:

```ts
interface SessionRecord {
  sessionId: string;
  compartmentId: string;
  transportKind: TransportKind;
  status: SessionStatus;            // 'active' | 'rotated' | 'expired' | 'revoked'
  createdAt: number;
  expiresAt: number;
  requestCount: number;
  lastUsedAt?: number;
}
```

A session starts `active` and reaches exactly one terminal state. Terminal
states never transition again:

```
active ──maxRequests reached / always_rotate──▶ rotated  (terminal)
active ──TTL elapsed──────────────────────────▶ expired  (terminal)
active ──revokeSession────────────────────────▶ revoked  (terminal)
```

## `reuse_active` vs `always_rotate`

- **`reuse_active`** — `getOrCreateSession` reuses the compartment's active
  session when it is **non-expired**, **non-revoked**, and **below
  `maxRequests`**. When the request ceiling has been reached, the session is
  marked `rotated` and a fresh one is minted. When none is reusable, a new
  session is created.
- **`always_rotate`** — every call to `getOrCreateSession` marks any active
  session `rotated` and mints a brand-new session, so each request runs under a
  fresh identity.

## TTL and `maxRequests`

- **TTL (`ttlMs`)** — `expiresAt = createdAt + ttlMs`. An active session past
  its TTL becomes `expired`. Expiry is applied lazily on access and can also be
  forced in bulk via `expireOldSessions()`.
- **`maxRequests`** — each successful `recordUse` increments `requestCount`.
  Once `requestCount` reaches `maxRequests`, the next `getOrCreateSession`
  rotates the session and mints a new one.

`recordUse` increments `requestCount` and stamps `lastUsedAt`. It throws when
the session is unknown, or when it is `expired`, `rotated`, or `revoked`.

## SessionManager API

```ts
registerCompartment(compartment: IdentityCompartment): void   // throws on duplicate
getCompartment(compartmentId: string): IdentityCompartment | undefined
getOrCreateSession(compartmentId: string): SessionRecord      // throws on unknown compartment
rotateSession(compartmentId: string): SessionRecord
revokeSession(sessionId: string): void                        // throws on unknown session
expireOldSessions(): number
listSessions(compartmentId?: string): SessionRecord[]
recordUse(sessionId: string): SessionRecord                   // throws on unknown / non-active
toSessionContext(session: SessionRecord): SessionContext
```

Unknown compartments, duplicate registrations, unknown sessions, and uses of a
non-active session all raise a typed `SessionManagerError`. Returned records are
**defensive copies** — callers cannot mutate the manager's internal state.

## How `execute-mock` uses the Session Manager

`POST /v1/capabilities/execute-mock` evaluates the firewall first, then:

- **denied** — no session is created; no execution happens.
- **pending** — an approval request is enqueued; **no session is created**; no
  execution happens.
- **allowed** — `getOrCreateSession('research')` returns a session identity
  (reused or rotated per the compartment policy). The request is executed
  through the **mock** transport. `recordUse(sessionId)` is called **only when
  the execution was actually launched** — a fail-closed `blocked` result (no
  adapter registered for the transport kind) does **not** consume the session's
  request budget.

## Local read/debug endpoints

These endpoints expose **only metadata** — never a token or secret.

| Method & path                            | Description                                   |
| ---------------------------------------- | --------------------------------------------- |
| `GET /v1/compartments`                   | List bootstrapped compartments                |
| `GET /v1/sessions`                       | List all sessions                             |
| `GET /v1/sessions?compartmentId=research`| List sessions for a specific compartment      |

There is **no** create/update/delete endpoint for compartments or sessions in
this sprint.

### Example: list compartments

```bash
curl -s http://127.0.0.1:8787/v1/compartments
```

```json
{
  "compartments": [
    {
      "id": "research",
      "label": "Default research compartment",
      "transportKind": "mock",
      "reusePolicy": "reuse_active",
      "ttlMs": 600000,
      "maxRequests": 25,
      "createdAt": 1730000000000
    }
  ]
}
```

### Example: run a mock execution, then inspect sessions

```bash
curl -s -X POST http://127.0.0.1:8787/v1/capabilities/execute-mock \
  -H 'content-type: application/json' \
  -d '{
        "agentId": "local-agent",
        "compartmentId": "research",
        "tool": "search",
        "riskLevel": "low",
        "input": "privacy-preserving research"
      }'

curl -s 'http://127.0.0.1:8787/v1/sessions?compartmentId=research'
```

```json
{
  "sessions": [
    {
      "sessionId": "5e0b…",
      "compartmentId": "research",
      "transportKind": "mock",
      "status": "active",
      "createdAt": 1730000000000,
      "expiresAt": 1730000600000,
      "requestCount": 1,
      "lastUsedAt": 1730000000123
    }
  ]
}
```

## Environment variables

The bootstrap `research` compartment is configured from the environment. Each
value is injectable in tests via `resolveServerConfig(env)`, so configuration is
testable without mutating global state.

| Variable                     | Default        | Meaning                              |
| ---------------------------- | -------------- | ------------------------------------ |
| `GRL_SESSION_TTL_MS`         | `600000`       | Session time-to-live in milliseconds |
| `GRL_SESSION_MAX_REQUESTS`   | `25`           | Recorded-use ceiling before rotation |
| `GRL_SESSION_REUSE_POLICY`   | `reuse_active` | `reuse_active` or `always_rotate`    |

Invalid or out-of-range values fall back to the defaults.

## Separation from the Transport Adapter

The Session Manager **does not** open connections, resolve DNS, or talk to any
transport. It only mints and tracks session *identities* and maps them to a
minimal `SessionContext`. The Execution Engine then selects a Transport Adapter
by `session.transportKind`. In Sprint 7 the only adapter is the
`MockTransportAdapter`; no `direct`/`tor`/`proxy`/`searxng`/`browser` transport
performs any real I/O.

## What is intentionally absent

- No real network, `fetch`, Tor, proxy, SearXNG, or browser automation.
- No persistence: no database, no Redis, no disk state.
- No dynamic compartment creation surface.
- No auth/JWT, telemetry, websocket/SSE, or UI.
- No coupling to any external business product.
