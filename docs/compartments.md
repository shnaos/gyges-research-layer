# Compartments

A **compartment** is GRL's unit of identity isolation. Each compartment owns its
own runtime state — session, user-agent, cookies, transport binding — and
**nothing is shared across compartments**. Compartmentalization is what stops a
single agent from collapsing unrelated research into one correlatable identity.

> Concept page. For the session lifecycle see [`session-manager.md`](session-manager.md);
> for cross-compartment access rules see [`privacy-boundaries.md`](privacy-boundaries.md);
> for per-category personas see [`persona-isolation.md`](persona-isolation.md).

## The problem

An agent that researches, say, finance and health from one shared browsing
context exposes a single identity: one cookie jar, one user-agent, one request
rhythm. Those signals correlate trivially. The fix is not anonymity — it is
**separation**: keep unrelated activity in isolated contexts so there is no
shared state to correlate.

## What a compartment owns

Each `IdentityCompartment` owns isolated state:

- a distinct **session** (`sessionId`)
- a separate **cookie jar**
- a **user-agent** not reused by another live compartment
- a single **transport binding** (no transport mixing within a compartment)
- a **DNS policy** appropriate to its transport

No cookies, sessions, user-agents, or transport state cross a compartment
boundary. This is a core design invariant, not a configuration option.

## Lifecycle

Compartments are created, reused, rotated, and expired by the
[session manager](session-manager.md):

- **create / reuse** — a request binds to its named compartment's session, or
  creates one if none exists;
- **rotate** — rotation regenerates the `sessionId`, clears cookies, and rotates
  the user-agent (and, where applicable, the transport-level circuit credential);
- **expire** — idle/TTL expiration tears down session state.

Rotation is **deterministic** — it is triggered by policy signals (persona /
category change, critical correlation risk, an assignment ceiling), never by
randomness.

## Compartments vs. personas vs. fragments

GRL layers three related notions; keep them distinct:

| Layer | Scope | Purpose |
|-------|-------|---------|
| **Compartment** | the named isolation unit (`research`, …) | owns session/identity state; the boundary nothing crosses |
| **Persona** | per research category *within* an agent | prevents one agent from forming a unified profile across domains — see [`persona-isolation.md`](persona-isolation.md) |
| **Identity fragment** | rotating metadata slice | reduces stable, linkable signatures — see [`behavioral-privacy.md`](behavioral-privacy.md) |

## Anti-correlation, honestly scoped

Compartment isolation reduces **logical/runtime** correlation — shared sessions,
cookies, user-agents, and stable identifiers. It does **not**, by itself,
provide network-level unlinkability: by default GRL uses a mock transport (no
real egress), and even the opt-in SearXNG transport is loopback-only. GRL is a
**privacy layer, not an anonymity network**. See
[`security/privacy-model.md`](security/privacy-model.md).

## Inspecting it

```bash
npm run dev:server
npm run cli -- privacy personas            # per-agent personas
npm run cli -- privacy bindings            # persona → fragment bindings
npm run cli -- trust                        # per-compartment trust profiles
```

The default runtime ships a single enabled compartment, `research`
(`packages/core/src/runtime-config/bootstrap.ts`).

## Related

- [`session-manager.md`](session-manager.md) — session create/rotate/expire
- [`privacy-boundaries.md`](privacy-boundaries.md) — cross-compartment access policy
- [`persona-isolation.md`](persona-isolation.md) — per-category personas
- [`capability-firewall.md`](capability-firewall.md) — capability authorization
