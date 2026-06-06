# Persona Isolation

**Sprint 25 — Identity Fragmentation & Search Persona Isolation**

---

## Why Personas?

When an agent performs many searches over time, the aggregate pattern of those searches can form a stable, recognisable **behavioural identity** — even if individual queries are never stored. An observer who can see enough requests can correlate:

- topics that co-occur frequently (interest graph)
- session timing patterns
- transport reuse across different categories
- accumulated context from repeated searches in the same domain

The Persona Isolation module breaks this accumulation by assigning each agent a **distinct, isolated persona per research category**. A persona bundles a fragment identity, a set of isolated session IDs, and a correlation-risk level. Switching categories creates a new persona with no inherited state from the previous one.

---

## Research Categories

GRL recognises nine categories, declared by the caller as a `categoryHint`:

| Category      | High-risk |
|---------------|-----------|
| `general`     | No        |
| `development` | No        |
| `research`    | No        |
| `unknown`     | No        |
| `finance`     | **Yes**   |
| `crypto`      | **Yes**   |
| `security`    | **Yes**   |
| `health`      | **Yes**   |
| `politics`    | **Yes**   |

High-risk categories receive stricter isolation decisions: transport isolation is always required, and correlation risk escalates faster.

---

## Interest Segmentation

The `InterestSegmentationEngine` evaluates whether the current request should trigger a rotation or escalation. It checks:

1. **Category change** — has the category changed from the current active persona?
2. **Saturation** — has the persona exceeded `maxSearchesPerPersona`?
3. **High-risk** — is the requested category in `HIGH_RISK_CATEGORIES`?
4. **Correlation risk** — is the existing persona at `high` or `critical` risk?

If any of these conditions is true, the engine sets `shouldRotate: true` in its evaluation result, and the `PersonaIsolationEngine` creates a fresh persona for the agent.

---

## Isolation Decisions

Every execute-mock request that carries a `categoryHint` produces a `PersonaIsolationDecision`:

```ts
interface PersonaIsolationDecision {
  personaId: string;
  requiresNewFragment: boolean;
  requiresSessionIsolation: boolean;
  requiresTransportIsolation: boolean;
  requiresBehavioralEscalation: boolean;
  reason: string;
}
```

The decision is **pure and deterministic** — the same inputs always produce the same output.

### Decision logic

| Condition | requiresNewFragment | requiresSessionIsolation | requiresTransportIsolation |
|-----------|--------------------|--------------------------|-----------------------------|
| New persona (first request) | true | true | true |
| Category change (rotation) | true | true | true |
| High-risk category | true | true | **always true** |
| Saturation rotation | true | true | true |
| No rotation, low risk | false | false | false |
| No rotation, medium/high risk | true | true | false |
| Critical correlation risk | true | true | true |

---

## Fragment Binding Lifecycle

Each persona is **bound** to one or more identity fragments (from the Sprint 24 `IdentityFragmentManager`). The binding lifecycle is:

1. **Create** — when a persona is created, a new fragment ID is generated and a `PersonaFragmentBinding` record is created with `active: true`.
2. **Use** — subsequent searches on the same persona reuse the same binding.
3. **Rotate** — when the persona rotates (category change, saturation, forced), the old binding is deactivated and a new binding is created for the new persona.
4. **List** — `listPersonaBindings(agentId?)` returns all bindings (active and historical) for metadata inspection.

Bindings are **never reused across personas**. A deactivated binding is retained for audit purposes only.

---

## Correlation Reduction Model

Correlation risk is computed per-persona from `searchCount` and the persona category:

| Category risk tier | `low` | `medium` | `high` | `critical` |
|--------------------|-------|----------|--------|------------|
| General/dev/research | <40% saturated | 40–75% | 75–99% | ≥100% |
| High-risk categories | <20% saturated | 20–50% | 50–99% | ≥100% |

("Saturated" means `searchCount / maxSearchesPerPersona`.)

Once a persona reaches `critical` risk, `requiresBehavioralEscalation` is set to `true` in the isolation decision, and the next `getOrCreatePersona` call triggers a forced rotation.

---

## Runtime Pipeline Integration

Persona isolation runs **after** behavioral privacy and **before** firewall evaluation in the execute-mock pipeline:

```
request
  → multi-agent isolation
  → behavioral privacy (Sprint 24)
  → persona isolation (Sprint 25)   ← HERE
  → interest segmentation           ← HERE
  → fragment selection              ← HERE
  → temporal scheduler
  → adaptive defense
  → firewall
  → transport / session
  → SearXNG
```

