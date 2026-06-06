# @gyges/agent-sdk — Agent SDK Documentation

The `@gyges/agent-sdk` package is the **Local Agent SDK** for the Gyges Research Layer (GRL). It provides a typed, privacy-first client for local AI agents that need to perform web research through GRL.

## Overview

```
Local AI Agent
     ↓
@gyges/agent-sdk
     ↓
GRL Local API  (http://127.0.0.1:8787)
     ↓
GRL Runtime
```

The SDK:
- Communicates **only** with the local GRL API — never directly with the web, SearXNG, a browser, or any external service.
- Is fail-closed: every error produces a structured `GrlAgentSdkError`.
- Never logs, stores, or persists raw query strings, approval tokens, or secrets.
- Has no retry, no cookie, no cache, no telemetry, and no analytics.

---

## Installation (local)

```bash
# From the monorepo root, the SDK lives at:
packages/agent-sdk/

# Import directly in TypeScript (monorepo):
import { GrlAgentClient } from '../../packages/agent-sdk/src/index.js';

# Or from the built dist after npm run build:agent-sdk
import { GrlAgentClient } from '@gyges/agent-sdk';
```

---

## Configuration

```ts
import { GrlAgentClient } from '@gyges/agent-sdk';

// Defaults: baseUrl=http://127.0.0.1:8787, timeoutMs=5000,
//           agentId=local-agent, compartmentId=research
const client = new GrlAgentClient();

// Custom config:
const client = new GrlAgentClient({
  baseUrl: 'http://127.0.0.1:8787',
  timeoutMs: 5000,
  agentId: 'my-agent',
  compartmentId: 'research'
});
```

### `GrlAgentSdkConfig`

| Field | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | `string` | `http://127.0.0.1:8787` | GRL Local API base URL |
| `timeoutMs` | `number` | `5000` | Request timeout in ms |
| `agentId` | `string` | `local-agent` | Agent identifier |
| `compartmentId` | `string` | `research` | Default compartment |

---

## search()

The primary method for AI agents. Routes through the full GRL pipeline (firewall → trust → rate limit → adaptive defense → transport).

```ts
const result = await client.search('bitcoin privacy');
```

Returns a `SearchResult` union discriminated by `status`:

```ts
type SearchResult =
  | SearchAllowedResult   // status: 'allowed'
  | SearchDeniedResult    // status: 'denied'
  | SearchPendingResult   // status: 'pending'
```

Use the type guards to branch safely:

```ts
import { GrlAgentClient, isAllowed, isPending, isDenied } from '@gyges/agent-sdk';

const client = new GrlAgentClient();
const result = await client.search('open source privacy tools');

if (isAllowed(result)) {
  console.log(result.results);      // SearchResultItem[]
  console.log(result.executionStatus); // 'success' | 'blocked' | 'failed'
  console.log(result.transportKind);   // e.g. 'searxng'
}

if (isPending(result)) {
  console.log('Approval required:', result.approvalRequestId);
}

if (isDenied(result)) {
  console.log('Denied:', result.reason);
}
```

### Options

```ts
await client.search('query', {
  riskLevel: 'low',         // default
  agentId: 'override',      // optional
  compartmentId: 'ops'      // optional
});
```

### Privacy guarantee

- The query string is forwarded **only** to the local GRL API.
- It is **never** logged, stored, or persisted by the SDK.
- The `raw` field on the result holds the unmodified API response in memory only — it is never written to disk.

---

## Approval flow

When `isPending(result)` is true, the GRL firewall has flagged the request for human approval. The SDK provides `approve()` and `reject()` methods.

```ts
if (isPending(result)) {
  console.log('Approval required:', result.approvalRequestId);

  // Human reviews and decides:
  const decision = await client.approve(
    result.approvalRequestId,
    result.approvalToken
  );
  console.log(decision.status); // 'approved'
}

// Or reject:
await client.reject(result.approvalRequestId, result.approvalToken);
```

**Privacy:** The approval token is forwarded only to the local GRL API and is never logged or stored by the SDK.

---

## Error handling

All errors are instances of `GrlAgentSdkError` with a typed `code`:

```ts
import { GrlAgentSdkError } from '@gyges/agent-sdk';

try {
  const result = await client.search('query');
} catch (err) {
  if (err instanceof GrlAgentSdkError) {
    switch (err.code) {
      case 'runtime_unreachable':
        // GRL server not running
        break;
      case 'request_timeout':
        // Request exceeded timeoutMs
        break;
      case 'invalid_response':
        // Non-JSON or unexpected response shape
        break;
      case 'capability_failed':
        // Non-200 HTTP response
        break;
      case 'invalid_arguments':
        // Bad input to an SDK method
        break;
    }
  }
}
```

### Error codes

| Code | Cause |
|---|---|
| `runtime_unreachable` | GRL server not running or network error |
| `request_timeout` | Request exceeded `timeoutMs` |
| `invalid_response` | Non-JSON or malformed response |
| `capability_failed` | Non-200 HTTP status |
| `invalid_arguments` | Invalid arguments to SDK method |

Stack traces are suppressed by default to avoid leaking internal paths.

---

## Runtime profiles

```ts
// Get active profile
const profile = await client.getRuntimeProfile();

// List all profiles
const profiles = await client.listRuntimeProfiles();

// Switch profile
const result = await client.switchRuntimeProfile('strict');
console.log(result.profile.name, result.switchedAt);
```

---

## Behavioral privacy inspection

