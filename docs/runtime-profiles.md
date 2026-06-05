# Runtime Profiles & Policy Packs

Sprint 20 introduces GRL's **high-level configuration abstraction**: Runtime
Profiles and Policy Packs. These let operators launch GRL with a single
environment variable instead of manually editing all policy fields.

```bash
GRL_PROFILE=strict npm run dev:server
GRL_PROFILE=research npm run dev:server
```

Like every other GRL layer, this module performs **no** networking, fetch, DNS,
socket, browser, database, Redis, durable persistence, authentication, telemetry,
cloud sync, or AI/ML work. It is fully local, deterministic, and immutable.
No tokens, secrets, or raw caller input are ever stored or returned.

---

## Architecture

```
GRL_PROFILE (env)
    ↓
RuntimeProfileResolver            ← Sprint 20
    ↓ resolveProfile(name, baseConfig)
ResolvedRuntimeProfile (frozen)
    ↓
GRL policy engines (firewall, routing, privacy, trust, graph,
                    adaptive defense, rate limiting, sandbox)
    ↓
execute-mock pipeline
```

The profile layer sits **on top of** the existing `RuntimeConfig` system
(Sprint 16). The resolver starts from the active `RuntimeConfig` snapshot,
applies all policy packs in order, applies profile overrides, deep-freezes
the result, and hands it to the server's engine-builder functions.

---

## Concepts

### RuntimeProfile

A named configuration bundle that references one or more Policy Packs plus
optional field-level overrides.

```ts
interface RuntimeProfile {
  name: RuntimeProfileName;        // 'strict' | 'balanced' | 'research' | 'development'
  description?: string;
  extends?: RuntimeProfileName;    // inherit parent profile's packs first
  packs: string[];                 // pack IDs to apply, in order
  overrides?: Partial<RuntimeConfig>; // applied after all packs
  enabled: boolean;
}
```

### PolicyPack

A reusable, named bundle of one or more policy arrays. Each pack replaces
(not concatenates) the corresponding field in the working config.

```ts
interface PolicyPack {
  id: string;
  description?: string;
  firewallPolicies?: CapabilityPolicy[];
  transportPolicies?: TransportPolicyRule[];
  adaptiveDefensePolicies?: AdaptiveDefensePolicy[];
  rateLimitPolicies?: RateLimitPolicy[];
  privacyBoundaryRules?: PrivacyBoundaryRule[];
  graphTransitionRules?: CapabilityTransitionRule[];
  isolationPolicies?: DependencyIsolationPolicy[];
  trustPolicies?: RuntimeTrustPolicy;
  sandboxPolicies?: RuntimeSandboxPolicy[];
}
```

### ResolvedRuntimeProfile

The output of resolution: an immutable, deep-frozen config ready for engines.

```ts
interface ResolvedRuntimeProfile {
  profile: RuntimeProfile;
  packs: PolicyPack[];
  resolvedConfig: RuntimeConfig;   // deep-frozen
}
```

---

## Built-in Profiles

### `strict`

Aggressive deny-by-default posture. Suitable for production deployments where
security takes priority over UX friction.

- Only low-risk `search` allowed; approval required for every request
- All anomalies escalate to temporary block (no cooldown phase)
- Max capability path length: 3
- Session reuse forbidden (`always_rotate`)
- Hardened privacy boundary (block on violation, not just require_approval)
- Conservative trust thresholds (quarantine at 30, restrict at 55)

**Packs applied:** `strict-defense-pack`, `strict-sandbox-pack`,
`privacy-hardening-pack`, `trust-hardening-pack`

---

### `balanced` _(default)_

Default recommended profile. Mirrors the boot-time `DEFAULT_RUNTIME_CONFIG`
exactly. Reasonable protections with usable UX.

- Standard rate limits
- Standard adaptive defence
- Bootstrap transport/privacy/trust/graph surface
- Session reuse active (`reuse_active`)

**Packs applied:** `balanced-default-pack`

---

### `research`

