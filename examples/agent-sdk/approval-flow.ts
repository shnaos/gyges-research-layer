/**
 * @gyges/agent-sdk — Approval flow example.
 *
 * Demonstrates the full approval lifecycle:
 *   1. Submit a capability request that may require human approval.
 *   2. Check if the result is pending.
 *   3. Approve or reject the pending request.
 *
 * Prerequisites:
 *   - GRL runtime running locally (npm run dev:server from repo root)
 *   - A policy that routes some requests to the approval queue
 *     (e.g. fetch_html at medium risk with the bootstrap confirmation rule).
 *
 * Usage:
 *   npx tsx examples/agent-sdk/approval-flow.ts
 */

import { GrlAgentClient, isPending, isAllowed, isDenied } from '../../packages/agent-sdk/src/index.js';

const client = new GrlAgentClient();

// Request a capability that may need human confirmation.
const result = await client.requestCapability({
  tool: 'fetch_html',
  riskLevel: 'medium',
  input: { url: 'https://example.com' }
});

console.log('Decision:', result.decision);
console.log('Reason:', result.reason);

if (result.decision === 'pending' && result.approvalRequestId && result.approvalToken) {
  console.log('\nRequest is pending human approval.');
  console.log('Approval request ID:', result.approvalRequestId);

  // In a real scenario the human would review and decide.
  // Here we demonstrate the API — comment out approve or reject as needed.
  const decision = await client.approve(result.approvalRequestId, result.approvalToken);
  console.log('\nApproval decision submitted:', decision.status);
  console.log('Request ID:', decision.id);
}

if (result.decision === 'allowed') {
  console.log('\nCapability allowed immediately.');
}

if (result.decision === 'denied') {
  console.log('\nCapability denied by firewall.');
}

// For search results specifically, you can also use the type guards:
const searchResult = await client.search('open source privacy tools');

if (isPending(searchResult)) {
  console.log('\nSearch requires approval:', searchResult.approvalRequestId);
  const approved = await client.approve(searchResult.approvalRequestId, searchResult.approvalToken);
  console.log('Approved:', approved.status);
}

if (isAllowed(searchResult)) {
  console.log('\nSearch results available:', (searchResult.results ?? []).length, 'items');
}

if (isDenied(searchResult)) {
  console.log('\nSearch denied:', searchResult.reason);
}
