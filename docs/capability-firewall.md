# Capability Firewall

The capability firewall is GRL's primary authorization gate. It answers one
question, deterministically: **is this agent allowed to use this tool, in this
compartment, at this risk level?** If no explicit rule says yes, the answer is
**no**.

> This is a developer-facing concept page. For the surrounding pipeline see
> [`architecture.md`](architecture.md); for the policy data model see
> [`policy-engine.md`](policy-engine.md); for human-in-the-loop escalation see
> [`human-approval.md`](human-approval.md).

## Where it sits

In the active core pipeline (`packages/core`, served by the local API on
`127.0.0.1:8787`), the firewall runs after the capability graph and trust /
adaptive-defense gates, and before the privacy boundary:

```
capability graph → trust / adaptive defense → CAPABILITY FIREWALL →
approval queue → privacy boundary → session → transport policy →
sandbox → execution → audit
```

Each gate can deny independently. The firewall is the gate that enforces the
explicit allow rules.

## The contract

A capability request carries **no transport and no identity** — the agent
cannot ask for `direct`, `tor`, or a specific session:

```jsonc
{
  "agentId": "local-agent",
  "compartmentId": "research",
  "tool": "search",
  "riskLevel": "low",
  "input": "ring of gyges privacy"
}
```

The firewall resolves this against the loaded firewall policies and returns
`allowed`, `denied`, or `pending-approval`.

## Decision rules

- **Deny-by-default.** A request is denied unless an explicit firewall policy
  rule matches `agentId + compartmentId + tool`.
- **Risk ceiling.** Each rule declares a `maxRiskLevel`. A request above that
  ceiling is denied (or escalated to approval, see below).
- **Confirmation band.** A rule may set `requiresConfirmationAbove`; requests
  above that level become `pending-approval` and enter the approval queue
  rather than executing.
- **Fail-closed.** A malformed request, an unknown tool, or any internal error
  produces `deny`, never `allow`.

The bootstrap configuration (`packages/core/src/runtime-config/bootstrap.ts`)
ships exactly one allowed combination so the runtime is safe out of the box:

| agentId | compartmentId | tools | maxRiskLevel |
|---------|---------------|-------|--------------|
| `local-agent` | `research` | `search`, `fetch_html`, `fetch_json` | `low` |
| `local-agent` | `research` | `fetch_html` | `medium` (confirm above `low`) |

Any other agent, compartment, or tool is denied. This is why a request from
`research-agent` (no matching rule) returns
`decision: denied — "Denied by default policy."`, while the same request from
`local-agent` returns `decision: allowed — "Allowed by explicit policy rule."`.

## What it does *not* do

- It does **not** select a transport — that is the transport-policy gate
  ([`transports.md`](transports.md)).
- It does **not** classify the semantic content or maliciousness of a query.
- It does **not** sanitize results — adapters and the sandbox handle execution.
- It is **not** an anonymity control. The firewall governs *capability*, not
  network unlinkability.

## Inspecting it

```bash
npm run dev:server
npm run cli -- search "privacy research"   # allowed path (local-agent/research)
npm run cli -- audit                        # see capability_allowed / capability_denied events
```

The firewall emits a `capability_firewall` policy signal consumed by the
[runtime policy orchestrator](runtime-policy-orchestrator.md); on denial that
signal is `critical` and the composite decision is `deny`.

## Related

- [`policy-engine.md`](policy-engine.md) — the policy data model (and the legacy YAML engine)
- [`capability-graph.md`](capability-graph.md) — transition rules feeding the firewall
- [`human-approval.md`](human-approval.md) — the approval queue for `pending` decisions
- [`compartments.md`](compartments.md) — how compartments isolate identity
- [`security/defensive-guarantees.md`](security/defensive-guarantees.md) — formal guarantees
