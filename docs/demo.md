# Demonstration — input → decision → execution → audit

This walkthrough makes GRL tangible. A research agent attempts a web search;
GRL applies policy, binds an isolated compartment, executes through the resolved
transport, and records an audit trail. **All output below is real**, captured
from the local runtime on the default `balanced` profile (mock transport — no
real network request).

> Prerequisites: the quickstart ([`quickstart.md`](quickstart.md)) through
> `npm run dev:server`. Then, in a second terminal, run the commands below — or
> the bundled scripts in `examples/quickstart/`.

---

## 1. Deny-by-default (the safe baseline)

An agent with **no matching policy rule** is denied before anything executes:

```bash
curl -s -X POST http://127.0.0.1:8787/v1/capabilities/execute \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"research-agent","compartmentId":"research","tool":"search","riskLevel":"low","input":"ring of gyges privacy"}'
```

```jsonc
{
  "decision": "denied",
  "reason": "Denied by default policy.",
  "runtimePolicy": {
    "action": "deny",
    "reason": "Composite policy selected \"deny\" from capability_firewall: Denied by default policy."
    /* … per-gate signals … */
  }
}
```

Nothing reached the privacy boundary, session, transport, or execution stages.
This is the firewall doing its job — see [`capability-firewall.md`](capability-firewall.md).

---

## 2. The allowed flow

The bootstrap config allows exactly one combination: `agentId: local-agent`,
`compartmentId: research`, `tool: search`, `riskLevel: low`.

### Input

```bash
curl -s -X POST http://127.0.0.1:8787/v1/capabilities/execute \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"local-agent","compartmentId":"research","tool":"search","riskLevel":"low","input":"ring of gyges privacy"}'
```

### Decision

GRL evaluates every gate. Abbreviated response:

```jsonc
{
  "decision": "allowed",
  "reason": "Allowed by explicit policy rule.",

  "capabilityGraph": { "action": "allow", "risk": "low" },

  "privacyBoundary": {
    "action": "allow",
    "signals": ["same_compartment"],
    "reason": "Access within privacy boundary \"research\" -> \"research\"; no correlation violation."
  },

  "routing": {
    "transportKind": "mock",
    "isolationLevel": "session",
    "shouldRotateSession": false,
    "reason": "reuse_allowed"
  },

  "trust": { "compartmentId": "research", "score": 68, "level": "neutral" },

  "networkIsolation": {
    "allowed": true,
    "isolationLevel": "isolated",
    "relayRouteId": "route-001",
    "reason": "Reused stable relay route for compartment \"research\"."
  }
}
```

### Execution

The resolved transport runs. On the default profile this is the **mock**
transport — deterministic, no network:

```jsonc
{
  "execution": {
    "status": "success",
    "transportKind": "mock",
    "output": {
      "mock": true,
      "tool": "search",
      "input": "ring of gyges privacy",
      "sessionId": "68dc486d-5fdf-4e90-b895-0d75173ea836"
    }
  },
  "appliedDelayMs": 0,
  "fingerprint": { "rotated": true, "correlationRisk": "low" },
  "sandbox": { "action": "allow", "violations": [] }
}
```

The composite `runtimePolicy` block confirms the decision and lists every gate's
signal (`capability_graph`, `multi_agent`, `trust_reputation`,
`behavioral_privacy`, `persona_isolation`, `temporal_obfuscation`,
`capability_firewall`) — informational, while each gate enforces independently.

### Audit

Every step is recorded in the append-only trail:

```bash
npm run cli -- audit
```

```
capability_graph_allowed          Capability graph allowed the execution path.
persona_fragment_bound            Persona bound to identity fragment.
capability_allowed                Capability allowed by firewall.
network_isolation_enforced        Network isolation enforced.
routing_resolved                  Transport routing resolved.
fingerprint_assigned              Transport fingerprint assigned.
execution_started                 Execution started.
sandbox_allowed                   Adapter sandbox allowed execution.
execution_succeeded               Execution success.
trust_score_changed               Compartment trust score changed.
trust_recovered                   Compartment trust recovered.
runtime_policy_decision_applied   Runtime policy decision applied: action="allow".
```

The audit trail records **decisions and metadata only** — raw query content is
never persisted.

---

## 3. Run it as a script

The same flow is bundled as runnable demos:

```bash
# CLI demo (health → search → audit → trust → runtime → transports)
./examples/quickstart/cli-demo.sh

# SDK demo (typed @gyges/agent-sdk client)
npx tsx examples/quickstart/sdk-demo.ts
```

---

## What this demonstrates (and what it doesn't)

**Demonstrates:** deny-by-default authorization, compartment-scoped identity,
policy-decided transport, deterministic gating, and complete auditability — all
local, in-memory, no telemetry.

**Does not demonstrate:** anonymity, Tor/VPN routing, or real web egress. The
default transport is mock; the only real transport is the opt-in, loopback-only
SearXNG adapter ([`transports.md`](transports.md)). GRL is a privacy layer, not
an anonymity network.

## Related

- [`quickstart.md`](quickstart.md) · [`capability-firewall.md`](capability-firewall.md)
  · [`compartments.md`](compartments.md) · [`transports.md`](transports.md)
- [`cli.md`](cli.md) · [`agent-sdk.md`](agent-sdk.md)
