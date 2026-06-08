/**
 * GRL SDK Demo — Sprint 22
 *
 * Demonstrates the @gyges/agent-sdk from a consumer perspective.
 * Requires the GRL local API server to be running on 127.0.0.1:8787.
 *
 * Start the server first:
 *   npm run dev:server
 *
 * Then run this script:
 *   npx tsx examples/quickstart/sdk-demo.ts
 *
 * No Internet access. No secrets. No tokens. Local runtime only.
 */

import { GrlAgentClient, isAllowed, isDenied, isPending, GrlAgentSdkError } from '../../packages/agent-sdk/src/index.js';

const BASE_URL = process.env['GRL_BASE_URL'] ?? 'http://127.0.0.1:8787';

async function main(): Promise<void> {
  console.log('────────────────────────────────────────────');
  console.log('GRL SDK Demo');
  console.log('────────────────────────────────────────────');
  console.log(`Server: ${BASE_URL}`);
  console.log('');

  const client = new GrlAgentClient({ baseUrl: BASE_URL });

  // ── 1. Health check ────────────────────────────────────────────────────────
  console.log('── 1. Health check ──');
  try {
    const health = await client.health();
    console.log(`  status: ${health.status}`);
    console.log(`  profile: ${health.profile ?? 'unknown'}`);
  } catch (err) {
    if (err instanceof GrlAgentSdkError) {
      console.error(`  Error (${err.code}): ${err.message}`);
    } else {
      console.error(`  Error: ${String(err)}`);
    }
    console.error('  Is the server running? (npm run dev:server)');
    process.exit(1);
  }
  console.log('');

  // ── 2. Search (requires SearXNG; denied with explicit reason otherwise) ─────
  console.log('── 2. Search ──');
  console.log('  query: "privacy research"');
  try {
    const result = await client.search('privacy research');

    if (isAllowed(result)) {
      console.log(`  decision: allowed`);
      console.log(`  results: ${result.results?.length ?? 0} item(s)`);
    } else if (isPending(result)) {
      console.log(`  decision: pending approval`);
      console.log(`  approvalRequestId: ${result.approvalRequestId}`);
    } else if (isDenied(result)) {
      console.log(`  decision: denied`);
      console.log(`  reason: ${result.reason}`);
    }
  } catch (err) {
    if (err instanceof GrlAgentSdkError) {
      console.error(`  Error (${err.code}): ${err.message}`);
    } else {
      console.error(`  Error: ${String(err)}`);
    }
  }
  console.log('');

  // ── 3. Trust profiles ──────────────────────────────────────────────────────
  console.log('── 3. Trust profiles ──');
  try {
    const profiles = await client.listTrustProfiles();
    console.log(`  ${profiles.length} profile(s) found`);
    for (const p of profiles.slice(0, 3)) {
      console.log(`  - compartmentId="${p.compartmentId}" score=${p.score} level=${p.level}`);
    }
  } catch (err) {
    if (err instanceof GrlAgentSdkError) {
      console.error(`  Error (${err.code}): ${err.message}`);
    } else {
      console.error(`  Error: ${String(err)}`);
    }
  }
  console.log('');

  // ── 4. Audit events ────────────────────────────────────────────────────────
  console.log('── 4. Audit events (last 5) ──');
  try {
    const events = await client.listAuditEvents({ limit: 5 });
    console.log(`  ${events.length} event(s) found`);
    for (const e of events) {
      console.log(`  - [${e.severity}] ${e.type} @ ${new Date(e.timestamp).toISOString()}`);
    }
  } catch (err) {
    if (err instanceof GrlAgentSdkError) {
      console.error(`  Error (${err.code}): ${err.message}`);
    } else {
      console.error(`  Error: ${String(err)}`);
    }
  }
  console.log('');

  console.log('────────────────────────────────────────────');
  console.log('SDK demo complete.');
  console.log('────────────────────────────────────────────');
}

main().catch((err) => {
  console.error('SDK demo crashed:', err);
  process.exit(1);
});
