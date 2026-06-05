/**
 * @gyges/agent-sdk — Basic search example.
 *
 * Demonstrates the minimal usage pattern for performing a search through the
 * GRL Local API and branching on the decision outcome.
 *
 * Prerequisites:
 *   - GRL runtime running locally (npm run dev:server from repo root)
 *
 * Usage:
 *   npx tsx examples/agent-sdk/basic-search.ts
 */

import { GrlAgentClient, isAllowed, isPending, isDenied } from '../../packages/agent-sdk/src/index.js';

const client = new GrlAgentClient();

const result = await client.search('bitcoin privacy');

if (isAllowed(result)) {
  console.log('Search allowed. Results:');
  if (result.results && result.results.length > 0) {
    for (const item of result.results) {
      console.log(`  - [${item.title}] ${item.url}`);
    }
  } else {
    console.log('  (no results returned)');
  }
  console.log('Execution status:', result.executionStatus);
  console.log('Transport:', result.transportKind);
}

if (isPending(result)) {
  console.log('Human approval required.');
  console.log('Approval request ID:', result.approvalRequestId);
  console.log('Use client.approve() or client.reject() with the token.');
}

if (isDenied(result)) {
  console.log('Search denied by GRL firewall.');
  console.log('Reason:', result.reason);
}