The SDK exposes metadata-only behavioral privacy endpoints:

```ts
const profiles = await client.listBehavioralProfiles()
const profile = await client.getBehavioralProfile('agent-a')
const fragments = await client.listIdentityFragments('agent-a')
```

These methods never return raw queries, tokens, or secrets — only behavioral risk metadata and fragment lifecycle fields.

---

## Persona isolation inspection

The SDK exposes metadata-only persona isolation endpoints (Sprint 25):

```ts
// List all personas across all agents
const { personas } = await client.listPersonas()

// List personas for a specific agent
const { personas } = await client.getPersonas('agent-a')

// List persona-fragment bindings (optional agentId filter)
const { bindings } = await client.listPersonaBindings('agent-a')
```

These methods never return raw queries, tokens, or secrets — only persona metadata and fragment binding lifecycle fields.

See [`docs/persona-isolation.md`](./persona-isolation.md) for full details.

---

## Temporal Obfuscation (Sprint 26)

The SDK exposes metadata-only temporal obfuscation endpoints (Sprint 26):

```ts
// List temporal profiles for all agents
const { profiles } = await client.listTemporalProfiles()

// Get temporal profile for a specific agent
const { profile } = await client.getTemporalProfile('local-agent')

// List temporal privacy budgets for all agents
const { budgets } = await client.listTemporalBudgets()

// Get budget for a specific agent
const { agentId, budget } = await client.getTemporalBudget('local-agent')
```

These methods return only metadata (cadence risk, burst counts, budget consumption).
No raw queries, tokens, or secrets are ever returned.

See [`docs/temporal-obfuscation.md`](./temporal-obfuscation.md) for full details.

---

## Audit events

```ts
const events = await client.listAuditEvents();
const filtered = await client.listAuditEvents({
  type: 'capability_allowed',
  severity: 'info',
  limit: 50
});
```

---

## Trust profiles

```ts
// All compartments
const profiles = await client.listTrustProfiles();

// Single compartment
const profile = await client.getTrustProfile('research');
console.log(profile.score, profile.level); // 70, 'neutral'
```

---

## Incidents

```ts
const incidents = await client.listIncidents();
for (const inc of incidents) {
  console.log(inc.id, inc.severity, inc.status, inc.summary);
}
```

---

## Transports

```ts
const transports = await client.listTransports();
for (const t of transports) {
  console.log(t.kind, t.name, t.networkAccess);
}
```

---

## Privacy model

The SDK enforces the following privacy guarantees:

1. **No direct web access.** All requests go through the GRL Local API. The SDK never calls the web directly, never calls SearXNG directly, and never opens a browser, WebSocket, or SSE connection.
2. **No query logging.** Raw query strings are never logged or persisted.
3. **No token storage.** Approval tokens are forwarded directly to the GRL API and are never stored, logged, or serialised to disk.
4. **No secrets in headers.** The SDK sends only `accept: application/json` and `content-type: application/json`. No auth, cookie, or secret header of any kind.
5. **No retry.** There is no automatic retry logic, which avoids unintended repeat disclosures.
6. **No telemetry.** No analytics, tracking, or monitoring data is ever sent anywhere.
7. **Fail-closed.** Any unexpected error (timeout, unreachable server, non-JSON response) throws a `GrlAgentSdkError` — the SDK never silently swallows failures.
8. **In-memory only.** The `raw` field on results is held in memory for the lifetime of the variable. The SDK never writes files, databases, or external storage.

---

## Examples

See [`examples/agent-sdk/`](../examples/agent-sdk/) for runnable examples:

- [`basic-search.ts`](../examples/agent-sdk/basic-search.ts) — simple search with decision branching
- [`approval-flow.ts`](../examples/agent-sdk/approval-flow.ts) — full approve/reject lifecycle
- [`runtime-profile-switch.ts`](../examples/agent-sdk/runtime-profile-switch.ts) — list, get, and switch runtime profiles

---

## Endpoints used

| Method | Endpoint | SDK method |
|---|---|---|
| `GET` | `/v1/health` | `health()` |
| `POST` | `/v1/capabilities/execute` | `search()` |
| `POST` | `/v1/capabilities/request` | `requestCapability()` |
| `POST` | `/v1/approvals/:id/approve` | `approve()` |
| `POST` | `/v1/approvals/:id/reject` | `reject()` |
| `GET` | `/v1/audit/events` | `listAuditEvents()` |
| `GET` | `/v1/trust/profiles` | `listTrustProfiles()` |
| `GET` | `/v1/trust/profiles/:id` | `getTrustProfile()` |
| `GET` | `/v1/security/incidents` | `listIncidents()` |
| `GET` | `/v1/runtime/profile` | `getRuntimeProfile()` |
| `GET` | `/v1/runtime/profiles` | `listRuntimeProfiles()` |
| `POST` | `/v1/runtime/profile/:name` | `switchRuntimeProfile()` |
| `GET` | `/v1/transports` | `listTransports()` |
| `GET` | `/v1/agents` | `listAgents()` |
| `GET` | `/v1/agents/:agentId` | `getAgent()` |
| `GET` | `/v1/agents/:agentId/leases` | `listAgentLeases()` |
| `GET` | `/v1/agents/:agentId/trust` | `getAgentTrust()` |
| `POST` | `/v1/agents/:agentId/restrict` | `restrictAgent()` |
| `POST` | `/v1/agents/:agentId/evict` | `evictAgent()` |