The pipeline gate:
1. Extracts `categoryHint` from the request input (optional — defaults to `'unknown'`).
2. Calls `evaluatePersonaIsolation()` to produce the decision (read-only).
3. Calls `getOrCreatePersona()` to materialise the persona (may create/rotate).
4. Emits audit events for persona_created, persona_fragment_bound, interest_segmentation_triggered, and persona_isolation_escalated as applicable.
5. Calls `recordPersonaSearch()` to update the search count and correlation risk.

---

## HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/privacy/personas` | List all personas (all agents) |
| `GET` | `/v1/privacy/personas/:agentId` | List personas for a specific agent |
| `GET` | `/v1/privacy/persona-bindings` | List all fragment bindings |
| `GET` | `/v1/privacy/persona-bindings/:agentId` | List bindings for a specific agent |
| `GET` | `/v1/privacy/segmentation-policies` | Current interest segmentation policy |

All responses contain **metadata only**. No raw queries, tokens, or inputs are ever returned.

---

## CLI Commands

```bash
# List all personas across all agents
grl privacy personas

# List personas for a specific agent
grl privacy personas local-agent

# List all persona-fragment bindings
grl privacy bindings

# List bindings for a specific agent
grl privacy bindings local-agent
```

Use `--output json` for machine-readable output.

---

## SDK Methods

```ts
const client = new GrlAgentClient()

// List all personas
const { personas } = await client.listPersonas()

// List personas for a specific agent
const { personas } = await client.getPersonas('agent-id')

// List persona-fragment bindings (optional agentId filter)
const { bindings } = await client.listPersonaBindings('agent-id')
```

---

## Audit Events

| Event type | When emitted |
|------------|-------------|
| `persona_created` | A new persona is created for an agent/category pair |
| `persona_rotated` | A persona rotation is triggered (category change, saturation, forced) |
| `persona_isolation_escalated` | Isolation decision requires behavioral escalation |
| `persona_fragment_bound` | A new fragment binding is created for a persona |
| `interest_segmentation_triggered` | The segmentation engine triggers rotation |

Events are emitted via the standard `SecurityEventEngine` and are visible at `GET /v1/audit/events`.

---

## What GRL Protects

- Prevents a single agent from reusing the same fragment identity across different research categories.
- Prevents accumulation of a cross-domain interest graph within a single session.
- Provides structural separation of high-risk research topics from each other.
- Ensures category switches produce observable, auditable rotation events.
- Exposes only metadata at all API boundaries — no raw queries, tokens, or inputs.

---

## What GRL Does NOT Protect

- **GRL does not guarantee anonymity.** A determined observer with access to multiple layers (network, timing, transport) may still correlate activity.
- **GRL does not prevent fingerprinting** at the network or transport level. Persona isolation is a software-layer mitigation only.
- **GRL does not replace Tor, a VPN, or a proxy.** Transport-level anonymity requires separate infrastructure.
- **GRL does not implement semantic analysis.** The `categoryHint` is always supplied by the caller — GRL cannot detect the true topic of a query.
- **GRL does not persist state across server restarts.** All persona data is in-memory only; restarts reset all personas.
- **GRL does not prevent a compromised caller** from supplying a false `categoryHint` to avoid rotation.

---

## Non-Goals

- No NLP or semantic classification of queries.
- No AI-driven category detection.
- No cross-agent correlation tracking.
- No cloud synchronisation or external storage.
- No anonymity guarantee.
- No Tor integration.
- No browser or crawler.

---

## Security Constraints

- **Fail-closed**: if the persona engine encounters an unexpected error, the request is denied.
- **Deterministic**: the same inputs always produce the same isolation decision.
- **Local-first**: all state is in-memory, never written to disk or sent to a remote service.
- **Metadata minimisation**: API responses never include raw queries, user inputs, tokens, or secrets.
- **Explicit isolation**: isolation is always explicit and observable via audit events — never silent.


---

## Sprint 26 extension: Temporal Obfuscation

Sprint 26 adds a dedicated **Temporal Obfuscation & Query Scheduling** engine that operates after persona isolation. It reduces cadence patterns, burst signatures, and temporal density accumulation that persona isolation alone does not address.

See [`docs/temporal-obfuscation.md`](./temporal-obfuscation.md) for the full Sprint 26 surface.
