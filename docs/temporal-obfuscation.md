# Temporal Obfuscation & Query Scheduling

## Overview

The Temporal Obfuscation module (Sprint 26) reduces exploitable temporal correlation
signatures produced by AI agents when making web search requests. It does **not** provide
network-level anonymity and does **not** replace Tor or other anonymization infrastructure.

---

## What GRL Reduces

- **Burst patterns**: rapid clusters of requests within short windows
- **Fixed cadence**: perfectly regular inter-request spacing that is easy to fingerprint
- **Predictable schedules**: recurring activity at stable time-of-day patterns
- **Query clustering**: temporal grouping of requests that reveals research sessions
- **Behavioral rhythms**: consistent pacing, transition speeds, or ordering patterns
- **Temporal density**: sustained high-frequency activity accumulation

---

## What GRL Does NOT Protect Against

- Network-level traffic analysis by ISPs, CDNs, or intermediate observers
- Global de-anonymization (IP correlation, browser fingerprinting, TLS metadata)
- Correlation across multiple sessions by the same or external parties
- Search engine-side profiling based on query content
- Timing side-channels below the transport layer
- Persistent adversaries with access to full request logs

GRL makes no claim of guaranteed anonymity, untraceability, or equivalence to Tor.

---

## Architecture

```
Agent Request
    ↓
Behavioral Privacy (Sprint 24)
    ↓
Persona Isolation (Sprint 25)
    ↓
Temporal Obfuscation Engine  ← Sprint 26
    ↓
Scheduling Decision
    ↓
Cadence Smoothing
    ↓
Burst Fragmentation
    ↓
Temporal Privacy Budget
    ↓
Transport / SearXNG
```

---

## Components

### TemporalObfuscationEngine

The main orchestrator. Maintains per-agent `TemporalProfile` records in-memory.

**Key methods:**
- `getOrCreateProfile(agentId)` — retrieve or create a temporal profile
- `evaluateTemporalRisk(agentId, now)` — compute a full `TemporalObfuscationDecision`
- `recordExecution(agentId, now)` — update profile after execution
- `applyDecay(agentId, now)` — decay burst counters over time
- `listProfiles()` — return defensive copies of all profiles
- `clear()` — reset all state

### CadenceSmoothingEngine

Detects regular request cadence (low inter-request variance) and recommends adaptive
delays to break predictable rhythms.

**Cadence risk levels:**

| Level    | Condition                                        |
|----------|--------------------------------------------------|
| critical | Request < 100 ms after previous                  |
| high     | Request < 50% of minSpacingMs, or CV < 0.05 with ≥ 5 timestamps |
| medium   | CV < 0.15 with ≥ 4 timestamps, or below minSpacingMs |
| low      | No detectable pattern                            |

**Policy parameters (`CadenceSmoothingPolicy`):**

| Parameter        | Default | Description                             |
|------------------|---------|-----------------------------------------|
| enabled          | true    | Enable/disable cadence smoothing        |
| minSpacingMs     | 200     | Minimum inter-request spacing           |
| adaptiveSpacing  | true    | Scale delay by risk level               |
| burstPenaltyMs   | 300     | Additional delay after burst detection  |

### BurstFragmentationEngine

Detects rapid-fire request spikes within a rolling window. Once the burst threshold
is crossed, a cooldown period is enforced and scheduling escalation is triggered.

**Policy parameters (`BurstFragmentationPolicy`):**

| Parameter       | Default | Description                              |
|-----------------|---------|------------------------------------------|
| enabled         | true    | Enable/disable burst detection           |
| burstThreshold  | 5       | Requests per window to trigger burst     |
| burstWindowMs   | 10000   | Rolling window for burst detection       |
| cooldownMs      | 5000    | Mandatory cooldown after burst detected  |

**Lifecycle:**
1. Requests are recorded in a per-agent rolling window
2. When count ≥ `burstThreshold` within `burstWindowMs` → burst flagged
3. Cooldown enforced for `cooldownMs` ms
4. After cooldown → window resets, normal operation resumes

### TemporalBudgetManager

Enforces a per-agent request quota within a rolling time window. Prevents
sustained high-frequency activity that accumulates a detectable density signature.

**Policy parameters (`TemporalBudgetPolicy`):**

| Parameter              | Default | Description                                  |
|------------------------|---------|----------------------------------------------|
| enabled                | true    | Enable/disable budget enforcement            |
| maxRequestsPerWindow   | 60      | Maximum requests per window                  |
| windowMs               | 60000   | Rolling window duration (ms)                 |
| forceDelayOnExhaustion | true    | Force a delay instead of blocking on exhaust |

**Key methods:**
- `consumeBudget(agentId, now)` — record request, check budget
- `resetExpiredBudgets(now)` — advance all expired windows
- `getBudget(agentId, now)` — inspect current budget (creates if missing)

### TemporalScheduler

Pure computation layer. Takes cadence, burst, and budget signals and produces
a unified `TemporalSchedulingDecision`. Executes no waits itself.

**Precedence (highest → lowest):**
1. Burst cooldown active → critical escalation
2. Budget exhausted → high escalation + budget delay
3. Burst approaching threshold → scheduling escalation
4. Cadence smoothing required → cadence delay
5. No action needed → zero delay

---

## Temporal Fingerprinting

