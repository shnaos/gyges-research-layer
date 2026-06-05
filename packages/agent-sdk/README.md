# @gyges/agent-sdk

Local Agent SDK for the [Gyges Research Layer (GRL)](../../README.md).

Provides a typed, privacy-first HTTP client so local AI agents can use GRL without dealing with raw HTTP or internal API details.

## Quick start

```ts
import { GrlAgentClient, isAllowed, isPending } from '@gyges/agent-sdk';

const client = new GrlAgentClient();

const result = await client.search('bitcoin privacy');

if (isAllowed(result)) {
  console.log(result.results);
}

if (isPending(result)) {
  console.log('Approval required:', result.approvalRequestId);
}
```

## Full documentation

See [`docs/agent-sdk.md`](../../docs/agent-sdk.md) for:
- Configuration reference
- All SDK methods
- Approval flow
- Error handling
- Privacy model
- Examples

## Design constraints

- **Local only** — talks exclusively to `http://127.0.0.1:8787` (configurable, loopback).
- **Fail-closed** — every error is a typed `GrlAgentSdkError`.
- **No direct web access** — the SDK never calls the web, SearXNG, or any browser directly.
- **No token/query storage** — raw inputs and approval tokens are never logged or persisted.
- **No retry, no cookie, no telemetry.**