Extends `balanced`, then overlays the research-flex-pack. Suitable for
exploration tasks where the agent needs more tool flexibility.

- Inherits all `balanced` policies
- Relaxed graph transitions (medium risk without explicit approval)
- More generous rate limits (20 req/min)
- Faster trust recovery (lower quarantine/restriction thresholds)
- Path length: 8

**Packs applied (parent-first):** `balanced-default-pack`, `research-flex-pack`

---

### `development`

Minimal friction for local development and testing. Sandbox remains active
(no real network/filesystem/process/browser access).

- All tools allowed up to medium risk; no confirmation required
- 100 req/min
- Path length: 20
- Permissive trust (no automatic quarantine)
- Sandbox always active

**Packs applied:** `balanced-default-pack`, `development-low-friction-pack`

---

## Built-in Policy Packs

| Pack ID | Purpose |
|---|---|
| `balanced-default-pack` | Mirrors `DEFAULT_RUNTIME_CONFIG` exactly (boot defaults) |
| `strict-defense-pack` | Tight rate limits (3/min), all anomalies → temporary_block |
| `strict-sandbox-pack` | Path length 3, session reuse forbidden, strict isolation |
| `research-flex-pack` | Path length 8, 20 req/min, lower thresholds, no tool-change approval |
| `development-low-friction-pack` | All tools at medium risk, 100 req/min, path 20, permissive trust |
| `privacy-hardening-pack` | Block (not require_approval) on privacy boundary violation |
| `trust-hardening-pack` | Baseline trust 65, quarantine at 29, restrict at 54 |

---

## Profile Inheritance

Profiles can extend a parent profile:

```ts
{
  name: 'research',
  extends: 'balanced',  // parent packs applied first
  packs: ['research-flex-pack']
}
```

**Inheritance rules:**

1. The full inheritance chain is resolved before any packs are applied.
2. Parent profile's packs are applied **before** the child's packs.
3. Only the **leaf** profile's `overrides` are applied (not parent overrides).
4. Cycles are detected and cause a `RuntimeProfileResolutionError` with reason
   `'inheritance_cycle'`.
5. Resolution is deterministic: identical inputs always produce identical outputs.
6. The result is deep-frozen.

---

## Profile Resolution Lifecycle

```
resolveProfile('research', activeSnapshot.config)
  1. Look up 'research' → found
  2. Detect extends: 'balanced'
  3. Walk chain: ['balanced', 'research'] (parent first, cycle-checked)
  4. Start from baseConfig (deep copy, never mutated)
  5. Apply balanced's packs: [balanced-default-pack]
  6. Apply research's packs: [research-flex-pack]
  7. Apply research's overrides (none)
  8. Deep-freeze result
  9. Return ResolvedRuntimeProfile
```

**Error reasons:**

| Reason | When |
|---|---|
| `unknown_profile` | Profile name not registered |
| `unknown_pack` | Pack ID referenced by profile not found |
| `inheritance_cycle` | Circular `extends` chain detected |
| `invalid_override` | Override field is not a valid `RuntimeConfig` key |

---

## Runtime Switching

A running GRL server can switch profiles locally without restart:

```bash
# Via CLI
npm run cli -- runtime profile strict

# Via HTTP
curl -X POST http://127.0.0.1:8787/v1/runtime/profile/strict
```

**Switching behaviour:**

1. Validates the profile name (404 if unknown, fail-safe audit event emitted)
2. Resolves the new profile against the current active `RuntimeConfig` snapshot
3. On success: rebuilds all policy engines from the resolved config, updates
   active profile, emits `runtime_profile_switched` + `policy_pack_applied`
   events
4. On failure: preserves the old profile, emits `runtime_profile_switch_failed`
5. Stateful components (sessions, approvals, audit, trust scores) are **preserved**
   across switches — only the policy engines are rebuilt

---

## Selecting Profile at Boot

Set the `GRL_PROFILE` environment variable before starting the server:

```bash
GRL_PROFILE=strict npm run dev:server
GRL_PROFILE=balanced npm run dev:server
GRL_PROFILE=research npm run dev:server
GRL_PROFILE=development npm run dev:server
```