AI agents exhibit highly distinctive timing signatures because they:
- Query at fixed intervals driven by polling or retry logic
- Burst during parallel reasoning steps
- Cluster queries by research topic in predictable sequences
- Resume at consistent hours matching deployment schedules

These patterns are detectable by search providers, network observers, and analytics
systems even without access to query content. The temporal layer targets **reduction**
of these signatures, not their elimination.

---

## Timing Correlation

The `deterministicSpacing` function produces bounded random-looking delays seeded
from `${agentId}:${Math.floor(now / 500)}`. This ensures:
- Same seed → same delay (reproducible in tests)
- Different agents → different delays
- No true randomness required — no PRNG state leakage

Adaptive delay scales with cadence risk: low → small jitter, medium → moderate spacing,
high/critical → larger delays with burst penalty added.

---

## Pipeline Behaviour by Risk Level

| Risk Level | Actions Applied                                                    |
|------------|---------------------------------------------------------------------|
| low        | Light spacing only                                                  |
| medium     | Cadence smoothing, moderate delay                                   |
| high       | Reinforced delays, burst fragmentation active                       |
| critical   | Full cooldown, scheduling escalation, audit event emitted           |

---

## Audit Events

| Event Type                      | Emitted When                                      |
|---------------------------------|---------------------------------------------------|
| `temporal_spacing_applied`      | Any delay > 0 recommended by scheduler            |
| `cadence_smoothing_applied`     | Cadence smoothing flag set in decision            |
| `burst_detected`                | Burst fragmentation flag set in decision          |
| `temporal_budget_exhausted`     | Budget exhausted flag set in decision             |
| `temporal_scheduling_escalated` | Scheduling escalation flag set in decision        |

Audit events carry only metadata (agentId, delayMs, cadenceRisk, reason). No raw
query content, tokens, or secrets are ever included.

---

## HTTP Endpoints

| Method | Path                                          | Description                      |
|--------|-----------------------------------------------|----------------------------------|
| GET    | `/v1/privacy/temporal/profiles`               | List all temporal profiles       |
| GET    | `/v1/privacy/temporal/profiles/:agentId`      | Get profile for a specific agent |
| GET    | `/v1/privacy/temporal/budgets`                | List all temporal budgets        |
| GET    | `/v1/privacy/temporal/budgets/:agentId`       | Get budget for a specific agent  |
| GET    | `/v1/privacy/temporal/policies`               | Get active temporal policies     |

All responses return metadata only. No raw input, no tokens, no query history.

---

## CLI Commands

```bash
# List all temporal profiles
grl privacy temporal

# Get profile for a specific agent
grl privacy temporal local-agent

# List all temporal budgets
grl privacy budgets

# Get budget for a specific agent
grl privacy budgets local-agent
```

Use `--output json` for machine-readable output.

---

## SDK Methods

```ts
const client = new GrlAgentClient()

// Temporal profiles
const { profiles } = await client.listTemporalProfiles()
const { profile } = await client.getTemporalProfile('local-agent')

// Temporal budgets
const { budgets } = await client.listTemporalBudgets()
const { agentId, budget } = await client.getTemporalBudget('local-agent')
```

---

## Examples

See `examples/temporal-obfuscation/`:

- `cadence-smoothing.ts` — cadence risk evaluation and adaptive delay
- `burst-fragmentation.ts` — burst detection lifecycle and cooldown
- `temporal-budget.ts` — budget consumption, exhaustion, and window reset

---

## Security & Privacy Constraints

- **Fail-closed**: disabled or missing policy → conservative defaults applied
- **Deterministic**: same inputs → same outputs, no hidden state
- **Local-first**: all state in-memory, no network, no DB, no cloud
- **Metadata minimization**: audit events and HTTP responses expose no raw input
- **Explicit isolation**: per-agent profiles, budgets, and cooldowns are independent

---

## Limits & Non-Goals

- Does **not** prevent all temporal correlation — only reduces predictable patterns
- Does **not** anonymize at network level
- Does **not** replace Tor, proxies, or VPNs
- Does **not** prevent fingerprinting by search engine query content analysis
- Does **not** protect against adversaries with full packet capture
- Does **not** guarantee untraceability or unlinkability
- Does **not** use ML or statistical modelling beyond simple CV computation
- Cooldown and budget windows are local — restarting the process resets them

GRL is privacy-first infrastructure that reduces surface area. It is not a guarantee.

---

## Sprint 27 extension: Header Isolation after Temporal Escalation

Transport fingerprint rotation can run after temporal signals indicate elevated correlation risk. Temporal scheduling reduces timing signatures; transport fingerprint isolation reduces trivially stable header signatures. They are complementary, deterministic layers.

See [`docs/transport-fingerprint.md`](./transport-fingerprint.md) for details.

---

## Sprint 28 extension: Runtime Policy Orchestrator

Sprint 28 adds a central arbitration layer above the temporal obfuscation engine. Temporal obfuscation now also emits a `PolicySignal` with `source: 'temporal_obfuscation'` for each execute-mock request. The `RuntimePolicyOrchestrator` aggregates this signal alongside signals from all other gates to produce a single `CompositeRuntimeDecision`.

See [`docs/runtime-policy-orchestrator.md`](./runtime-policy-orchestrator.md) for details.