**Default:** `balanced`

If `GRL_PROFILE` contains an invalid profile name, GRL logs a warning and
falls back to `balanced` (fail-safe, not fail-closed, at startup).

---

## CLI Commands

```bash
# List all available runtime profiles
npm run cli -- runtime profiles

# Show the currently active profile
npm run cli -- runtime profile

# Switch to a named profile (local only, no cloud, no remote sync)
npm run cli -- runtime profile strict
npm run cli -- runtime profile balanced
npm run cli -- runtime profile research
npm run cli -- runtime profile development

# List all built-in policy packs
npm run cli -- runtime packs

# JSON output for any command
npm run cli -- --json runtime profiles
npm run cli -- --json runtime profile
```

---

## HTTP Endpoints

### `GET /v1/runtime/profiles`

List all registered runtime profiles (metadata only).

```json
{
  "profiles": [
    {
      "name": "strict",
      "description": "...",
      "packIds": ["strict-defense-pack", "strict-sandbox-pack", "privacy-hardening-pack", "trust-hardening-pack"],
      "enabled": true
    },
    { "name": "balanced", "packIds": ["balanced-default-pack"], "enabled": true },
    { "name": "research", "extends": "balanced", "packIds": ["research-flex-pack"], "enabled": true },
    { "name": "development", "packIds": ["balanced-default-pack", "development-low-friction-pack"], "enabled": true }
  ]
}
```

### `GET /v1/runtime/profile`

Show the currently active runtime profile.

```json
{
  "profile": {
    "name": "balanced",
    "packIds": ["balanced-default-pack"],
    "enabled": true
  }
}
```

### `GET /v1/runtime/packs`

List all registered policy packs (metadata: id, description, defined field names).

```json
{
  "packs": [
    { "id": "balanced-default-pack", "description": "...", "definedFields": ["firewallPolicies", "rateLimitPolicies", "..."] },
    { "id": "strict-defense-pack", "description": "...", "definedFields": ["firewallPolicies", "rateLimitPolicies", "adaptiveDefensePolicies"] }
  ]
}
```

### `POST /v1/runtime/profile/:name`

Switch the active runtime profile locally (no cloud, no remote sync).

```bash
curl -X POST http://127.0.0.1:8787/v1/runtime/profile/strict
```

**Responses:**

| Status | Meaning |
|---|---|
| 200 | Switched successfully |
| 400 | Profile is disabled or resolution failed |
| 404 | Unknown profile name |
| 405 | Wrong HTTP method |

```json
{
  "profile": { "name": "strict", "packIds": ["..."], "enabled": true },
  "switchedAt": 1717628942000
}
```

---

## Audit Events

| Event type | When emitted |
|---|---|
| `runtime_profile_loaded` | Boot — initial profile resolved and applied |
| `runtime_profile_switched` | Successful local profile switch |
| `runtime_profile_switch_failed` | Failed switch attempt (preserves old profile) |
| `policy_pack_applied` | Each pack applied (boot or switch) |

---

## Fail-Safe Behaviour

| Scenario | Behaviour |
|---|---|
| Invalid `GRL_PROFILE` at boot | Warn + fall back to `balanced` |
| Unknown profile in POST switch | 404, emit `switch_failed`, preserve old profile |
| Resolution error (cycle, unknown pack) | 400, emit `switch_failed`, preserve old profile |
| Disabled profile | 400, not attempted |

---

## MVP Limits

- Profiles and packs are **static** (defined in `packages/core/src/runtime-profiles/packs.ts`).
  There is no runtime API to register new packs or profiles dynamically.
- The `overrides` field supports only top-level `RuntimeConfig` array fields
  (replaces the whole array, no field-level merge).
- No remote profile registry, no cloud sync, no persistence between restarts.
- Profile state is reset to the boot profile (`GRL_PROFILE` or `balanced`) on
  server restart.
- No auth: all profile endpoints are local-only (`127.0.0.1`).
